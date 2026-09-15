# Development deployment report

Date: 2026-09-15
Scope: Development only

## Pre-deployment baseline

| Surface | Verified state |
| --- | --- |
| Git / current Dev source | `497e4f49162ce45a40f351eb6e2f18b9b51a96fa` |
| EAS Development | group `d511f9b0-40bc-4630-ab17-4336932d0147`, runtime `1.4.55`, iOS `01a0a25a-4ad4-74a3-a205-77d0636272ac`, Android `01a0a25a-4ad4-7f65-a9f8-b7804a9ec561` |
| Supabase project | Nearr-Dev `qnfxnmvxpjzfydgudtvs`, `ACTIVE_HEALTHY` |
| Database | `20260910000001`-`000007` applied remotely; `20260914000002` pending after local reconciliation |
| Edge | `process-share-jobs` v140 ACTIVE; `process-share-link` v85 ACTIVE; `create-share-job` v73 ACTIVE; `monetization` v44 ACTIVE |
| Railway Dev worker | deployment `0b9776ae-d9df-4fad-8ff3-9e8b34153a93`, SUCCESS, image `sha256:8f776d128a29b778a928b361d2abb77da85763bc2c6c9e76239bf34bcc16dd3e` |
| Client suspension | `EXPO_PUBLIC_MONETIZATION_ENABLED=false`, `EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED=false`, `EXPO_PUBLIC_TOKEN_MONETIZATION_ENABLED=false` |
| Edge suspension | SHA-256 values independently match literal `false` for `TOKEN_MONETIZATION_ENABLED`, `PREMIUM_REQUESTS_ENABLED`, `MONETIZATION_DEV_MOCK_ENABLED` |

## Deployment results

Deployment source was clean commit `d75177dd3c9e5011935a4f5209719f7d2947380f`. The shared Development lane was re-read immediately before mutation and again before OTA publication; it remained on baseline group `d511f9b0-40bc-4630-ab17-4336932d0147`, so no concurrent integration was overwritten.

| Surface | Result |
| --- | --- |
| Database | Guard saw 77 applied migrations and exactly one pending version. `npm run dev:db -- --yes` executed only `20260914000002_recognition_entity_role_latency_state.sql`. Post-deploy list aligns all 78 local/remote versions. No historical migration replay and no repair command. |
| Schema proof | `scripts/verifyDevelopmentMigrationReconciliation.sql` passed 16/16 read-only catalog checks after deployment: the seven exact historical fingerprints/contracts plus the `20260914000002` registry row, nullable `jsonb` column, bounded object check, and column comment. Nearr-Dev is `ACTIVE_HEALTHY`. |
| Edge | `process-share-jobs` v140 -> v141 ACTIVE (`2346f63c...` bundle digest); `process-share-link` v85 -> v86 ACTIVE (`bd87696a...`). `create-share-job` stayed v73 and `monetization` stayed v44. Both deployed handlers retain `verify_jwt=false` as required by their authenticated internal-call contracts. |
| Railway | `media-worker` deployment `0b9776ae-d9df-4fad-8ff3-9e8b34153a93` -> `11acd95c-90f3-407e-aefa-2f1d66fc05a9`, status SUCCESS, image `sha256:8468100c9e32dccf3f2b2caee1db94838a5fe6d982c05e8e4a6e59e9dcd69b01`. `/health` and `/ready` both returned 200; config, ffmpeg, ffprobe, yt-dlp, and Supabase readiness were true. Startup logs contain normal container/listening/runtime-diagnostics events and no error/warning event. |
| EAS | Development group `ffc99955-c0ba-402a-8518-e37daad1a8e2`, runtime `1.4.55`, iOS `01a0a698-7fa8-70bb-adee-8adeaea4bb47`, Android `01a0a698-7fa8-7d03-9be6-baa1b9cac875`; both manifests report Git commit `d75177dd3c9e5011935a4f5209719f7d2947380f`. |
| Suspension | EAS reports all three client values as literal `false`. Supabase secret digests for `TOKEN_MONETIZATION_ENABLED`, `PREMIUM_REQUESTS_ENABLED`, and `MONETIZATION_DEV_MOCK_ENABLED` each match SHA-256 of literal `false`; timestamps did not change. Historical schema/data remain present. |
| Native export | Clean iOS and Android `expo export` runs both succeeded before publication; EAS then exported and published both platforms successfully. |

## Validation summary

`npm run typecheck`, `npm run test:prebuild`, all requested recognition/geography/entity-role/state/cache/Places/autosave/notification/queue/result/media/onboarding/snapshot/imagery/cost/manual-fallback/suspension suites, and worker typecheck/tests passed. Worker result: 648 total, 641 passed, seven intentionally skipped, zero failed. Recognition geography passed 14 cases; entity-role/latency passed 15 cases plus founder replay and instrumentation; Recognition Cache V2 passed 22/22 plus its local PostgreSQL core/concurrency proof; Premium suspension passed 30/30; the new Development migration-history test passed against 78 files. `git diff --check` passed. Automated suspension coverage proves ordinary sharing remains unmetered and does not reserve tokens; the founder replay below supplies the requested real-device check without generating unnecessary paid traffic during deployment health checks.

## Founder QA commands

Run these from PowerShell to verify the exact release and observe the worker during the replay:

```powershell
Set-Location 'C:\Users\andre\Desktop\Nearr-worktrees\recognition-fix-dev-migration-reconciliation'
npx eas-cli update:view ffc99955-c0ba-402a-8518-e37daad1a8e2 --json

$env:RAILWAY_CALLER = 'skill:use-railway@1.4.0'
$env:RAILWAY_AGENT_SESSION = 'railway-skill-20260915-founder-qa'
railway deployment list --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment development --service media-worker --json
railway logs 11acd95c-90f3-407e-aefa-2f1d66fc05a9 --since 30m --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment development --service media-worker
```

After sharing, enter the displayed job ID to narrow the bounded log window:

```powershell
$JobId = Read-Host 'Development share job ID'
railway logs 11acd95c-90f3-407e-aefa-2f1d66fc05a9 --since 30m --filter $JobId --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment development --service media-worker
```

Force-close and reopen the Development app until the new OTA is active. Start a stopwatch and share the same Greece/Prada video. Record durable acknowledgement, first queue state, metadata/context, analyzing, terminal/review state, and notification times. Confirm Greece is structured source geography; San Francisco is not source geography; `@prada` alone produces no High-match US store; enqueue succeeds with worker start and no deterministic retry loop. If processing exceeds 90 seconds, confirm the non-blocking long-running message and continued background work. Background Nearr, wait for the notification, verify its copy matches current state, tap it, and verify the current job state is re-read. Then share one known-good place video with a zero-token account and confirm normal unmetered processing. Compare timing only directionally with historical Dev p50 ~44s, p75 ~75s, p90 ~104s, p95 ~145s; one replay is not a benchmark.

## Production baseline / no-touch proof

Post-deploy verification confirms Production EAS remains group `f9a9846f-3643-4644-a05f-a59be8baa1da`, runtime `1.4.55`, commit `ded040465176a193bba8c6921b179b07ef6a9a64`. Production Edge remains `create-share-job` v45, `monetization` v19, `process-share-jobs` v123, and `process-share-link` v153, all ACTIVE. Production Railway remains deployment `6e78ebe9-58f7-4799-a90e-86238a1b14e9`, SUCCESS, image `sha256:7c5c4e0c1d6b636cf4d6572b4535c7186cf17f666613e9e9233fc1a87587a571`. Nearr Production is `ACTIVE_HEALTHY`. No Production mutation was performed.
