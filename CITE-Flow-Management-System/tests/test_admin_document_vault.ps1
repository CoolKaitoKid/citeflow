# CITEFLOW — Admin Document Vault Preview & Download Functionality Test Suite
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
[System.Net.ServicePointManager]::DefaultConnectionLimit = 100
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function Get-StorageBytes($url, $token = $null) {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("apikey", $SUPABASE_ANON_KEY)
    if ($token) {
        $wc.Headers.Add("Authorization", "Bearer $token")
    }
    return $wc.DownloadData($url)
}

Write-Output "==================================================================="
Write-Output "  CITEFLOW: ADMIN DOCUMENT VAULT PREVIEW & DOWNLOAD TEST SUITE     "
Write-Output "==================================================================="

$passed = 0
$failed = 0

function Assert-Test($desc, $cond) {
    if ($cond) {
        Write-Output "  [PASS] $desc"
        $global:passed++
    } else {
        Write-Output "  [FAIL] $desc"
        $global:failed++
    }
}

$SUPABASE_URL = "https://uforealazougjckepggc.supabase.co"
$SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0"

# -------------------------------------------------------------------------
# Test Group 1: Candidate Paths & Bucket Logic
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 1: Candidate Paths & Bucket Logic ---"

function Get-CandidatePaths($originalPath, $folderId, $name) {
    $raw = "$originalPath".Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    
    $cleanRaw = $raw -replace '^/+', ''
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($cleanRaw) { $candidates.Add($cleanRaw) }
    if ($raw -ne $cleanRaw) { $candidates.Add($raw) }

    $buckets = @('documents', 'document', 'document-vault', 'admin-documents', 'faculty-documents', 'uploads', 'files')
    foreach ($b in $buckets) {
        if ($cleanRaw.StartsWith("$b/")) {
            $candidates.Add($cleanRaw.Substring($b.Length + 1))
        }
    }

    $parts = @($cleanRaw.Split('/') | Where-Object { $_ })
    if ($parts.Count -ge 2) {
        $candidates.Add(($parts[-2..-1] -join '/'))
    }

    $filename = if ($parts.Count -gt 0) { $parts[$parts.Count - 1] } else { $name }
    if ($filename -and $folderId) {
        $candidates.Add("$folderId/$filename")
    }
    if ($filename) {
        $candidates.Add($filename)
    }

    return @($candidates | Select-Object -Unique)
}

$cp1 = Get-CandidatePaths "/1/1777295170946-MEMO_ATHLETES.pdf" 1 "MEMO_ATHLETES.pdf"
Assert-Test "Strips leading slashes from paths" ($cp1 -contains "1/1777295170946-MEMO_ATHLETES.pdf")

$cp2 = Get-CandidatePaths "documents/8/1790200325025_test.pdf" 8 "test.pdf"
Assert-Test "Strips bucket prefix from paths" ($cp2 -contains "8/1790200325025_test.pdf")

$cp3 = Get-CandidatePaths "correction.pdf" 18 "correction.pdf"
Assert-Test "Derives folderId/filename candidate" ($cp3 -contains "18/correction.pdf")

# -------------------------------------------------------------------------
# Test Group 2: Format Classification for Preview & Fallback
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 2: Format Classification for Preview & Fallback ---"

function Is-DirectlyPreviewable($name, $mime) {
    $ext = [System.IO.Path]::GetExtension($name).TrimStart('.').ToLower()
    $type = "$mime".ToLower()
    $isPdf = ($ext -eq 'pdf') -or $type.Contains('pdf')
    $isImg = (@('jpg','jpeg','png','gif','webp','svg') -contains $ext) -or $type.Contains('image')
    $isText = (@('txt','csv','md') -contains $ext) -or $type.Contains('text')
    return ($isPdf -or $isImg -or $isText)
}

Assert-Test "PDF recognized as directly previewable" (Is-DirectlyPreviewable "document.pdf" "application/pdf")
Assert-Test "PNG image recognized as directly previewable" (Is-DirectlyPreviewable "photo.png" "image/png")
Assert-Test "JPG image recognized as directly previewable" (Is-DirectlyPreviewable "photo.jpg" "image/jpeg")
Assert-Test "TXT file recognized as directly previewable" (Is-DirectlyPreviewable "notes.txt" "text/plain")
Assert-Test "DOCX recognized as non-native (requires fallback UI)" (-not (Is-DirectlyPreviewable "report.docx" "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
Assert-Test "XLSX recognized as non-native (requires fallback UI)" (-not (Is-DirectlyPreviewable "grades.xlsx" "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
Assert-Test "PPTX recognized as non-native (requires fallback UI)" (-not (Is-DirectlyPreviewable "lecture.pptx" ""))
Assert-Test "ZIP recognized as non-native (requires fallback UI)" (-not (Is-DirectlyPreviewable "archive.zip" "application/zip"))

# -------------------------------------------------------------------------
# Test Group 3: Supabase Authentication & Admin Access
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 3: Supabase Authentication & Admin Access ---"

$authBody = @{ email = "admin.test@ctu.edu.ph"; password = "Password123!" } | ConvertTo-Json
$authRes = Invoke-RestMethod -Uri "$SUPABASE_URL/auth/v1/token?grant_type=password" -Headers @{ apikey = $SUPABASE_ANON_KEY; "Content-Type" = "application/json" } -Method Post -Body $authBody
$userToken = $authRes.access_token

Assert-Test "Admin user authenticated with valid JWT" ([string]::IsNullOrEmpty($userToken) -eq $false)

$userHeaders = @{ apikey = $SUPABASE_ANON_KEY; Authorization = "Bearer $userToken"; "Content-Type" = "application/json" }
$isAdmin = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/rpc/is_document_vault_admin" -Headers $userHeaders -Method Post -Body "{}"
Assert-Test "RPC is_document_vault_admin returns true for admin" ($isAdmin -eq $true)

# -------------------------------------------------------------------------
# Test Group 4: Live Documents & Storage Retrieval
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 4: Live Database & Storage Objects ---"

$docs = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/documents?select=*" -Headers $userHeaders -Method Get
Assert-Test "Loaded live documents table records" ($docs.Count -gt 0)

$pdfDoc = $docs | Where-Object { $_.name -like "*.pdf" } | Select-Object -First 1
$imgDoc = $docs | Where-Object { $_.name -like "*.png" -or $_.name -like "*.jpg" } | Select-Object -First 1
$docxDoc = $docs | Where-Object { $_.name -like "*.docx" } | Select-Object -First 1
$xlsxDoc = $docs | Where-Object { $_.name -like "*.xlsx" } | Select-Object -First 1

Assert-Test "Found PDF document: $($pdfDoc.name)" ($null -ne $pdfDoc)
Assert-Test "Found Image document: $($imgDoc.name)" ($null -ne $imgDoc)
Assert-Test "Found DOCX document: $($docxDoc.name)" ($null -ne $docxDoc)
Assert-Test "Found XLSX document: $($xlsxDoc.name)" ($null -ne $xlsxDoc)

# -------------------------------------------------------------------------
# Test Group 5: Preview & Download a PDF Document
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 5: PDF Preview & Download ---"
if ($pdfDoc) {
    # 5a. Signed URL for Preview
    $signBody = @{ expiresIn = 3600 } | ConvertTo-Json
    $signRes = Invoke-RestMethod -Uri "$SUPABASE_URL/storage/v1/object/sign/documents/$($pdfDoc.file_path)" -Headers $userHeaders -Method Post -Body $signBody
    Assert-Test "Generated signed URL for PDF preview" ($null -ne $signRes.signedURL)

    # 5b. Fetch Signed URL content
    $fullSignUrl = "$SUPABASE_URL/storage/v1$($signRes.signedURL)"
    $pdfSignedBytes = Get-StorageBytes $fullSignUrl
    Assert-Test "Signed URL returned data ($($pdfSignedBytes.Length) bytes)" ($pdfSignedBytes.Length -gt 0)
    Assert-Test "PDF size matches database record ($($pdfDoc.size_bytes) bytes)" ($pdfSignedBytes.Length -eq $pdfDoc.size_bytes)
    
    $first4 = [System.Text.Encoding]::ASCII.GetString($pdfSignedBytes, 0, [Math]::Min(4, $pdfSignedBytes.Length))
    Assert-Test "Valid %PDF magic header present in downloaded stream ($first4)" ($first4 -eq "%PDF")

    # 5c. Direct Authenticated Download
    $authPdfUrl = "$SUPABASE_URL/storage/v1/object/authenticated/documents/$($pdfDoc.file_path)"
    $pdfAuthBytes = Get-StorageBytes $authPdfUrl $userToken
    Assert-Test "Direct authenticated download matches full size ($($pdfAuthBytes.Length) bytes)" ($pdfAuthBytes.Length -eq $pdfDoc.size_bytes)
}

# -------------------------------------------------------------------------
# Test Group 6: Preview & Download an Image Document
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 6: Image Preview & Download ---"
if ($imgDoc) {
    # 6a. Signed URL for Preview
    $signImg = Invoke-RestMethod -Uri "$SUPABASE_URL/storage/v1/object/sign/documents/$($imgDoc.file_path)" -Headers $userHeaders -Method Post -Body (@{ expiresIn = 3600 } | ConvertTo-Json)
    Assert-Test "Generated signed URL for Image preview" ($null -ne $signImg.signedURL)

    # 6b. Fetch Image content
    $fullSignImgUrl = "$SUPABASE_URL/storage/v1$($signImg.signedURL)"
    $imgBytes = Get-StorageBytes $fullSignImgUrl
    Assert-Test "Image signed URL returned data ($($imgBytes.Length) bytes)" ($imgBytes.Length -gt 0)
    Assert-Test "Image size matches database record ($($imgDoc.size_bytes) bytes)" ($imgBytes.Length -eq $imgDoc.size_bytes)
}

# -------------------------------------------------------------------------
# Test Group 7: Download Unsupported Formats (DOCX, XLSX)
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 7: Unsupported Formats (DOCX, XLSX) Download ---"
if ($docxDoc) {
    $docxBytes = Get-StorageBytes "$SUPABASE_URL/storage/v1/object/authenticated/documents/$($docxDoc.file_path)" $userToken
    Assert-Test "DOCX downloaded via authenticated storage ($($docxBytes.Length) bytes)" ($docxBytes.Length -gt 0)
    Assert-Test "DOCX downloaded size matches database ($($docxDoc.size_bytes) bytes)" ($docxBytes.Length -eq $docxDoc.size_bytes)
    
    # Check OOXML PK zip header
    $first2Docx = [System.Text.Encoding]::ASCII.GetString($docxBytes, 0, [Math]::Min(2, $docxBytes.Length))
    Assert-Test "DOCX contains valid PK ZIP container signature ($first2Docx)" ($first2Docx -eq "PK")
}

if ($xlsxDoc) {
    $xlsxBytes = Get-StorageBytes "$SUPABASE_URL/storage/v1/object/authenticated/documents/$($xlsxDoc.file_path)" $userToken
    Assert-Test "XLSX downloaded via authenticated storage ($($xlsxBytes.Length) bytes)" ($xlsxBytes.Length -gt 0)
    Assert-Test "XLSX downloaded size matches database ($($xlsxDoc.size_bytes) bytes)" ($xlsxBytes.Length -eq $xlsxDoc.size_bytes)
    
    $first2Xlsx = [System.Text.Encoding]::ASCII.GetString($xlsxBytes, 0, [Math]::Min(2, $xlsxBytes.Length))
    Assert-Test "XLSX contains valid PK ZIP container signature ($first2Xlsx)" ($first2Xlsx -eq "PK")
}

# -------------------------------------------------------------------------
# Test Group 8: Download Multiple Documents Individually
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 8: Download Multiple Documents Individually ---"
$sampleDocs = $docs | Select-Object -First 4
$downloadResults = @{}
foreach ($d in $sampleDocs) {
    $dBytes = Get-StorageBytes "$SUPABASE_URL/storage/v1/object/authenticated/documents/$($d.file_path)" $userToken
    $downloadResults[$d.id] = @{
        name = $d.name
        size = $dBytes.Length
    }
}
Assert-Test "All 4 individual downloads returned data" (($downloadResults.Values | Where-Object { $_.size -gt 0 }).Count -eq 4)
foreach ($d in $sampleDocs) {
    $actualSize = $downloadResults[$d.id].size
    Assert-Test "Doc $($d.id) ($($d.name)) matches exact size ($actualSize bytes)" ($actualSize -eq $d.size_bytes)
}

# -------------------------------------------------------------------------
# Test Group 9: Invalid Document Path Handling
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 9: Invalid Document Path Handling ---"
try {
    $badSign = Invoke-RestMethod -Uri "$SUPABASE_URL/storage/v1/object/sign/documents/non_existent_folder/fake_file.pdf" -Headers $userHeaders -Method Post -Body (@{ expiresIn = 300 } | ConvertTo-Json)
    Assert-Test "Invalid path should not return valid signedURL" ($null -eq $badSign.signedURL)
} catch {
    Assert-Test "Invalid path correctly rejected by Supabase Storage ($($_.Exception.Message))" $true
}

# -------------------------------------------------------------------------
# Test Group 10: Unauthorized Access Security
# -------------------------------------------------------------------------
Write-Output "`n--- Test Group 10: Unauthorized Access Security ---"
$anonHeaders = @{ apikey = $SUPABASE_ANON_KEY; "Content-Type" = "application/json" }
$anonList = Invoke-RestMethod -Uri "$SUPABASE_URL/storage/v1/object/list/documents" -Headers $anonHeaders -Method Post -Body '{"prefix":"","limit":10}'
Assert-Test "Unauthenticated anon client cannot list private documents (returned 0 items)" ($anonList.Count -eq 0)

try {
    $anonBytes = Get-StorageBytes "$SUPABASE_URL/storage/v1/object/authenticated/documents/$($pdfDoc.file_path)"
    Assert-Test "Unauthenticated direct access to private object should be blocked" $false
} catch {
    Assert-Test "Unauthenticated direct access correctly blocked ($($_.Exception.Message))" $true
}

# -------------------------------------------------------------------------
# SUMMARY
# -------------------------------------------------------------------------
Write-Output "`n==================================================================="
Write-Output "  FINAL RESULT: $passed PASSED, $failed FAILED"
Write-Output "==================================================================="

if ($failed -gt 0) {
    exit 1
} else {
    exit 0
}
