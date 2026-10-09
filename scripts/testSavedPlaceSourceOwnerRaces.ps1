# Real two-session races against a throwaway clone of the local post-repair
# Production restore with the candidate migrations installed. Never Production.
param(
  [string]$SourceDatabase = 'nearr_migration_rehearsal_20261009',
  [int]$Port = 55458,
  [int]$TransferIterations = 50,
  [int]$SourceIterations = 60,
  [int]$ChildFirstIterations = 50,
  [int]$DuplicateIterations = 50,
  [int]$SameSourceIterations = 50,
  [int]$AttachIterations = 50,
  [ValidateSet('all','duplicate','attach')][string]$Phase = 'all'
)
$ErrorActionPreference = 'Stop'
if ($SourceDatabase -ne 'nearr_migration_rehearsal_20261009' -or $Port -ne 55458 -or
    $TransferIterations -lt 50 -or $SourceIterations -lt 50 -or $ChildFirstIterations -lt 50 -or
    $DuplicateIterations -lt 50 -or $SameSourceIterations -lt 50 -or $AttachIterations -lt 50) {
  throw 'Harness requires the local rehearsal database on port 55458 and at least 50 iterations of each race.'
}
$database = 'nearr_owner_races_' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$created = $false
$timings = New-Object System.Collections.Generic.List[double]
$sourceCommittedBeforeTransfer = 0
$sourceRejectedAfterTransfer = 0

function New-Id { [guid]::NewGuid().ToString() }
function New-Secret { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
function Invoke-Sql([string]$sql) {
  $result = & psql -h 127.0.0.1 -p $Port -U postgres -d $database -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local SQL failed: $($result | Out-String)" }
  return ($result | Out-String).Trim()
}
function Invoke-Pair([string]$leftSql, [string]$rightSql) {
  $runner = {
    param($db, $pgPort, $sql, $side)
    $result = & psql -h 127.0.0.1 -p $pgPort -U postgres -d $db -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
    [pscustomobject]@{ Side=$side; Exit=$LASTEXITCODE; Output=($result | Out-String).Trim() }
  }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $left = Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$leftSql,'left'
  $right = Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$rightSql,'right'
  try {
    $result = @(Receive-Job -Job @($left,$right) -Wait)
    if ($result.Count -ne 2) { throw 'Two PostgreSQL sessions did not return.' }
    $timer.Stop()
    $timings.Add($timer.Elapsed.TotalMilliseconds)
    return $result
  } finally {
    Remove-Job -Job @($left,$right) -Force -ErrorAction SilentlyContinue
  }
}
function Invoke-ChildFirstPair([string]$transferSql, [string]$childSql, [int]$signalKey) {
  $runner = {
    param($db, $pgPort, $sql, $side)
    $result = & psql -h 127.0.0.1 -p $pgPort -U postgres -d $db -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
    [pscustomobject]@{ Side=$side; Exit=$LASTEXITCODE; Output=($result | Out-String).Trim() }
  }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $right = Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$childSql,'right'
  $left = $null
  try {
    $seen = $false
    for ($poll=0; $poll -lt 50; $poll++) {
      if ((Invoke-Sql "select count(*) from pg_locks where locktype='advisory' and classid=0 and objid=$signalKey and granted") -eq '1') {
        $seen = $true
        break
      }
      Start-Sleep -Milliseconds 20
    }
    if (-not $seen) {
      $diagnostic = @(Receive-Job -Job $right -Wait)
      throw "Child-first transaction did not reach its post-insert signal: $($diagnostic | ConvertTo-Json -Compress)"
    }
    $left = Start-Job -ScriptBlock $runner -ArgumentList $database,$Port,$transferSql,'left'
    $result = @(Receive-Job -Job @($left,$right) -Wait)
    if ($result.Count -ne 2) { throw 'Child-first PostgreSQL sessions did not return.' }
    $timer.Stop()
    $timings.Add($timer.Elapsed.TotalMilliseconds)
    return $result
  } finally {
    if ($left) { Remove-Job -Job $left -Force -ErrorAction SilentlyContinue }
    Remove-Job -Job $right -Force -ErrorAction SilentlyContinue
  }
}
function Assert-Sql([string]$predicate, [string]$name) {
  if ((Invoke-Sql "select case when ($predicate) then '1' else '0' end") -ne '1') {
    throw "$name assertion failed: $predicate"
  }
}
function New-GrantFixture([int]$n) {
  $a=New-Id; $b=New-Id; $place=New-Id; $save=New-Id; $session=New-Id; $secret=New-Secret
  Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a',true),('$b',false); insert into public.places(id,name,latitude,longitude) values ('$place','fixture-owner-race-$n',1,1); insert into public.saved_places(id,user_id,place_id) values ('$save','$a','$place'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$save','$a','fixture:original:$n',1,'link','original','https://example.invalid/race/original/$n',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session','$a','$a','anonymous_active')" | Out-Null
  Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer_v2('$session','$secret'); commit" | Out-Null
  [pscustomobject]@{ A=$a; B=$b; Save=$save; Secret=$secret; Number=$n }
}
function Complete-Sql($fixture, [double]$delay=0) {
  "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$($fixture.B)',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$($fixture.B)','is_anonymous',false)::text,true); select pg_sleep($delay); select public.complete_onboarding_account_transfer_v2('$($fixture.Secret)')->>'replayed'; commit"
}

try {
  & createdb -h 127.0.0.1 -p $Port -U postgres -T $SourceDatabase $database
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone the local rehearsal database.' }
  $created = $true
  Invoke-Sql @'
create function public.test_owner_race_delay() returns trigger language plpgsql as $$
begin
  if new.status='completed' then perform pg_sleep(0.08); end if;
  return new;
end $$;
create trigger test_owner_race_delay before update of status
  on public.onboarding_account_transfer_grants for each row
  execute function public.test_owner_race_delay();
'@ | Out-Null
  $deadlocksBefore = [int](Invoke-Sql "select deadlocks from pg_stat_database where datname=current_database()")

  if($Phase -eq 'all') {
  # Two completions of the same grant must serialize, commit once, and replay.
  for ($i=1; $i -le $TransferIterations; $i++) {
    $f=New-GrantFixture $i
    $pair=Invoke-Pair (Complete-Sql $f) (Complete-Sql $f)
    if (@($pair | Where-Object { $_.Exit -ne 0 }).Count -ne 0 -or
        @($pair | Where-Object { $_.Output -match '(?m)^false$' }).Count -ne 1 -or
        @($pair | Where-Object { $_.Output -match '(?m)^true$' }).Count -ne 1) {
      throw "Transfer race $i failed: $($pair | ConvertTo-Json -Compress)"
    }
    Assert-Sql "(select count(*) from public.saved_places where id='$($f.Save)' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and user_id='$($f.B)')=1 and (select count(*) from public.onboarding_account_transfer_grants where source_user_id='$($f.A)' and status='completed')=1" "transfer $i"
    if ($i % 10 -eq 0) { Write-Output "simultaneous transfer grants: $i/$TransferIterations PASS" }
  }

  # Alternate writer order: transfer-first (late A insert must fail) and
  # child-first (committed A child must be swept by the FK cascade).
  for ($i=1; $i -le $SourceIterations; $i++) {
    $f=New-GrantFixture (1000+$i)
    $late='fixture:late:'+$i
    $insert="insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$($f.Save)','$($f.A)','$late',1,'link','late','https://example.invalid/race/late/$i',false)"
    if ($i % 2 -eq 1) {
      $pair=Invoke-Pair (Complete-Sql $f) "select pg_sleep(0.025); $insert"
    } else {
      $pair=Invoke-Pair (Complete-Sql $f 0.025) "begin; $insert; select pg_sleep(0.08); commit"
    }
    $transfer=$pair | Where-Object { $_.Side -eq 'left' }
    $writer=$pair | Where-Object { $_.Side -eq 'right' }
    if ($transfer.Exit -ne 0) { throw "Transfer/source race $i transfer failed: $($pair | ConvertTo-Json -Compress)" }
    if ($writer.Exit -ne 0 -and $writer.Output -notmatch 'saved_place_sources_owner_fk|saved_place_source_owner_mismatch') {
      throw "Transfer/source race $i writer failed unexpectedly: $($pair | ConvertTo-Json -Compress)"
    }
    if ($writer.Exit -eq 0) { $sourceCommittedBeforeTransfer++ } else { $sourceRejectedAfterTransfer++ }
    $expected=[int]($writer.Exit -eq 0)
    Assert-Sql "(select count(*) from public.saved_places where id='$($f.Save)' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='fixture:original:$($f.Number)' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$late' and user_id='$($f.B)')=$expected and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$late' and user_id='$($f.A)')=0" "source race $i"
    if ($i % 10 -eq 0) { Write-Output "transfer/source insert races: $i/$SourceIterations PASS" }
  }
  # Force the opposite order, rather than merely relying on startup timing:
  # the child session signals only after its INSERT has executed and while it
  # still holds the parent-key reference. Transfer starts while it sleeps.
  for ($i=1; $i -le $ChildFirstIterations; $i++) {
    $f=New-GrantFixture (2000+$i)
    $late='fixture:child-first:'+$i
    $signalKey=1000000+$i
    $insert="begin; insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$($f.Save)','$($f.A)','$late',1,'link','child-first','https://example.invalid/race/child-first/$i',false); select pg_advisory_xact_lock($signalKey); select pg_sleep(2); commit"
    $pair=Invoke-ChildFirstPair (Complete-Sql $f) $insert $signalKey
    if (@($pair | Where-Object { $_.Exit -ne 0 }).Count -ne 0) {
      throw "Child-first race $i failed: $($pair | ConvertTo-Json -Compress)"
    }
    Assert-Sql "(select count(*) from public.saved_places where id='$($f.Save)' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$late' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$late' and user_id='$($f.A)')=0" "child-first race $i"
    if ($i % 10 -eq 0) { Write-Output "forced child-first races: $i/$ChildFirstIterations PASS" }
  }
  }

  # Two distinct anonymous accounts merge the same place into B at once.
  if($Phase -in @('all','duplicate')) {
  for ($i=1; $i -le $DuplicateIterations; $i++) {
    $a1=New-Id; $a2=New-Id; $b=New-Id; $place=New-Id
    $sa1=New-Id; $sa2=New-Id; $sb=New-Id; $session1=New-Id; $session2=New-Id
    $secret1=New-Secret; $secret2=New-Secret
    Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a1',true),('$a2',true),('$b',false); insert into public.places(id,name,latitude,longitude) values ('$place','duplicate-race-$i',1,1); insert into public.saved_places(id,user_id,place_id) values ('$sa1','$a1','$place'),('$sa2','$a2','$place'),('$sb','$b','$place'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa1','$a1','fixture:dup:${i}:a1',1,'link','a1','https://example.invalid/dup/$i/a1',true),('$sa2','$a2','fixture:dup:${i}:a2',1,'link','a2','https://example.invalid/dup/$i/a2',true),('$sb','$b','fixture:dup:${i}:base',1,'link','base','https://example.invalid/dup/$i/base',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session1','$a1','$a1','anonymous_active'),('$session2','$a2','$a2','anonymous_active')" | Out-Null
    Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a1',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a1','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer_v2('$session1','$secret1'); commit" | Out-Null
    Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a2',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a2','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer_v2('$session2','$secret2'); commit" | Out-Null
    $pair=Invoke-Pair (Complete-Sql ([pscustomobject]@{B=$b;Secret=$secret1})) (Complete-Sql ([pscustomobject]@{B=$b;Secret=$secret2}))
    if (@($pair | Where-Object { $_.Exit -ne 0 }).Count -ne 0) {
      throw "Duplicate merge race $i failed: $($pair | ConvertTo-Json -Compress)"
    }
    $duplicateState=Invoke-Sql "select (select count(*) from public.saved_places where id in ('$sa1','$sa2','$sb')),(select count(*) from public.saved_place_sources where saved_place_id='$sb' and user_id='$b'),(select count(*) from public.saved_place_sources where saved_place_id in ('$sa1','$sa2')),(select count(*) from public.onboarding_account_transfer_grants where source_user_id in ('$a1','$a2') and status='completed')"
    if($duplicateState -ne '3|3|2|2'){
      $sources=Invoke-Sql "select saved_place_id,user_id,identity_key from public.saved_place_sources where saved_place_id in ('$sa1','$sa2','$sb') order by saved_place_id,identity_key"
      throw "Duplicate merge $i graph $duplicateState expected 3|3|2|2; links: $sources; pair: $($pair | ConvertTo-Json -Compress)"
    }
    if ($i % 10 -eq 0) { Write-Output "distinct duplicate merges: $i/$DuplicateIterations PASS" }
  }
  }

  if($Phase -eq 'all') {
  # Same canonical source arrives at B through a direct writer while V2 copies.
  for ($i=1; $i -le $SameSourceIterations; $i++) {
    $a=New-Id; $b=New-Id; $place=New-Id; $sa=New-Id; $sb=New-Id
    $session=New-Id; $secret=New-Secret; $identity='fixture:shared:'+$i
    Invoke-Sql "insert into auth.users(id,is_anonymous) values ('$a',true),('$b',false); insert into public.places(id,name,latitude,longitude) values ('$place','same-source-race-$i',1,1); insert into public.saved_places(id,user_id,place_id) values ('$sa','$a','$place'),('$sb','$b','$place'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa','$a','$identity',1,'link','shared','https://example.invalid/shared/$i',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session','$a','$a','anonymous_active')" | Out-Null
    Invoke-Sql "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$a',true); select set_config('request.jwt.claims',jsonb_build_object('sub','$a','is_anonymous',true)::text,true); select public.begin_onboarding_account_transfer_v2('$session','$secret'); commit" | Out-Null
    $insert="select pg_sleep(0.025); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sb','$b','$identity',1,'link','shared','https://example.invalid/shared/$i',true) on conflict (saved_place_id,identity_key) do nothing"
    $pair=Invoke-Pair (Complete-Sql ([pscustomobject]@{B=$b;Secret=$secret})) $insert
    if (@($pair | Where-Object { $_.Exit -ne 0 }).Count -ne 0) {
      throw "Same-source race $i failed: $($pair | ConvertTo-Json -Compress)"
    }
    Assert-Sql "(select count(*) from public.saved_place_sources where saved_place_id='$sb' and identity_key='$identity' and user_id='$b')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$sa' and identity_key='$identity' and user_id='$a')=1" "same-source race $i"
    if ($i % 10 -eq 0) { Write-Output "same-destination same-source races: $i/$SameSourceIterations PASS" }
  }
  }
  # The actual shared RPC is used by manual/client attachment and by the
  # recognition worker. Alternate authenticated and service-role sessions.
  if($Phase -in @('all','attach')) {
  for ($i=1; $i -le $AttachIterations; $i++) {
    $f=New-GrantFixture (4000+$i)
    $identity='fixture:attach:'+$i
    $rpc="select * from public.attach_saved_place_source('$($f.A)','$($f.Save)','$identity',1,'link','attached','https://example.invalid/race/attach/$i')"
    if($i % 2 -eq 1){
      $writer="select pg_sleep(0.025); begin; set local role authenticated; select set_config('request.jwt.claim.sub','$($f.A)',true); $rpc; commit"
      $transfer=Complete-Sql $f
    }else{
      $writer="begin; $rpc; select pg_sleep(0.08); commit"
      $transfer=Complete-Sql $f 0.025
    }
    $pair=Invoke-Pair $transfer $writer
    $tr=$pair|Where-Object {$_.Side -eq 'left'}
    $wr=$pair|Where-Object {$_.Side -eq 'right'}
    if($tr.Exit -ne 0 -or ($wr.Exit -ne 0 -and $wr.Output -notmatch 'saved_place_not_owned')){
      throw "Attach/transfer race $i failed: $($pair|ConvertTo-Json -Compress)"
    }
    $expected=[int]($wr.Exit -eq 0)
    Assert-Sql "(select count(*) from public.saved_places where id='$($f.Save)' and user_id='$($f.B)')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$identity' and user_id='$($f.B)')=$expected and (select count(*) from public.saved_place_sources where saved_place_id='$($f.Save)' and identity_key='$identity' and user_id='$($f.A)')=0" "attach race $i"
    if($i % 10 -eq 0){Write-Output "manual/worker RPC attach races: $i/$AttachIterations PASS"}
  }
  }
  Assert-Sql "(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id)=0" 'global owner invariant'
  $deadlocksAfter = [int](Invoke-Sql "select deadlocks from pg_stat_database where datname=current_database()")
  if ($deadlocksAfter -ne $deadlocksBefore) { throw "Deadlocks increased from $deadlocksBefore to $deadlocksAfter" }
  $sorted=@($timings | Sort-Object)
  $p95=$sorted[[Math]::Min($sorted.Count-1,[Math]::Ceiling($sorted.Count*0.95)-1)]
  [pscustomobject]@{
    phase=$Phase
    transferPairs=$(if($Phase -eq 'all'){$TransferIterations}else{0}); sourceInsertPairs=$(if($Phase -eq 'all'){$SourceIterations}else{0})
    forcedChildFirstPairs=$(if($Phase -eq 'all'){$ChildFirstIterations}else{0})
    distinctDuplicateMergePairs=$(if($Phase -in @('all','duplicate')){$DuplicateIterations}else{0})
    sameSourcePairs=$(if($Phase -eq 'all'){$SameSourceIterations}else{0})
    attachRpcPairs=$(if($Phase -in @('all','attach')){$AttachIterations}else{0})
    sourceCommittedAndCascaded=$sourceCommittedBeforeTransfer
    staleSourceRejected=$sourceRejectedAfterTransfer
    mismatches=0; deadlocks=$deadlocksAfter-$deadlocksBefore
    pairP95Ms=[Math]::Round($p95,1); pairMaxMs=[Math]::Round($sorted[-1],1)
  } | ConvertTo-Json -Compress
} finally {
  if ($created) {
    & dropdb -h 127.0.0.1 -p $Port -U postgres $database
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Local throwaway race database needs manual cleanup.' }
  }
}
