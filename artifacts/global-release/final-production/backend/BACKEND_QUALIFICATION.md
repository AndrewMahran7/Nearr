# Final backend qualification — 28 October 2026 UTC

**Development is healthy and intentionally recognition-disabled. Production is healthy but is not the qualified 1.7 backend. No Production change or inference request was issued.** Authentication works for Railway and Supabase; another OAuth attempt is not needed.

## Live inventory

| Item | Development | Production |
|---|---|---|
| Supabase | `qnfxnmvxpjzfydgudtvs`, ACTIVE_HEALTHY | `rlqvxdwtetxsqxhqztkw`, ACTIVE_HEALTHY |
| Railway environment | `57d055b7-5326-4f96-a7a9-70523ee0d3f0` | `49650a9c-4744-4649-8cd1-4ff38473d22f` |
| Railway service | media-worker, `3c8cd190-b118-4ee4-9338-407843ef4e1f` | Nearr, `59234570-e2ec-4a7e-86de-22826da86c66` |
| Active deployment | `70fc5c6f-1b8b-4e5c-915e-7c30ccbab360` SUCCESS | `6e78ebe9-58f7-4799-a90e-86238a1b14e9` SUCCESS |
| Source | `9f2b1299824b2f7102fd3443da7d3a888f4d8c94` | `e9daf499cfb276ea7072b651642a04218b90ccf9` |
| Health / readiness | 200 / deliberately 503 | 200 / 200 |
| Analysis / transcription | disabled / noop | Gemini / OpenAI |
| Migrations | 89, all baseline local IDs present | 72; 23 local IDs absent, six Production-only IDs |
| create-share-job | v75 | v45 |
| process-share-link | v88 | v153 |
| process-share-jobs | v144 | v124 |
| plus-api / revenuecat-plus-webhook | v1 / v1 ACTIVE | absent / absent |

Project ID is `4037a3b5-d66f-409e-b734-56c22c244e3e` for both Railway environments. Production's newer historical `fee82c18…` is SKIPPED, not the active runtime. Full versions, hashes, migration names and configuration booleans are in `live-readiness.json`.

The 23-missing count is relative to the starting 89-migration source. The subsequently prepared `20261028000001_nearr_free_only_release.sql` is also unapplied to both backends; the final local set therefore has 24 IDs absent from Production. This additional migration does not resolve any of the six Production-only preservation requirements.

Development's active worker image digest remains `sha256:0ca141b72cd33c64cfaaa58014db13d0be9df91f82223534c9362e28c110737f`. Its Git tree `4f8f50dc7253a1b4451b4f960ff9d144a965c040` exactly matches the starting final-release branch. No worker redeployment is needed merely to catch up source. The linked Development GitHub branch is older; the active deployment was an exact-source upload. Future automatic deploy/source configuration must be reconciled before an approved cutover.

The disabled readiness response's `checks.supabase=false` is not proof of a Supabase outage: processing initialization is withheld while configuration is closed. Independent authenticated database reads passed.

## Current containment and permissions

Development: all 19 discovered `*_ENABLED` worker flags false; provider route disabled, OCR/transcription noop. Global legal, recognition and purchase qualification false; all ten markets and minor-AI qualification false. This reuses the unchanged-worker 26 October five-profile/15-denied-request proof. No new positive recognition, paid inference, live guardian permission or new denial fixtures are claimed.

**Correction to stale historical prose:** Production recognition is not disabled. Its older Gemini/OpenAI route, acquisition and fallback switches remain enabled and readiness returns ready. The current Production schema lacks the new global eligibility, processing-permission, region-policy and Plus tables/RPCs. This does not establish that any underage person was processed. It does establish that the new 1.7 audience and consent safeguards are not deployed.

Production RLS remains enabled on saved_places, saved_place_sources, share_jobs and share_media_tasks. This is a structural readback, not a complete live RLS penetration test. Aggregate snapshot: 112 auth users, 642 saves, 558 source associations, 915 jobs, 1,000 media tasks. Two jobs were processing_metadata and seven media tasks queued; they were not claimed, cancelled or deleted by this audit. Development snapshot: 43 users, 20 saves, 13 source associations, 66 jobs and 58 media tasks. Counts may change from concurrent authorized Development QA; this audit created no identity.

## Exact source recovery and preservation risks

All five release-relevant Development Edge entrypoints were recovered and matched starting local source after LF normalization. Three Production recognition entrypoints differ; the legacy monetization entrypoint matches. Supabase CLI rejects extraction of archived imports outside its functions destination (`../../lib` paths), so primary entrypoints were recovered but **complete Edge dependency closure is not certified**. Download status and per-file hashes are retained in `edge-source-recovery.json`. ESZIP deployment hashes are independently retained in the live inventory.

The Production worker commit is available locally; its tree is `5457e19a8965bfa882e0ce35e510296667ec0359`, with 16 worker files differing from the unified Development baseline. The actual active source—not current main—is the comparison point.

Six Production-only migrations were recovered from the migration ledger without changing it:

| ID | Meaning / preservation requirement |
|---|---|
| 20261008000001 | Nullable provider names. Unlike local 20260925000001, intentionally does not replace the auth new-user trigger. |
| 20261009000002 | Safe V2 account transfer, notification/source ownership preservation and cleanup eligibility. |
| 20261009000003 | Legacy V1 transfer source preservation. |
| 20261009000004 | Converted-source write rejection for saved-place sources. |
| 20261009000005 | Converted anonymous account cannot create new saves. |
| 20261009000006 | At-most-once notification attempt/receipt protocol, including delivery_unknown. |

Production process-share-jobs v124 calls the at-most-once begin/finish attempt RPCs; unified Development v144 lacks those calls. Deploying v144 over it would discard a Production-specific protection unless reconciled first. Likewise, Development migration identifiers include history markers, test-store binding and older transfer implementations: **the list of 23 absent IDs is an inventory, not an executable Production migration plan**.

`migration-preservation-evidence.json` records recovered SQL hashes, live trigger definitions and saved/source ownership fingerprints without exporting user rows. Raw recovered SQL stays in ignored task scratch. A reviewed additive reconciliation and restored-copy migration rehearsal remain necessary before any 1.7 Production deployment.

## Monetization / free-only decision

Live Development `nearr_plus_config`: sales_enabled=false, enforce_allowance=false, release_qualified=false, catalog_verified=false, SANDBOX; free_finds=3, plus_finds=10; product nearr_plus_monthly_v1, offering nearr_plus_v1, entitlement nearr_plus; no verified RevenueCat app binding. Production has no new Plus schema/Edge endpoints. No purchase, restore, renewal, cancellation or refund was performed by this audit.

The starting implementation couples allowance enforcement to catalog verification and a nonnull RevenueCat app ID through its database CHECK. Therefore simply leaving purchases off does not establish an enforceable three-free-find launch. A separate reviewed free-only qualification path is needed if monetization is deferred. Any parallel fix is local-only until separately tested/deployed; this live readback does not claim that fix is deployed. Provider qualification and working recognition remain mandatory even for free-only.

## Backup and restoration

The provider backup-list endpoint returns backups=null, empty physical_backup_data, PITR=false, WAL-G=true. This proves no listed recoverable point in that response, not absence of every underlying backup.

A fresh, read-only private database backup was completed with the authorized short-lived CLI connection. The custom archive contains all database schemas, 85 table-data entries and ACL entries; 15,411,678 bytes; SHA-256 `6bfee2f9351c66a11d75febb4a62cd56ca0b0b8a48e73dae426c60c9fea415b7`. The archive is in the task's ignored `.tmp/private-production-backup` directory, restricted to the current Windows identity and SYSTEM. No passwords, tokens, dump contents or user records are in committed artifacts.

**Database-only isolated restoration passed** at `2026-10-28T00:20:23.684Z`, recorded in `restore-receipt.json`: pg_restore exit 0; 112 users, 642 saved places, 558 source associations, 915 jobs, 1,000 media tasks and 72 migrations restored. Both saved/source ownership hashes exactly match the live baseline; all four inspected key-table RLS flags remain enabled. These are actual restored-data checks, not an inference from archive readability.

Matching preinstalled Supabase PostgreSQL 17.6.1.111 was used in a new Docker container with no network, no published port, scheduled jobs disabled, one CPU and 640 MiB RAM. Five earlier local setup attempts exposed cron database configuration, init-server shutdown timing, restore-admin access and missing platform-role requirements; those were corrected only in disposable containers before the passing attempt. Each attempted container was stopped and removed; the private archive is retained. Fifteen role definitions were available for local bootstrap, with missing roles deliberately non-login; passwords and ephemeral CLI roles were excluded. Source role memberships were recorded but not replayed; the image's existing roles and memberships remained in place. Database owners were not recreated verbatim (`--no-owner`), and cluster authentication was not restored. Storage object bytes, external provider configuration, cluster credentials, a full hosted disaster-recovery exercise and a Production cutover are **not** covered by this database-only rehearsal.

Subsequent script hardening is syntax-checked only: backup reruns refuse an existing destination before credential retrieval and use exclusive file creation; the restore script generates a task-specific loopback/local-only HBA file inside the ACL-restricted private directory. The successful rehearsal above predates these mechanical safety changes; no second backup or restore is claimed for them.

## Next gate

See `PRODUCTION_CONTAINMENT_PROPOSAL.md`. Founder approval is required for a material temporary interruption of new Production recognition. Before an actual cutover, preserve the above Production-only contracts, prove restoration and migration compatibility, and qualify the provider. Do not use an ungated/Gemini-enabled image as the rollback for the new 13+ release. Nothing in this report authorizes activation or indicates App Review readiness.
