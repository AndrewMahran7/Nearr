# Local-only V1 two-session duplicate-save transfer versus a late A source write.
param([string]$SourceDatabase='nearr_ordered_rehearsal_20261009',[int]$Port=55458)
$ErrorActionPreference='Stop'
if($SourceDatabase -notin @('nearr_ordered_rehearsal_20261009','nearr_release_migrated_20261009') -or $Port -ne 55458){throw 'Local qualified rehearsal only'}
$database='nearr_v1_duplicate_late_'+[guid]::NewGuid().ToString('N').Substring(0,12)
$created=$false
function New-Id {[guid]::NewGuid().ToString()}
function Invoke-Sql([string]$sql){
  $o=& psql -h 127.0.0.1 -p $Port -U postgres -d $database -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
  if($LASTEXITCODE -ne 0){throw "Local SQL failed: $($o | Out-String)"}
  ($o | Out-String).Trim()
}
try{
  & createdb -h 127.0.0.1 -p $Port -U postgres -T $SourceDatabase $database
  if($LASTEXITCODE -ne 0){throw 'Clone failed'}
  $created=$true
  Invoke-Sql @'
create function public.test_duplicate_transfer_delay() returns trigger language plpgsql as $$
begin
  if new.status='completed' then perform pg_sleep(2); end if;
  return new;
end $$;
create trigger test_duplicate_transfer_delay before update of status
  on public.onboarding_account_transfer_grants for each row
  execute function public.test_duplicate_transfer_delay();
'@ | Out-Null
  $a=New-Id;$b=New-Id;$place=New-Id;$sa=New-Id;$sb=New-Id;$session=New-Id
  $secret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a',true),('$b',false); insert into public.places(id,name,latitude,longitude) values ('$place','duplicate-late-race',1,1); insert into public.saved_places(id,user_id,place_id) values ('$sa','$a','$place'),('$sb','$b','$place'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa','$a','fixture:original',1,'link','original','https://example.invalid/original',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,tutorial_saved_place_id,lifecycle) values ('$session','$a','$a','$sa','anonymous_active')" | Out-Null
  Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer('$session','$secret'); commit" | Out-Null
  $runner={param($db,$pgPort,$sql,$side)
    $o=& psql -h 127.0.0.1 -p $pgPort -U postgres -d $db -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
    [pscustomobject]@{Side=$side;Exit=$LASTEXITCODE;Output=($o|Out-String).Trim()}
  }
  $transfer="begin; set local role authenticated; select set_config('request.jwt.claim.sub','$b',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$b','is_anonymous',false)::text,true); select public.complete_onboarding_account_transfer('$secret'); commit"
  $insert="select pg_sleep(0.2); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa','$a','fixture:late',1,'link','late','https://example.invalid/late',false)"
  $left=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$transfer,'transfer'
  $right=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$insert,'insert'
  try{$pair=@(Receive-Job -Job @($left,$right) -Wait)}finally{Remove-Job -Job @($left,$right) -Force -ErrorAction SilentlyContinue}
  $transferResult=$pair|Where-Object {$_.Side -eq 'transfer'}
  $insertResult=$pair|Where-Object {$_.Side -eq 'insert'}
  if($transferResult.Exit -ne 0){throw "Transfer failed: $($pair|ConvertTo-Json -Compress)"}
  if($insertResult.Exit -ne 0 -and $insertResult.Output -notmatch 'converted_source_account_read_only|saved_place_source_owner_mismatch|saved_place_sources_owner_fk'){
    throw "Unexpected insert failure: $($pair|ConvertTo-Json -Compress)"
  }
  $diag=Invoke-Sql "select jsonb_build_object('late_a',(select count(*) from public.saved_place_sources where saved_place_id='$sa' and identity_key='fixture:late' and user_id='$a'),'late_b',(select count(*) from public.saved_place_sources where saved_place_id='$sb' and identity_key='fixture:late' and user_id='$b'),'mismatch',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id))::text"
  Write-Output "insertExit=$($insertResult.Exit) result=$diag"
  if($insertResult.Exit -eq 0 -and $diag -notmatch '"late_b": 1'){
    throw 'A late source committed after duplicate conversion without reaching B.'
  }
  if($diag -notmatch '"mismatch": 0'){throw 'Ownership mismatch after duplicate race.'}
  Write-Output 'duplicate transfer-first late-source rejection PASS'

  # Opposite order: the source commits before the duplicate conversion can
  # lock A's parent. V2 must see and copy that newly committed identity to B.
  $a2=New-Id;$b2=New-Id;$place2=New-Id;$sa2=New-Id;$sb2=New-Id;$session2=New-Id
  $secret2=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a2',true),('$b2',false); insert into public.places(id,name,latitude,longitude) values ('$place2','duplicate-child-first',2,2); insert into public.saved_places(id,user_id,place_id) values ('$sa2','$a2','$place2'),('$sb2','$b2','$place2'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa2','$a2','fixture:original-second',1,'link','original','https://example.invalid/original-second',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,tutorial_saved_place_id,lifecycle) values ('$session2','$a2','$a2','$sa2','anonymous_active')" | Out-Null
  Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a2',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a2','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer('$session2','$secret2'); commit" | Out-Null
  $childFirst="begin; insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa2','$a2','fixture:late-second',1,'link','late','https://example.invalid/late-second',false); select pg_advisory_xact_lock(987654); select pg_sleep(2); commit"
  $transferSecond="begin; set local role authenticated; select set_config('request.jwt.claim.sub','$b2',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$b2','is_anonymous',false)::text,true); select public.complete_onboarding_account_transfer('$secret2'); commit"
  $right=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$childFirst,'insert'
  $seen=$false
  for($poll=0;$poll -lt 50;$poll++){
    if((Invoke-Sql "select count(*) from pg_locks where locktype='advisory' and classid=0 and objid=987654 and granted") -eq '1'){$seen=$true;break}
    Start-Sleep -Milliseconds 20
  }
  if(-not $seen){$diagnostic=@(Receive-Job -Job $right -Wait);throw "Child-first duplicate signal missing: $($diagnostic|ConvertTo-Json -Compress)"}
  $left=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$transferSecond,'transfer'
  try{$pair2=@(Receive-Job -Job @($left,$right) -Wait)}finally{Remove-Job -Job @($left,$right) -Force -ErrorAction SilentlyContinue}
  if(@($pair2|Where-Object {$_.Exit -ne 0}).Count -ne 0){throw "Child-first duplicate transfer failed: $($pair2|ConvertTo-Json -Compress)"}
  $diag2=Invoke-Sql "select jsonb_build_object('late_a',(select count(*) from public.saved_place_sources where saved_place_id='$sa2' and identity_key='fixture:late-second' and user_id='$a2'),'late_b',(select count(*) from public.saved_place_sources where saved_place_id='$sb2' and identity_key='fixture:late-second' and user_id='$b2'),'mismatch',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id))::text"
  if($diag2 -notmatch '"late_a": 1' -or $diag2 -notmatch '"late_b": 1' -or $diag2 -notmatch '"mismatch": 0'){
    throw "Child-first duplicate source not copied: $diag2"
  }
  Write-Output "duplicate child-first source copy PASS $diag2"
}finally{
  if($created){ & dropdb -h 127.0.0.1 -p $Port -U postgres $database; if($LASTEXITCODE -ne 0){Write-Warning 'Local clone cleanup failed'} }
}
