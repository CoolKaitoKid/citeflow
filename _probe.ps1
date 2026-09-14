$key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0'
$h=@{apikey=$key; Authorization="Bearer $key"}
$base='https://uforealazougjckepggc.supabase.co/rest/v1/'

function Req($path) {
  try {
    $resp = Invoke-WebRequest -Uri ($base+$path) -Headers $h -Method Get -ErrorAction Stop
    return @{ ok=$true; code=[int]$resp.StatusCode; body=$resp.Content }
  } catch {
    $body=''
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body=$sr.ReadToEnd() } catch {}
    return @{ ok=$false; code=[int]$_.Exception.Response.StatusCode; body=$body }
  }
}

# Column existence + type probe. Returns: MISSING | type name | EXISTS(untypeable)
function ColType($table,$col) {
  $r = Req "$table`?$col=eq.__zz__&select=$col&limit=1"
  if ($r.body -match 'does not exist') { return 'MISSING' }
  if ($r.body -match 'invalid input syntax for type (\w+)') { return $matches[1] }
  if ($r.body -match 'operator does not exist') { return 'EXISTS(odd-type)' }
  if ($r.ok) { return 'text-ish' }
  return "EXISTS? " + ($r.body -replace '\s+',' ').Substring(0,[Math]::Min(120,$r.body.Length))
}

$spec = [ordered]@{
 'wf_submissions' = @('id','task_id','faculty_id','status','approval_stage','submitted_at','reviewed_at','reviewed_by','reviewed_by_name','review_remarks','remarks','admin_feedback','is_late','submitted_status','resubmission_count','last_reviewed_by_role','final_approved_at','final_approved_by_name','final_approval_remarks','created_at','updated_at')
 'wf_submission_files' = @('id','submission_id','task_id','faculty_id','file_name','file_path','file_url','storage_path','file_size','mime_type','uploaded_at','mfo_section','mfo_indicator','mfo_record_id','mfo_packet_id','mfo_program_packet_id','mfo_caption','mfo_sort_order','mfo_documentation_id')
 'wf_tasks' = @('id','title','description','instructions','category','priority','due_date','due_at','deadline_at','target_scope','status','requires_file','allowed_file_types','report_config_id','assigned_type','task_layout','requires_chairperson_review','created_by','created_by_name','assigned_by_name','created_at')
 'wf_task_assignments' = @('id','task_id','faculty_id','assigned_at')
 'wf_approval_history' = @('id','submission_id','task_id','faculty_id','actor_name','actor_role','action','status','comment','created_at')
 'wf_delegated_access' = @('id','grantor_id','grantee_id','task_id','is_active','granted_at','grantee_name','grantee_faculty_id','grantee_auth_user_id','grantee_email','department_codes','granted_by_name','starts_at','ends_at','valid_from','valid_until')
 'wf_report_configs' = @('id','report_name','requires_chairperson_review','requires_final_approval','is_active','created_at')
 'wf_comments' = @('id','task_id','faculty_id','author_id','author_name','content','body','created_at')
 'wf_notifications' = @('id','user_id','faculty_id','task_id','submission_id','type','title','message','is_read','meta','created_at')
 'wf_activity_log' = @('id','actor_id','actor_name','action','target','log_type','details','created_at')
 'faculty' = @('id','auth_user_id','employee_id','full_name','name','email','existing_email','department','department_code','position','role','admin_access','status','profile_completed')
 'admin_profiles' = @('id','email','full_name','role','department','status')
 'mfo_packets' = @('id','submission_id','task_id','report_config_id','faculty_id','department','packet_state','period_start','period_end','signature_url','signature_data','signed_by_name','signed_at')
 'mfo_documentation_items' = @('id','packet_id','program_packet_id','faculty_id','section_code','caption','narrative','title','venue','activity_time','activity_date','record_table','record_id','is_not_applicable','field_sources','sort_order')
 'mfo_snapshots' = @('id','packet_id','version_no','lifecycle_state','snapshot_reason','payload','created_by_faculty_id','created_at')
 'mfo_section_status' = @('id','packet_id','program_packet_id','section_code','is_not_applicable','completeness')
}

$out = New-Object System.Collections.Generic.List[string]
foreach ($t in $spec.Keys) {
  $head = Req "$t`?select=*&limit=1"
  if ($head.body -match 'relation .* does not exist' -or $head.code -eq 404) {
    $out.Add("### $t  -> TABLE MISSING/NOT EXPOSED  ($($head.code)) $($head.body)")
    continue
  }
  $out.Add("### $t   [read:$($head.code)]")
  foreach ($c in $spec[$t]) {
    $ty = ColType $t $c
    if ($ty -eq 'MISSING') { $out.Add("    - $c : *** MISSING ***") }
    else { $out.Add("    - $c : $ty") }
  }
  $out.Add("")
}
$out -join "`n" | Out-File -Encoding utf8 C:\Users\ADMIN\citeflow\_live_schema.txt
Write-Output ($out -join "`n")
