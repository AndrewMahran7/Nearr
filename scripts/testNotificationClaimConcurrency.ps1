param(
  [ValidateSet('nearr_release_migrated_20261009')]
  [string]$SourceDatabase = 'nearr_release_migrated_20261009',
  [ValidatePattern('^nearr_notification_qual_[0-9]{8}$')]
  [string]$TestDatabase = 'nearr_notification_qual_20261009'
)

$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'
$dropdb = Join-Path $pgBin 'dropdb.exe'
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb) -or -not (Test-Path -LiteralPath $dropdb)) {
  throw 'PostgreSQL 18 client tools unavailable'
}
$pgArgs = @('-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55458', '-U', 'postgres')
$exists = & $psql @pgArgs -d postgres -c "select count(*) from pg_database where datname = '$TestDatabase'"
if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL preflight failed' }
if ($exists.Trim() -ne '0') { throw "Refusing existing test database: $TestDatabase" }

& $createdb -h 127.0.0.1 -p 55458 -U postgres -T $SourceDatabase $TestDatabase
if ($LASTEXITCODE -ne 0) { throw 'Isolated test database clone failed' }

function Invoke-TestSql([string]$sql) {
  $result = & $psql @pgArgs -d $TestDatabase -c $sql
  if ($LASTEXITCODE -ne 0) { throw "SQL test failed: $sql" }
  return @($result | Where-Object { $_ -and $_.Trim() })
}

# The clone is local and disposable; prevent the restored insert hook from
# calling any external worker, and remove unrelated pending rows from claims.
Invoke-TestSql 'alter table public.share_jobs disable trigger share_jobs_kick_worker' | Out-Null
Invoke-TestSql "update public.share_jobs set notification_status = null where notification_status in ('pending','retryable_failed','sending')" | Out-Null
$jobId = [string](@(Invoke-TestSql @'
with fixture as (select gen_random_uuid() as id, id as user_id from auth.users order by created_at limit 1)
insert into public.share_jobs(id, user_id, source_url, status, notification_status, notification_payload)
select id, user_id, 'https://fixtures.nearr.invalid/notification-race', 'completed', 'pending',
       jsonb_build_object('title','Test','body','Test','data',jsonb_build_object('jobId',id::text,'type','share_job_completed'))
from fixture
returning id
'@)[0]).Trim()
if ($jobId -notmatch '^[0-9a-f-]{36}$') { throw 'Fixture insert did not return a job ID' }

$claimSql = "begin; select id from public.claim_share_job_notifications(1,180); select pg_sleep(0.2); commit;"
$jobs = @(1..10 | ForEach-Object {
  Start-Job -ScriptBlock {
    param($exe, $argsList, $database, $sql)
    & $exe @argsList -d $database -c $sql
    if ($LASTEXITCODE -ne 0) { throw "Concurrent claim failed: $LASTEXITCODE" }
  } -ArgumentList $psql, $pgArgs, $TestDatabase, $claimSql
})
try {
  $jobs | Wait-Job | Out-Null
  $outputs = @($jobs | ForEach-Object { Receive-Job -Job $_ -ErrorAction Stop })
} finally {
  $jobs | Remove-Job -Force
}
$claims = @($outputs | Where-Object { $_ -eq $jobId })
if ($claims.Count -ne 1) { throw "Ten-way claim count was $($claims.Count), expected 1" }
$state = [string](@(Invoke-TestSql "select notification_status || '|' || notification_attempts from public.share_jobs where id = '$jobId'")[0]).Trim()
if ($state -ne 'sending|1') { throw "Unexpected post-claim state: $state" }
Write-Output 'PASS ten concurrent immediate/cron claims: exactly one claim'

$duplicate = @(Invoke-TestSql 'select id from public.claim_share_job_notifications(1,180)')
if ($duplicate.Count -ne 0) { throw 'Immediate duplicate Edge invocation reclaimed the row' }
Write-Output 'PASS immediate duplicate invocation: no second claim'

Invoke-TestSql "update public.share_jobs set notification_status='retryable_failed', notification_next_attempt_at=now()-interval '1 second' where id='$jobId'" | Out-Null
$retry = @(Invoke-TestSql 'select id from public.claim_share_job_notifications(1,180)')
if ($retry.Count -ne 1 -or $retry[0].Trim() -ne $jobId) { throw 'Explicit provider failure was not retryable' }
$state = [string](@(Invoke-TestSql "select notification_status || '|' || notification_attempts from public.share_jobs where id = '$jobId'")[0]).Trim()
if ($state -ne 'sending|2') { throw "Unexpected retry state: $state" }
Invoke-TestSql "update public.share_jobs set notification_status='submitted' where id='$jobId'" | Out-Null
if (@(Invoke-TestSql 'select id from public.claim_share_job_notifications(1,180)').Count -ne 0) {
  throw 'Already submitted notification was reclaimed'
}
Write-Output 'PASS explicit failure/retry and already-submitted suppression'

# An accepted provider request whose response/DB update is lost has the same
# durable state as an unsent stale claim. The current RPC necessarily reclaims it.
Invoke-TestSql "update public.share_jobs set notification_status='sending', notification_last_attempt_at=now()-interval '181 seconds', notification_attempts=2 where id='$jobId'" | Out-Null
$ambiguous = @(Invoke-TestSql 'select id from public.claim_share_job_notifications(1,180)')
if ($ambiguous.Count -ne 1 -or $ambiguous[0].Trim() -ne $jobId) { throw 'Expected ambiguous stale-claim replay was not observed' }
Write-Output 'BLOCKER accepted-by-provider/timeout scenario: stale claim is resent; no durable provider idempotency key'
& $dropdb -h 127.0.0.1 -p 55458 -U postgres $TestDatabase
if ($LASTEXITCODE -ne 0) { throw "Failed to remove isolated test database: $TestDatabase" }
Write-Output "Removed test-owned isolated database: $TestDatabase"
throw 'Notification no-duplicate release gate failed; do not deploy the backport'
