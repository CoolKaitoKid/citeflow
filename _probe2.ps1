$key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0'
$h=@{apikey=$key; Authorization="Bearer $key"}
$base='https://uforealazougjckepggc.supabase.co/rest/v1/'

function Req($path) {
  try {
    $resp = Invoke-WebRequest -Uri ($base+$path) -Headers $h -Method Get -ErrorAction Stop
    return @{ ok=$true; code=[int]$resp.StatusCode; body=$resp.Content }
  } catch {
    $body=''
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body=$sr.ReadToEnd() } catch { $body='<unreadable>' }
    return @{ ok=$false; code=[int]$_.Exception.Response.StatusCode; body=$body }
  }
}

"===== 1. wf_submission_status enum members (eq filter accepted => valid member) ====="
$cands = @('notsubmitted','submitted','late','underreview','pending','approved','rejected','revision','declined','resubmitted',
           'Pending Review','Under Review','Approved','Rejected','Revisions Requested')
foreach($v in $cands){
  $r = Req ("wf_submissions?status=eq." + [uri]::EscapeDataString($v) + "&select=id&limit=1")
  if ($r.ok) { "  VALID   '$v'" }
  elseif ($r.body -match 'invalid input value for enum') { "  invalid '$v'" }
  else { "  ?       '$v'  -> $($r.code) $($r.body)" }
}

"`n===== 2. approval_stage distinct-ish probe (text column, so all accepted) ====="
"  (approval_stage is text; no enum constraint)"

"`n===== 3. Ambiguous columns re-probe (existence only, via select=) ====="
$amb = @(
 @('wf_tasks','description'),@('wf_tasks','category'),@('wf_tasks','priority'),@('wf_tasks','target_scope'),
 @('wf_tasks','status'),@('wf_tasks','task_layout'),
 @('wf_comments','author_id'),@('wf_comments','content'),
 @('wf_notifications','meta'),@('wf_activity_log','target'),
 @('admin_profiles','status'),@('mfo_packets','signed_at'),
 @('wf_submissions','status')
)
foreach($p in $amb){
  $r = Req "$($p[0])`?select=$($p[1])&limit=1"
  if ($r.ok) { "  $($p[0]).$($p[1]) : EXISTS  body=$($r.body)" }
  else { "  $($p[0]).$($p[1]) : $($r.code) $(($r.body -replace '\s+',' '))" }
}

"`n===== 4. What can ANON actually read? (row counts) ====="
$tabs = @('faculty','admin_profiles','wf_submissions','wf_submission_files','wf_tasks','wf_task_assignments',
          'wf_approval_history','wf_delegated_access','wf_report_configs','wf_comments','wf_notifications',
          'wf_activity_log','mfo_packets','mfo_documentation_items','mfo_snapshots')
foreach($t in $tabs){
  try {
    $resp = Invoke-WebRequest -Uri ($base+$t+'?select=*&limit=1') -Headers ($h + @{Prefer='count=exact'; Range='0-0'}) -Method Get -ErrorAction Stop
    $cr = $resp.Headers['Content-Range']
    "  $t : count=$cr  sample_len=$($resp.Content.Length)"
  } catch {
    $b=''; try { $sr=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $b=$sr.ReadToEnd() } catch {}
    "  $t : ERR $([int]$_.Exception.Response.StatusCode) $(($b -replace '\s+',' '))"
  }
}

"`n===== 5. RPC availability (anon, unauthenticated) ====="
$rpcs = @('wf_chairperson_sql_version','mfo_sql_version','wf_current_user_has_chairperson_grant',
          'wf_list_chairperson_submissions','wf_debug_chairperson_queue','wf_debug_chairperson_visibility',
          'wf_debug_final_approver','wf_is_final_approver','wf_submission_needs_chairperson_grant',
          'wf_department_has_chairperson_grant','mfo_ensure_faculty_packet')
foreach($r in $rpcs){
  try {
    $resp = Invoke-WebRequest -Uri ($base+'rpc/'+$r) -Headers $h -Method Post -Body '{}' -ContentType 'application/json' -ErrorAction Stop
    "  $r : OK $($resp.Content.Substring(0,[Math]::Min(300,$resp.Content.Length)))"
  } catch {
    $b=''; try { $sr=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $b=$sr.ReadToEnd() } catch {}
    "  $r : $([int]$_.Exception.Response.StatusCode) $(($b -replace '\s+',' ').Substring(0,[Math]::Min(220,$b.Length)))"
  }
}
