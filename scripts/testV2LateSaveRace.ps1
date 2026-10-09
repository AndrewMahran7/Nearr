# Local-only two-session conversion versus stale/new anonymous save creation.
param([string]$SourceDatabase='nearr_ordered_rehearsal_20261009',[int]$Port=55458)
$ErrorActionPreference='Stop'
if($SourceDatabase -notin @('nearr_ordered_rehearsal_20261009','nearr_release_migrated_20261009') -or $Port -ne 55458){throw 'Local qualified rehearsal only'}
$database='nearr_late_save_'+[guid]::NewGuid().ToString('N').Substring(0,12)
$created=$false
function New-Id {[guid]::NewGuid().ToString()}
function Invoke-Sql([string]$sql){
  $o=& psql -h 127.0.0.1 -p $Port -U postgres -d $database -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
  if($LASTEXITCODE -ne 0){throw "Local SQL failed: $($o|Out-String)"}
  ($o|Out-String).Trim()
}
$runner={param($db,$pgPort,$sql,$side)
  $o=& psql -h 127.0.0.1 -p $pgPort -U postgres -d $db -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
  [pscustomobject]@{Side=$side;Exit=$LASTEXITCODE;Output=($o|Out-String).Trim()}
}
function New-Grant($number){
  $a=New-Id;$b=New-Id;$place=New-Id;$save=New-Id;$session=New-Id
  $secret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a',true),('$b',false); insert into public.places(id,name,latitude,longitude) values ('$place','late-save-$number',1,1); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session','$a','$a','anonymous_active')" | Out-Null
  Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer_v2('$session','$secret'); commit" | Out-Null
  [pscustomobject]@{A=$a;B=$b;Place=$place;Save=$save;Secret=$secret}
}
function Complete-Sql($f){
  "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$($f.B)',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$($f.B)','is_anonymous',false)::text,true); select public.complete_onboarding_account_transfer_v2('$($f.Secret)'); commit"
}
try{
  & createdb -h 127.0.0.1 -p $Port -U postgres -T $SourceDatabase $database
  if($LASTEXITCODE -ne 0){throw 'Clone failed'}
  $created=$true
  Invoke-Sql @'
create function public.test_late_save_delay() returns trigger language plpgsql as $$
begin
  if new.status='completed' then perform pg_sleep(2); end if;
  return new;
end $$;
create trigger test_late_save_delay before update of status
  on public.onboarding_account_transfer_grants for each row
  execute function public.test_late_save_delay();
'@ | Out-Null

  $f=New-Grant 1
  $transfer=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,(Complete-Sql $f),'transfer'
  $insert="select pg_sleep(0.2); insert into public.saved_places(id,user_id,place_id) values ('$($f.Save)','$($f.A)','$($f.Place)')"
  $writer=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$insert,'insert'
  try{$pair=@(Receive-Job -Job @($transfer,$writer) -Wait)}finally{Remove-Job -Job @($transfer,$writer) -Force -ErrorAction SilentlyContinue}
  $tr=$pair|Where-Object {$_.Side -eq 'transfer'}
  $wr=$pair|Where-Object {$_.Side -eq 'insert'}
  if($tr.Exit -ne 0 -or $wr.Exit -eq 0 -or $wr.Output -notmatch 'converted_anonymous_save_read_only'){
    throw "Transfer-first save race failed: $($pair|ConvertTo-Json -Compress)"
  }
  if((Invoke-Sql "select count(*) from public.saved_places where id='$($f.Save)'") -ne '0'){
    throw 'Stale anonymous save committed after conversion'
  }
  Write-Output 'transfer-first stale save rejected PASS'

  $f2=New-Grant 2
  $insertFirst="begin; insert into public.saved_places(id,user_id,place_id) values ('$($f2.Save)','$($f2.A)','$($f2.Place)'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$($f2.Save)','$($f2.A)','fixture:late-save-source',1,'link','new','https://example.invalid/late-save',true); select pg_advisory_xact_lock(987655); select pg_sleep(2); commit"
  $writer=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$insertFirst,'insert'
  $seen=$false
  for($poll=0;$poll -lt 50;$poll++){
    if((Invoke-Sql "select count(*) from pg_locks where locktype='advisory' and classid=0 and objid=987655 and granted") -eq '1'){$seen=$true;break}
    Start-Sleep -Milliseconds 20
  }
  if(-not $seen){$diag=@(Receive-Job -Job $writer -Wait);throw "Save-first signal missing: $($diag|ConvertTo-Json -Compress)"}
  $transfer=Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,(Complete-Sql $f2),'transfer'
  try{$pair2=@(Receive-Job -Job @($transfer,$writer) -Wait)}finally{Remove-Job -Job @($transfer,$writer) -Force -ErrorAction SilentlyContinue}
  if(@($pair2|Where-Object {$_.Exit -ne 0}).Count -ne 0){throw "Save-first transfer failed: $($pair2|ConvertTo-Json -Compress)"}
  $state=Invoke-Sql "select (select count(*) from public.saved_places where id='$($f2.Save)' and user_id='$($f2.B)'),(select count(*) from public.saved_place_sources where saved_place_id='$($f2.Save)' and user_id='$($f2.B)' and identity_key='fixture:late-save-source'),(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id)"
  if($state -ne '1|1|0'){throw "Save-first graph wrong: $state"}
  Write-Output 'save-first new save and source transferred PASS'
}finally{
  if($created){& dropdb -h 127.0.0.1 -p $Port -U postgres $database; if($LASTEXITCODE -ne 0){Write-Warning 'Local clone cleanup failed'}}
}
