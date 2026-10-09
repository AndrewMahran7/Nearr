# Nearr 1.5.58 release QA — BLOCKED (V2 CONCURRENCY STOP)

2026-10-09: the single investigated Production ownership repair and fresh encrypted post-repair backup/restore passed. A replacement V2 candidate then created an ownership mismatch in an isolated two-session local race; see `V2_TRANSFER_CONCURRENCY_REPORT.md`. It was quarantined outside the migrations directory. Stop before provider-name/V2 migrations, Edge deployment, App Store upload, or submission. Remaining gates below were not waived or completed by the repair.

Build `693249e5-f54c-4abd-b76d-cdb8bee9eb07` (1.5.58/build 58, source `ca08c154347096fe5da0bf2739cf0b25c0b706b0`) remains the intended artifact; no rebuild was attempted. Backend parity, transfer security/concurrency, notification concurrency, frozen recognition replay, live two-version smoke, designated Production QA identities, and physical device upgrade/fresh-install checks remain open. Do not submit the build or release publicly.

Founder physical QA after backend gates pass: (A) fresh build 58 onboarding with Google and Apple; real share → review/save → photos, notification, nearby/category/source video; (B) established public 1.4.55 QA account with multiple recorded saves and map state → install build 58 → verify retained session, no onboarding restart or duplicate profile, saves/map/photos, Queue/reminders/Share Extension.
