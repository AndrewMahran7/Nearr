# Nearr-Dev live-boundary test results — 2026-10-18 PDT

**2026-10-19 update:** In addition to the rollback-contained SQL tests below, live synthetic anonymous requests now passed: 401 unauthenticated, 403 undeclared/under-18 on both legacy and queued Edge routes, adult age pass before invalid-URL/metadata rejection, locked adult decision, and 200 cleanup for all test accounts. The pending-age claim regression passed again after the age-gated worker deployment. See `DEVELOPMENT_PROVENANCE_DEPLOYMENT_20261019.md` and `liveAgeGateSynthetic.mjs`. The unrun-live statement below describes the Oct 18 state only; real adult recognition/save and physical-client QA remain unrun.

The following actually ran against Nearr-Dev `qnfxnmvxpjzfydgudtvs` using `supabase db query --linked --file ...`; each transaction deliberately rolled back:

| Contract | Result |
| --- | --- |
| `dev_age_eligibility_transaction_test.sql` | PASS: adult/underage declaration, lock/idempotency, RLS and service-RPC restrictions |
| `dev_age_transfer_transaction_test.sql` | PASS: anonymous declaration propagation, replay/idempotency and restricted destination precedence |
| `dev_age_queue_guard_transaction_test.sql` | PASS: ineligible job/task requeue and manual claim transitions denied |
| `development-integration/dev_claim_media_tasks_live_transaction_test.sql` | PASS: installed `claim_media_tasks(1,60)` did not lease the preserved due, pending-age task; transaction rolled back |

After these tests: age-decision count 0, queued media-task count 1. The task was not erased. The recent worker log showing a pending-owner AI-note model call was timestamped **before** the Oct 18 migration commit, not evidence of a post-migration guard bypass. Current deployed worker code remains age-unaware, which is why no live provider-negative conclusion is made.

No isolated authenticated adult/unknown/underage/revoked user was created; no live Edge share was sent. Sending a pending/underage URL through the still-ungated synchronous `process-share-link` could invoke providers, so that unsafe test was not run. Consequently actual adult share→recognition→save, old 1.4 request replay, revocation during processing, transfer through deployed clients, saved-photo/map preservation, concurrency and provider-call telemetry remain **unrun**. Local helper/worker tests are separately documented in `AGE_ELIGIBILITY_PREBUILD_RESULTS.md`. No paid provider calls were made by this run.
