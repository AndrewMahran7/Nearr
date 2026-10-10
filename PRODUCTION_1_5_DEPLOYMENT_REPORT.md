# Nearr 1.5 Production deployment — 2026-10-10 UTC

Final branch status: **READY FOR A SCHEDULED PRODUCTION BACKEND WINDOW; NOT DEPLOYED.** All branch qualification and recovery gates required before scheduling are green. The actual window must still begin with a fresh encrypted backup/restore and live drift preflight, then follow `NEARR_1_5_PRODUCTION_BACKEND_MANIFEST.md`. Production remains on its pre-release schema and `process-share-jobs` v123; this task did not upload build 58 or change Railway, OTA, App Store Connect, main, or the public release.

## Prior incomplete-run record

Current status: **NOT DEPLOYED.** The approved at-most-once notification successor passed local qualification, but the full v123-versus-candidate 91-case recognition-output replay is not proven (76 actual Premium runtime inputs, 15 unavailable/no-result cases, Edge projection rather than full handler). A fresh immediately-before-deploy encrypted Production backup and restore, final migration rehearsal, live old/new client qualification, and post-Edge smoke therefore have not occurred. Read-only Production preflight on 2026-10-10 UTC found zero owner mismatches and zero legacy in-flight notification attempts; migration ledger still ends `20260907000003`, and `process-share-jobs` remains v123. Do not apply the seven-file compatibility/notification manifest or upload build 58 while this gate is open.

## Historical 2026-10-09 status (superseded notification policy)

Status: **NOT DEPLOYED.** The fresh backup restored, current Production integrity preflight passed, all six intended migrations passed on a fresh restored clone, and the V1/V2 ownership release races passed. The required notification no-duplicate gate failed in an isolated dynamic test; exact v123 rollback and frozen recognition zero-diff remain unproven. The approved absolute stop is therefore in force **before any Production schema mutation**.

Production migration ledger remains at `20260907000003`; no provider-name or V1/V2/invariant migration was applied. `process-share-jobs` remains v123. No other Edge function, Railway service, Production OTA, App Store build, or App Review state was changed. The old public client remains on the pre-release backend; the 1.5 compatibility backend is not live.

If work resumes with the red gates genuinely cleared, create another immediately-before-mutation backup, restore-test it, recheck all live preconditions and migration ledger, apply only the six explicit migrations incrementally, verify integrity/RLS/old-new contracts after each relevant step, and only then consider the separately qualified notification Edge deployment and bounded monitoring.
