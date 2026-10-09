# Two-connection PostgreSQL V2 transfer races on an isolated clone of the
# restored post-repair database. Never point this at Production.
param(
  [string]$SourceDatabase = 'nearr_postrepair_20261009',
  [int]$Port = 55458
)
$ErrorActionPreference = 'Continue'
if ($SourceDatabase -notmatch '^nearr_postrepair_[0-9]{8}$' -or $Port -ne 55458) {
  throw 'This harness is restricted to the local post-repair restore on port 55458.'
}
$database = 'nearr_v2_concurrency_' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$created = $false

function New-TestId { [guid]::NewGuid().ToString() }
function New-TestSecret { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
function Invoke-TestSql([string]$sql) {
  $output = & psql -h 127.0.0.1 -p $Port -U postgres -d $database -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local concurrency SQL failed: $($output | Out-String)" }
  return ($output | Out-String).Trim()
}
function New-TransferSql([string]$destination, [string]$secret) {
  return "begin; set local role authenticated; set local request.jwt.claim.sub='$destination'; select set_config('request.jwt.claims',jsonb_build_object('sub','$destination','is_anonymous',false)::text,true) is not null; select pg_sleep(1); select public.complete_onboarding_account_transfer_v2('$secret')->>'replayed'; commit;"
}
function Invoke-Pair([string]$leftSql, [string]$rightSql) {
  $script = {
    param($db, $pgPort, $sql, $side)
    $output = & psql -h 127.0.0.1 -p $pgPort -U postgres -d $db -X -q -tA -v ON_ERROR_STOP=1 -c $sql 2>&1
    [pscustomobject]@{ Side=$side; Exit=$LASTEXITCODE; Output=($output | Out-String).Trim() }
  }
  $left = Start-Job -ScriptBlock $script -ArgumentList $database,$Port,$leftSql,'left'
  $right = Start-Job -ScriptBlock $script -ArgumentList $database,$Port,$rightSql,'right'
  try {
    $results = @(Receive-Job -Job @($left,$right) -Wait)
    if ($results.Count -ne 2) { throw 'Two-session harness did not return two results.' }
    return $results
  } finally {
    Remove-Job -Job @($left,$right) -Force -ErrorAction SilentlyContinue
  }
}
function Assert-Local([string]$sql, [string]$label) {
  if ((Invoke-TestSql $sql) -ne '1') { throw "$label assertion failed." }
}

try {
  & createdb -h 127.0.0.1 -p $Port -U postgres -T $SourceDatabase $database
  if ($LASTEXITCODE -ne 0) { throw 'Could not create local concurrency clone.' }
  $created = $true
  Invoke-TestSql @'
create function public.test_v2_concurrency_delay() returns trigger language plpgsql as $$
begin
  if new.status='completed' then perform pg_sleep(2); end if;
  return new;
end $$;
create trigger test_v2_concurrency_delay before update of status
  on public.onboarding_account_transfer_grants for each row
  execute function public.test_v2_concurrency_delay();
'@ | Out-Null

  # Case 1: two identical attempts must serialize on the same grant.
  $a1=New-TestId; $b1=New-TestId; $p1=New-TestId; $s1=New-TestId; $session1=New-TestId
  $secret1=New-TestSecret
  Invoke-TestSql "insert into auth.users(id,is_anonymous) values ('$a1',true),('$b1',false); insert into public.places(id,name,latitude,longitude) values ('$p1','fixture-concurrent-unique',1,1); insert into public.saved_places(id,user_id,place_id) values ('$s1','$a1','$p1'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$s1','$a1','fixture-concurrent:unique',1,'link','unique','https://example.invalid/concurrent/unique',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session1','$a1','$a1','anonymous_active');" | Out-Null
  Invoke-TestSql "begin; set local role authenticated; set local request.jwt.claim.sub='$a1'; select set_config('request.jwt.claims',jsonb_build_object('sub','$a1','is_anonymous',true)::text,true) is not null; select public.begin_onboarding_account_transfer_v2('$session1','$secret1'); commit;" | Out-Null
  $pair1=Invoke-Pair (New-TransferSql $b1 $secret1) (New-TransferSql $b1 $secret1)
  if (@($pair1 | Where-Object { $_.Exit -ne 0 }).Count -ne 0 -or
      @($pair1 | Where-Object { $_.Output -match 'false' }).Count -ne 1 -or
      @($pair1 | Where-Object { $_.Output -match 'true' }).Count -ne 1) {
    throw "Identical transfer race failed: $($pair1 | ConvertTo-Json -Compress)"
  }
  Assert-Local "select 1 / case when (select count(*) from public.saved_places where id='$s1' and user_id='$b1')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$s1' and user_id='$b1')=1 and (select count(*) from public.saved_place_sources x join public.saved_places p on p.id=x.saved_place_id where x.user_id<>p.user_id)=0 then 1 else 0 end" 'identical transfer'
  Write-Output 'identical transfer: PASS'

  # Case 2: two different anonymous sources merge into one destination save.
  $a2=New-TestId; $a3=New-TestId; $b2=New-TestId; $p2=New-TestId
  $sa2=New-TestId; $sa3=New-TestId; $sb2=New-TestId
  $session2=New-TestId; $session3=New-TestId; $secret2=New-TestSecret; $secret3=New-TestSecret
  Invoke-TestSql "insert into auth.users(id,is_anonymous) values ('$a2',true),('$a3',true),('$b2',false); insert into public.places(id,name,latitude,longitude) values ('$p2','fixture-concurrent-duplicate',2,2); insert into public.saved_places(id,user_id,place_id) values ('$sa2','$a2','$p2'),('$sa3','$a3','$p2'),('$sb2','$b2','$p2'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa2','$a2','fixture-concurrent:a2',1,'link','a2','https://example.invalid/concurrent/a2',true),('$sa3','$a3','fixture-concurrent:a3',1,'link','a3','https://example.invalid/concurrent/a3',true),('$sb2','$b2','fixture-concurrent:base',1,'link','base','https://example.invalid/concurrent/base',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session2','$a2','$a2','anonymous_active'),('$session3','$a3','$a3','anonymous_active');" | Out-Null
  Invoke-TestSql "begin; set local role authenticated; set local request.jwt.claim.sub='$a2'; select set_config('request.jwt.claims',jsonb_build_object('sub','$a2','is_anonymous',true)::text,true) is not null; select public.begin_onboarding_account_transfer_v2('$session2','$secret2'); commit;" | Out-Null
  Invoke-TestSql "begin; set local role authenticated; set local request.jwt.claim.sub='$a3'; select set_config('request.jwt.claims',jsonb_build_object('sub','$a3','is_anonymous',true)::text,true) is not null; select public.begin_onboarding_account_transfer_v2('$session3','$secret3'); commit;" | Out-Null
  $pair2=Invoke-Pair (New-TransferSql $b2 $secret2) (New-TransferSql $b2 $secret3)
  if (@($pair2 | Where-Object { $_.Exit -ne 0 }).Count -ne 0 -or
      @($pair2 | Where-Object { $_.Output -match 'false' }).Count -ne 2) {
    throw "Concurrent duplicate merges failed: $($pair2 | ConvertTo-Json -Compress)"
  }
  Assert-Local "select 1 / case when (select count(*) from public.saved_places where id in ('$sa2','$sa3','$sb2'))=3 and (select count(*) from public.saved_place_sources where saved_place_id='$sb2' and user_id='$b2')=3 and (select count(*) from public.saved_place_sources where saved_place_id in ('$sa2','$sa3'))=2 and (select count(*) from public.saved_place_sources x join public.saved_places p on p.id=x.saved_place_id where x.user_id<>p.user_id)=0 then 1 else 0 end" 'duplicate merge'
  Write-Output 'duplicate merge: PASS'

  # Case 3: an independent destination insert of the same canonical identity
  # races the copy. ON CONFLICT must leave exactly one destination association.
  $a4=New-TestId; $b3=New-TestId; $p3=New-TestId; $sa4=New-TestId; $sb3=New-TestId
  $session4=New-TestId; $secret4=New-TestSecret
  Invoke-TestSql "insert into auth.users(id,is_anonymous) values ('$a4',true),('$b3',false); insert into public.places(id,name,latitude,longitude) values ('$p3','fixture-concurrent-destination-race',3,3); insert into public.saved_places(id,user_id,place_id) values ('$sa4','$a4','$p3'),('$sb3','$b3','$p3'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa4','$a4','fixture-concurrent:race',1,'link','race','https://example.invalid/concurrent/race',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session4','$a4','$a4','anonymous_active');" | Out-Null
  Invoke-TestSql "begin; set local role authenticated; set local request.jwt.claim.sub='$a4'; select set_config('request.jwt.claims',jsonb_build_object('sub','$a4','is_anonymous',true)::text,true) is not null; select public.begin_onboarding_account_transfer_v2('$session4','$secret4'); commit;" | Out-Null
  $raceInsert="select pg_sleep(1); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sb3','$b3','fixture-concurrent:race',1,'link','race','https://example.invalid/concurrent/race',true) on conflict (saved_place_id,identity_key) do nothing; select 'insert_done';"
  $pair3=Invoke-Pair (New-TransferSql $b3 $secret4) $raceInsert
  if (@($pair3 | Where-Object { $_.Exit -ne 0 }).Count -ne 0) {
    throw "Destination source race failed: $($pair3 | ConvertTo-Json -Compress)"
  }
  Assert-Local "select 1 / case when (select count(*) from public.saved_place_sources where saved_place_id='$sb3' and identity_key='fixture-concurrent:race' and user_id='$b3')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$sa4' and identity_key='fixture-concurrent:race' and user_id='$a4')=1 then 1 else 0 end" 'destination source race'
  Write-Output 'destination source race: PASS'

  # Case 4: a source association added to A while the unique save moves must
  # either join the transfer or be rejected by the owner guard, never split.
  $a5=New-TestId; $b4=New-TestId; $p4=New-TestId; $sa5=New-TestId
  $session5=New-TestId; $secret5=New-TestSecret
  Invoke-TestSql "insert into auth.users(id,is_anonymous) values ('$a5',true),('$b4',false); insert into public.places(id,name,latitude,longitude) values ('$p4','fixture-concurrent-source-race',4,4); insert into public.saved_places(id,user_id,place_id) values ('$sa5','$a5','$p4'); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa5','$a5','fixture-concurrent:original',1,'link','original','https://example.invalid/concurrent/original',true); insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle) values ('$session5','$a5','$a5','anonymous_active');" | Out-Null
  Invoke-TestSql "begin; set local role authenticated; set local request.jwt.claim.sub='$a5'; select set_config('request.jwt.claims',jsonb_build_object('sub','$a5','is_anonymous',true)::text,true) is not null; select public.begin_onboarding_account_transfer_v2('$session5','$secret5'); commit;" | Out-Null
  $sourceInsert="select pg_sleep(1); insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary) values ('$sa5','$a5','fixture-concurrent:late',1,'link','late','https://example.invalid/concurrent/late',false); select 'insert_done';"
  $pair4=Invoke-Pair (New-TransferSql $b4 $secret5) $sourceInsert
  if (($pair4 | Where-Object { $_.Side -eq 'left' }).Exit -ne 0) {
    throw "Unique transfer failed during source-add race: $($pair4 | ConvertTo-Json -Compress)"
  }
  $right=($pair4 | Where-Object { $_.Side -eq 'right' })
  if ($right.Exit -ne 0 -and $right.Output -notmatch 'saved_place_source_owner_mismatch') {
    throw "Source-add race failed unexpectedly: $($pair4 | ConvertTo-Json -Compress)"
  }
  $sourceRaceDiagnostic=Invoke-TestSql "select jsonb_build_object('parent_owner_b',(select count(*) from public.saved_places where id='$sa5' and user_id='$b4'),'original_b',(select count(*) from public.saved_place_sources where saved_place_id='$sa5' and identity_key='fixture-concurrent:original' and user_id='$b4'),'late_a',(select count(*) from public.saved_place_sources where saved_place_id='$sa5' and identity_key='fixture-concurrent:late' and user_id='$a5'),'late_b',(select count(*) from public.saved_place_sources where saved_place_id='$sa5' and identity_key='fixture-concurrent:late' and user_id='$b4'),'global_mismatch',(select count(*) from public.saved_place_sources x join public.saved_places p on p.id=x.saved_place_id where x.user_id<>p.user_id))::text"
  Write-Output "source-add race diagnostic: $sourceRaceDiagnostic"
  Assert-Local "select 1 / case when (select count(*) from public.saved_places where id='$sa5' and user_id='$b4')=1 and (select count(*) from public.saved_place_sources where saved_place_id='$sa5' and identity_key='fixture-concurrent:original' and user_id='$b4')=1 and (select count(*) from public.saved_place_sources x join public.saved_places p on p.id=x.saved_place_id where x.user_id<>p.user_id)=0 then 1 else 0 end" 'source-add race'
  Write-Output 'source-add race: PASS'

  [pscustomobject]@{ IdenticalAttempts='PASS'; ConcurrentDuplicateMerges='PASS'; DestinationSameSourceRace='PASS'; SourceAdditionRace='PASS'; Database='isolated clone' } | ConvertTo-Json -Compress
} finally {
  if ($created) {
    & dropdb -h 127.0.0.1 -p $Port -U postgres $database
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Isolated concurrency clone could not be dropped automatically.' }
  }
}
