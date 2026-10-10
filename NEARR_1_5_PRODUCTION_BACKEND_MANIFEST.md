# Nearr 1.5 Production backend deployment manifest

Status: **qualified branch; scheduled execution only. Nothing in this manifest was deployed while preparing the branch.**

Target Supabase project: `rlqvxdwtetxsqxhqztkw`

Branch: `release/nearr-1.5-production-unblock`

Release worktree: `C:\Users\andre\Desktop\Nearr-worktrees\Nearr-worktrees\nearr-1.5-production-unblock`

Rollback worktree: `C:\Users\andre\Desktop\Nearr-main-dev-build` at `ded040465176a193bba8c6921b179b07ef6a9a64`

The final deploy SHA is the SHA in the signed-off release handoff. It cannot be embedded in its own Git commit. Paste that value into `$expectedSha` before the window. Never run this plan from `main`, a Development-linked worktree, or a dirty worktree. Railway, monetization, Jev, recognition, and OTA are out of scope.

## Exact migration inventory

Apply only these migrations, in this order:

1. `supabase/migrations/20261008000001_nearr_15_provider_names.sql`
2. `supabase/migrations/20261009000001_saved_place_source_owner_invariant.sql`
3. `supabase/migrations/20261009000002_safe_onboarding_account_transfer_v2.sql`
4. `supabase/migrations/20261009000003_legacy_transfer_source_preservation.sql`
5. `supabase/migrations/20261009000004_converted_source_write_guard.sql`
6. `supabase/migrations/20261009000005_converted_anonymous_save_write_guard.sql`
7. `supabase/migrations/20261009000006_share_job_notification_at_most_once.sql`

`V2_TRANSFER_REJECTED_CANDIDATE.sql` is intentionally outside `supabase/migrations` and must never be applied. This inventory contains no monetization, Jev, recognition experiment, Railway, or Development-only unrelated migration.

## Window initialization

Open a new PowerShell window and set only the connection-string environment variable locally. Do not paste its value into logs or Git.

```powershell
$ErrorActionPreference = 'Stop'
$projectRef = 'rlqvxdwtetxsqxhqztkw'
$releaseRoot = 'C:\Users\andre\Desktop\Nearr-worktrees\Nearr-worktrees\nearr-1.5-production-unblock'
$rollbackRoot = 'C:\Users\andre\Desktop\Nearr-main-dev-build'
$expectedSha = '<FINAL SHA FROM THE APPROVED HANDOFF>'
Set-Location -LiteralPath $releaseRoot

if (-not $env:NEARR_PROD_DB_URL) { throw 'NEARR_PROD_DB_URL is not set in this PowerShell process.' }
git fetch origin release/nearr-1.5-production-unblock
if ((git branch --show-current) -ne 'release/nearr-1.5-production-unblock') { throw 'Wrong branch.' }
if ((git rev-parse HEAD) -ne $expectedSha) { throw 'Wrong local SHA.' }
if ((git rev-parse origin/release/nearr-1.5-production-unblock) -ne $expectedSha) { throw 'Wrong remote SHA.' }
if (git status --porcelain) { throw 'Release worktree is dirty.' }
git diff --check $expectedSha^ $expectedSha
```

Stop if any assertion fails.

## T-60 — fresh encrypted backup and restore test

This is a logical backup of `auth`, `public`, and `storage` database metadata. It does not back up Storage object bytes and is not managed PITR. Use the established Supabase CLI and local PostgreSQL 18 workflow:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $env:LOCALAPPDATA "NearrBackups\release-window-$stamp"
$capture = Join-Path $backupRoot 'capture'
$restore = Join-Path $backupRoot 'restore'
$archive = Join-Path $backupRoot "nearr-prod-release-$stamp.7z"
$keyFile = Join-Path $backupRoot 'archive-password.dpapi'
New-Item -ItemType Directory -Path $capture,$restore | Out-Null
icacls $backupRoot /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null

supabase db dump --db-url "$env:NEARR_PROD_DB_URL" --schema auth,public,storage --file (Join-Path $capture 'schema.sql')
supabase db dump --db-url "$env:NEARR_PROD_DB_URL" --schema auth,public,storage --data-only --use-copy --file (Join-Path $capture 'data.sql')
if ($LASTEXITCODE -ne 0) { throw 'Production logical dump failed.' }

$random = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($random)
$archivePassword = [Convert]::ToBase64String($random)
ConvertTo-SecureString $archivePassword -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $keyFile
& 7z a -t7z -mx=9 -mhe=on "-p$archivePassword" $archive (Join-Path $capture 'schema.sql') (Join-Path $capture 'data.sql')
if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive creation failed.' }
& 7z t "-p$archivePassword" $archive
if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive test failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $archive

& 7z x -y "-p$archivePassword" "-o$restore" $archive
if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive extraction failed.' }
$localDb = "nearr_release_window_$stamp" -replace '-', '_'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
& (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55458 -U postgres -T template0 -E UTF8 $localDb
if ($LASTEXITCODE -ne 0) { throw 'Local restore database creation failed.' }
& (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f (Join-Path $restore 'schema.sql')
if ($LASTEXITCODE -ne 0) { throw 'Schema restore failed.' }
& (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f (Join-Path $restore 'data.sql')
if ($LASTEXITCODE -ne 0) { throw 'Data restore failed.' }
& (Join-Path $pgBin 'psql.exe') -X -q -t -A -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -c "select jsonb_build_object('users',(select count(*) from auth.users),'saves',(select count(*) from public.saved_places),'sources',(select count(*) from public.saved_place_sources),'jobs',(select count(*) from public.share_jobs),'mismatches',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id))::text"
```

Require a successful archive test, matching inner-file hashes before/after extraction, representative row counts, and `mismatches=0`. Record the archive path and SHA-256 without recording the password. Remove the exact plaintext capture/extraction files after verification and retain the encrypted archive, DPAPI key, and test-owned local restore database through T-25:

```powershell
Remove-Item -LiteralPath (Join-Path $capture 'schema.sql'),(Join-Path $capture 'data.sql'),(Join-Path $restore 'schema.sql'),(Join-Path $restore 'data.sql') -Force
$archivePassword = $null
[Array]::Clear($random,0,$random.Length)
```

Keep the test-owned `$localDb` through T-25 for the immediately-before-deploy migration and contract rehearsal. Stop before all mutation if backup, decryption, restore, integrity, or cleanup scope cannot be proven.

## T-45 — Production migration preflight

Run the read-only preflight:

```powershell
$preflight = @'
select jsonb_build_object(
  'ownership_mismatches',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id),
  'legacy_notification_attempts',(select count(*) from public.share_jobs where notification_status in ('sending','retryable_failed')),
  'delivery_unknown',(select count(*) from public.share_jobs where notification_status='delivery_unknown'),
  'latest_migration',(select max(version) from supabase_migrations.schema_migrations)
)::text as release_preflight;
'@
& .\scripts\querySupabaseReadOnly.ps1 -ProjectRef $projectRef -Sql $preflight
```

Require `ownership_mismatches=0`, `legacy_notification_attempts=0`, `delivery_unknown=0`, and latest migration `20260907000003`. Then prove that the dry run contains exactly the seven inventory entries:

```powershell
$expectedMigrations = @(
  '20261008000001_nearr_15_provider_names.sql',
  '20261009000001_saved_place_source_owner_invariant.sql',
  '20261009000002_safe_onboarding_account_transfer_v2.sql',
  '20261009000003_legacy_transfer_source_preservation.sql',
  '20261009000004_converted_source_write_guard.sql',
  '20261009000005_converted_anonymous_save_write_guard.sql',
  '20261009000006_share_job_notification_at_most_once.sql'
)
$dryRun = (supabase db push --db-url "$env:NEARR_PROD_DB_URL" --dry-run 2>&1 | Out-String)
$expectedBases = @($expectedMigrations | ForEach-Object { $_ -replace '\.sql$','' })
$foundBases = @([regex]::Matches($dryRun,'[0-9]{14}_[A-Za-z0-9_]+') | ForEach-Object Value | Sort-Object -Unique)
$delta = @(Compare-Object $expectedBases $foundBases)
if ($delta.Count -ne 0) { throw "Dry-run migration inventory mismatch: $($delta | Out-String)" }
$dryRun
```

Apply the same files to the fresh local restore, then run the database suites:

```powershell
foreach ($migration in $expectedMigrations) {
  & (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f (Join-Path $releaseRoot "supabase\migrations\$migration")
  if ($LASTEXITCODE -ne 0) { throw "Local migration rehearsal failed: $migration" }
}
foreach ($suite in @(
  'testSavedPlaceSourceOwnerInvariant.sql','testSafeOnboardingV2Core.sql',
  'testSafeOnboardingV2Security.sql','testSafeOnboardingV2Failure.sql',
  'testLegacyV1TransferSafety.sql','testSourceAttachmentClientContracts.sql',
  'testDualClientDatabaseContracts.sql','testNotificationAtMostOnce.sql'
)) {
  & (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f (Join-Path $releaseRoot "scripts\$suite")
  if ($LASTEXITCODE -ne 0) { throw "Local release suite failed: $suite" }
}
```

Re-run the local typecheck, notification, recognition, and package proofs from the approved SHA:

```powershell
npm run typecheck
npx tsx scripts/testNotificationAtMostOnceTransport.ts
npx tsx scripts/testRecognitionEdgeFrozenBeforeAfter.ts
npm run test:recognition-regression
deno check --no-config supabase/functions/process-share-jobs/index.ts
& .\scripts\proveEdgeBundleOnly.ps1 -SourceRoot $releaseRoot -ProjectRef $projectRef
& .\scripts\proveEdgeBundleOnly.ps1 -SourceRoot $rollbackRoot -ProjectRef $projectRef
```

## T-40 — apply the exact database migrations

Only after T-60 and T-45 are green:

```powershell
supabase db push --db-url "$env:NEARR_PROD_DB_URL" --yes
if ($LASTEXITCODE -ne 0) { throw 'Production migration push failed; stop before Edge.' }
```

Do not use `--include-all`, migration repair, or a Development-linked project. Do not continue to Edge after a partial or uncertain push.

## T-35 — verify V1/V2 and ownership

```powershell
$postMigration = @'
select jsonb_build_object(
  'ownership_mismatches',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id),
  'owner_fk_validated',(select convalidated from pg_constraint where conname='saved_place_sources_owner_fk'),
  'v1_complete',(to_regprocedure('public.complete_onboarding_account_transfer(text)') is not null),
  'v2_begin',(to_regprocedure('public.begin_onboarding_account_transfer_v2(uuid,text)') is not null),
  'v2_complete',(to_regprocedure('public.complete_onboarding_account_transfer_v2(text)') is not null),
  'notification_claim',(to_regprocedure('public.claim_share_job_notifications(integer,integer)') is not null),
  'notification_begin',(to_regprocedure('public.begin_share_job_notification_provider_attempt(uuid,uuid)') is not null),
  'legacy_notification_attempts',(select count(*) from public.share_jobs where notification_status in ('sending','retryable_failed')),
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version in ('20261008000001','20261009000001','20261009000002','20261009000003','20261009000004','20261009000005','20261009000006'))
)::text as release_verification;
'@
& .\scripts\querySupabaseReadOnly.ps1 -ProjectRef $projectRef -Sql $postMigration
```

Require zero mismatches, a validated owner FK, all RPCs present, zero legacy in-flight attempts, and all seven migration versions. Run one designated non-private V1 transfer fixture and one designated 1.5 V2 transfer fixture; require idempotent replay, correct destination visibility, no source visibility leak, and mismatch count still zero. Never use real customer records for smoke fixtures.

## T-30 — public 1.4.55/build 56 client smoke

With the currently public client, use the designated test account and public test content. Verify login/session restore, save, duplicate save, source visibility, Queue processing/result opening, and the V1 account-transfer path. In parallel, rerun the frozen database contract selector locally:

```powershell
& (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f .\scripts\testLegacyV1TransferSafety.sql
& (Join-Path $pgBin 'psql.exe') -X -q -h 127.0.0.1 -p 55458 -U postgres -d $localDb -v ON_ERROR_STOP=1 -f .\scripts\testDualClientDatabaseContracts.sql
```

Stop if the public client requires an update, loses access, sees another user's relationship, or changes existing behavior.

## T-25 — Nearr 1.5.58/build 58 client smoke

Use the already-built 1.5.58/build 58 development/RC client with the designated test account. Verify structured provider names, empty/unique/duplicate V2 transfer, retry/idempotency, source preservation, save/share/Queue/result opening, and no access to the source anonymous relationship after conversion. Do not upload a new binary or publish an OTA in this step.

```powershell
npm run test:onboarding-anonymous
npm run test:result-notifications
& (Join-Path $pgBin 'dropdb.exe') -h 127.0.0.1 -p 55458 -U postgres $localDb
```

Stop on any forced-update requirement or any old/new contract divergence.

## T-20 — deploy only the notification backport

First confirm Production is still v123 and the rollback tree is exact:

```powershell
git -C $rollbackRoot status --porcelain
git -C $rollbackRoot rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $rollbackRoot 'supabase\functions\process-share-jobs\index.ts')
supabase functions list --project-ref $projectRef --output json
```

Require clean rollback worktree, SHA `ded040465176a193bba8c6921b179b07ef6a9a64`, entry SHA-256 `F8D83FBD2FDCF785C252185952BD453C5F1E43EB463022BFFCFDFAF346CD077F`, live v123, `verify_jwt=false`, and live bundle SHA-256 `578f81df4c87b54ec178ee0ce32aadd35be527d6d6f30c0760a0bb8add925339`.

Deploy the release candidate from the approved SHA:

```powershell
supabase functions deploy process-share-jobs --project-ref $projectRef --no-verify-jwt --use-api --workdir $releaseRoot
if ($LASTEXITCODE -ne 0) { throw 'Edge deployment failed.' }
```

Required existing secret/config names are `SHARE_JOBS_WORKER_SECRET`, `MEDIA_FINALIZE_SECRET`, platform-injected `SUPABASE_URL`, platform-injected `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PLACES_KEY`, `GEMINI_API_KEY`, and the existing media flags including `MEDIA_FALLBACK_ENABLED`. Do not print or change values. Do not deploy any other function.

## T-15 — notification smoke and logs

```powershell
supabase functions list --project-ref $projectRef --output json
$notificationCheck = @'
select jsonb_build_object(
  'pending',(select count(*) from public.share_jobs where notification_status='pending'),
  'sending',(select count(*) from public.share_jobs where notification_status='sending'),
  'retryable_failed',(select count(*) from public.share_jobs where notification_status='retryable_failed'),
  'delivery_unknown',(select count(*) from public.share_jobs where notification_status='delivery_unknown'),
  'duplicate_logical_ids',(select count(*) from (select notification_logical_id from public.share_jobs where notification_logical_id is not null group by notification_logical_id having count(*)>1) d)
)::text as notification_health;
'@
& .\scripts\querySupabaseReadOnly.ps1 -ProjectRef $projectRef -Sql $notificationCheck
```

Using only designated test jobs, verify one completed, one needs-help, and one failed payload across the old/new client routes. Exercise immediate plus cron drain, duplicate invocation, a safe pre-send recovery, and the rehearsed ambiguous-send state. Require one provider attempt, stable `n1:<job UUID>:<c|h|f>` logical ID/collapse ID/tag, ticket provenance when returned, `delivery_unknown` with no resend after ambiguity, and authoritative result opening. Inspect Supabase Edge logs filtered to `process-share-jobs`; never paste tokens, ticket IDs, payloads, or user content into the release record.

## T-10 — final ownership and error check

```powershell
$finalCheck = @'
select jsonb_build_object(
  'ownership_mismatches',(select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id),
  'orphans',(select count(*) from public.saved_place_sources s left join public.saved_places p on p.id=s.saved_place_id where p.id is null),
  'duplicate_relationships',(select count(*) from (select saved_place_id,identity_key from public.saved_place_sources group by saved_place_id,identity_key having count(*)>1) d),
  'stuck_notification_attempts',(select count(*) from public.share_jobs where notification_status in ('sending','retryable_failed') and notification_last_attempt_at < now()-interval '5 minutes')
)::text as final_health;
'@
& .\scripts\querySupabaseReadOnly.ps1 -ProjectRef $projectRef -Sql $finalCheck
```

Require all four counts to be zero and no new relevant Edge/database errors during the observation window.

## T=0 — backend ready for app release

Declare only the backend ready. Record the deployed seven migration versions, new Edge version/hash, smoke job IDs in the private release log, backup archive path/hash, monitoring result, branch, and deployed SHA. Do not publish an OTA, change Railway, upload App Store Connect, or publicly release Nearr as part of this backend runbook.

## Edge rollback / forward recovery

If the database is healthy but the new Edge version fails, stop new smoke traffic and forward-redeploy the source-equivalent v123 tree:

```powershell
git -C $rollbackRoot status --porcelain
git -C $rollbackRoot rev-parse HEAD
& .\scripts\proveEdgeBundleOnly.ps1 -SourceRoot $rollbackRoot -ProjectRef $projectRef
supabase functions deploy process-share-jobs --project-ref $projectRef --no-verify-jwt --use-api --workdir $rollbackRoot
supabase functions list --project-ref $projectRef --output json
```

This recreates v123-equivalent behavior from proven source lineage; it will receive a new deployed version and need not reproduce the old bundle hash. Re-run boot/auth, one designated share-job smoke, recognition projection smoke, and ownership/error queries. Do not change secret values.

Database changes are additive and should be forward-repaired. Do not drop columns/constraints or replay the logical backup over a live project during the release window. If migration state is partial or data integrity changes, stop, preserve evidence, keep Edge at the last known-good version, and use the fresh backup with a reviewed Supabase recovery/forward-fix plan.

## Absolute stop conditions

Stop before the next step if any of the following occurs:

- branch/SHA/remote mismatch, dirty worktree, or unexpected diff;
- backup/archive/decryption/restore failure, unverified plaintext scope, or mismatch count above zero;
- Production drift from the preflight baseline or any unexpected pending migration;
- any rejected, Development-only, monetization, Jev, recognition, Railway, or unrelated migration/function in the plan;
- migration error, missing/invalid owner FK, missing RPC, orphan, duplicate relationship, or ownership mismatch;
- V1/public-client, 1.5/V2, RLS, idempotency, or source-preservation failure;
- forced-update requirement or old/new client incompatibility;
- notification duplicate provider attempt, unsafe retry after ambiguous acceptance, unstable logical ID, missing terminal status, or cron resend;
- any recognition-result difference;
- rollback bundle/package/source/hash failure or inability to redeploy the recovery tree;
- missing/changed required Edge configuration name, unhealthy logs, or smoke failure;
- any request to change Railway, recognition models/code, Jev, monetization, OTA, main, or unrelated backend behavior.
