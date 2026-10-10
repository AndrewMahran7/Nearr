param(
  [ValidateSet('nearr_notification_at_most_once_20261010','nearr_branch_final_20261010')]
  [string]$SourceDatabase = 'nearr_notification_at_most_once_20261010',
  [ValidatePattern('^nearr_notification_atomic_[0-9]{8}$')]
  [string]$TestDatabase = 'nearr_notification_atomic_20261010'
)
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'
$dropdb = Join-Path $pgBin 'dropdb.exe'
$argsList = @('-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55458','-U','postgres')
$exists = & $psql @argsList -d postgres -c "select count(*) from pg_database where datname='$TestDatabase'"
if ($LASTEXITCODE -ne 0 -or $exists.Trim() -ne '0') { throw 'Refusing existing or unverified test database' }
& $createdb -h 127.0.0.1 -p 55458 -U postgres -T $SourceDatabase $TestDatabase
if ($LASTEXITCODE -ne 0) { throw 'Isolated notification clone failed' }

function Invoke-TestSql([string]$sql) {
  $result = & $psql @argsList -d $TestDatabase -c $sql
  if ($LASTEXITCODE -ne 0) { throw "Notification SQL failed: $sql" }
  return @($result | Where-Object { $_ -and $_.Trim() })
}

try {
  Invoke-TestSql 'alter table public.share_jobs disable trigger share_jobs_kick_worker' | Out-Null
  if (@(Invoke-TestSql "select id from public.share_jobs where notification_status in ('pending','sending','retryable_failed')").Count -ne 0) {
    throw 'Unexpected nonfixture claimable row in local clone'
  }
  $jobId = [string](@(Invoke-TestSql @'
with fixture as (select gen_random_uuid() as id, id as user_id from auth.users order by created_at limit 1)
insert into public.share_jobs(id,user_id,source_url,status,notification_status,notification_payload)
select id,user_id,'https://fixtures.nearr.invalid/notification-atomic','completed','pending',
  jsonb_build_object('title','Test','body','Test','data',jsonb_build_object('jobId',id::text,'type','share_job_completed'))
from fixture returning id
'@)[0]).Trim()
  if ($jobId -notmatch '^[0-9a-f-]{36}$') { throw 'Fixture ID missing' }

  $claimSql = 'begin; select id from public.claim_share_job_notifications(1,180); select pg_sleep(0.2); commit;'
  $jobs = @(1..10 | ForEach-Object {
    Start-Job -ScriptBlock {
      param($exe,$argv,$database,$sql)
      & $exe @argv -d $database -c $sql
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent claim failed' }
    } -ArgumentList $psql,$argsList,$TestDatabase,$claimSql
  })
  try {
    $jobs | Wait-Job | Out-Null
    $outputs = @($jobs | ForEach-Object { Receive-Job -Job $_ -ErrorAction Stop })
  } finally { $jobs | Remove-Job -Force }
  if (@($outputs | Where-Object { $_ -eq $jobId }).Count -ne 1) { throw 'Expected one of ten claims' }
  $attemptId = [string](@(Invoke-TestSql "select notification_attempt_id from public.share_jobs where id='$jobId'")[0]).Trim()
  if ($attemptId -notmatch '^[0-9a-f-]{36}$') { throw 'Claim did not persist attempt ID' }
  if (@(Invoke-TestSql 'select id from public.claim_share_job_notifications(1,180)').Count -ne 0) {
    throw 'Duplicate immediate invocation reclaimed the job'
  }
  Write-Output 'PASS ten-way immediate/cron race and duplicate Edge invocation: one claim'

  $beginSql = "select id from public.begin_share_job_notification_provider_attempt('$jobId','$attemptId')"
  $jobs = @(1..10 | ForEach-Object {
    Start-Job -ScriptBlock {
      param($exe,$argv,$database,$sql)
      & $exe @argv -d $database -c $sql
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent begin failed' }
    } -ArgumentList $psql,$argsList,$TestDatabase,$beginSql
  })
  try {
    $jobs | Wait-Job | Out-Null
    $started = @($jobs | ForEach-Object { Receive-Job -Job $_ -ErrorAction Stop })
  } finally { $jobs | Remove-Job -Force }
  if (@($started | Where-Object { $_ -eq $jobId }).Count -ne 1) { throw 'Expected exactly one durable provider marker in ten concurrent begins' }
  $secondStart = @(Invoke-TestSql "select id from public.begin_share_job_notification_provider_attempt('$jobId','$attemptId')")
  if ($secondStart.Count -ne 0) { throw 'Duplicate provider attempt started' }
  Invoke-TestSql "update public.share_jobs set notification_last_attempt_at=now()-interval '181 seconds' where id='$jobId'" | Out-Null
  $jobs = @(1..10 | ForEach-Object {
    Start-Job -ScriptBlock {
      param($exe,$argv,$database,$sql)
      & $exe @argv -d $database -c $sql
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent stale claim failed' }
    } -ArgumentList $psql,$argsList,$TestDatabase,'select id from public.claim_share_job_notifications(1,180)'
  })
  try {
    $jobs | Wait-Job | Out-Null
    $staleOutputs = @($jobs | ForEach-Object { Receive-Job -Job $_ -ErrorAction Stop })
  } finally { $jobs | Remove-Job -Force }
  if (@($staleOutputs | Where-Object { $_ -eq $jobId }).Count -ne 0) { throw 'Ambiguous provider attempt was reclaimed' }
  $state = [string](@(Invoke-TestSql "select notification_status||'|'||notification_attempts||'|'||notification_attempt_id from public.share_jobs where id='$jobId'")[0]).Trim()
  if ($state -ne "delivery_unknown|1|$attemptId") { throw "Incorrect ambiguous result: $state" }
  Write-Output 'PASS ten-way provider-begin and stale-provider races: one marker, delivery_unknown, no re-claim'
} finally {
  & $dropdb -h 127.0.0.1 -p 55458 -U postgres $TestDatabase
  if ($LASTEXITCODE -ne 0) { throw "Failed to remove test-owned database: $TestDatabase" }
}
