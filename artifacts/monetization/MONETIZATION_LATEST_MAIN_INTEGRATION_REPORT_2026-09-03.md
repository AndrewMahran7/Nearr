# Nearr Monetization — Latest Main Integration Report

Date: 2026-09-03

Scope: Nearr-Dev validation only

Implementation commit: `3a6d4d40bc4158c98a4c0f844bdea404351f0edf`

Verdict scope: the Dev mock purchase and place-find accounting experience is ready for founder QA; real StoreKit purchasing is not implemented and remains a Production blocker.

## A. Isolation

- Repo: `C:\Users\andre\Desktop\Nearr`
- Source monetization branch: `design/vayrin-monetization-architecture`
- Source HEAD: `3d4bc68b3565d68cbd55900ebd635dfbcb302ceb`
- Source base commit: `0982bacdec33a0d9f17479e9e1e3899f6a16f24b`
- Source worktree: `C:\Users\andre\Desktop\Nearr-worktrees\vayrin-monetization-architecture`
- Integration worktree: `C:\Users\andre\Desktop\Nearr-worktrees\monetization-latest-main`
- Integration branch: `integration/monetization-latest-main`
- Base current main: `9950adf709f2b44dee069ec57b81bdece4ef87cf`
- Final implementation HEAD: `3a6d4d40bc4158c98a4c0f844bdea404351f0edf` (this report is committed afterward as a documentation-only handoff commit)
- Relationship to main: one implementation commit on top of the exact current `origin/main`; merge base is `9950adf709f2b44dee069ec57b81bdece4ef87cf`.
- Clean: yes at implementation/deployment; final cleanliness is verified after committing this report.
- Original checkout: not modified. Its pre-existing dirty files were left untouched.

## B. Existing monetization implementation

### Implemented on the old branch

The old branch contained one architecture/documentation commit: a monetization architecture document, a pure in-memory ledger/model, tests for that model, and draft SQL. It described:

- one unmetered onboarding recognition;
- five lifetime free uses for a permanent account;
- reserve at authenticated job creation;
- consume for a durable useful result;
- release for failure or no useful action;
- one charge per submitted job, including multi-place and cache-hit results;
- same completed URL returning the prior result for free, with an explicit rerun creating a new use;
- anonymous onboarding identity and exactly-once reconciliation at signup;
- consumable StoreKit 2 packs, with server-side transaction verification and a durable ledger as the intended direction.

### Missing on the old branch

- No deployable paywall or balance UI.
- No StoreKit/native IAP dependency or app configuration.
- No real or sandbox Apple product identifiers.
- No product fetch, purchase call, transaction verification, or unfinished transaction synchronization.
- No App Store Server Notifications handler or refund/revocation processing.
- No applied database migration, Edge function, worker integration, release configuration, or Dev deployment.

### Old assumptions

The old design assumed an older job pipeline, a separate anonymous-accounting design, old named Vayrin product copy, and queue/cache/navigation behavior that predated current main. Those assumptions were treated as policy input, not merged as implementation.

## C. Current-main integration

The old branch was not merged. Its policy was manually ported onto current main, then the integration commit was rebased onto the latest `origin/main` without textual conflicts.

| Area | Old monetization assumption | Current main behavior | Final integrated behavior |
|---|---|---|---|
| Billing finalization | General worker/job completion hooks | All terminal lifecycle paths converge in `process-share-jobs` and its finalizer | The Edge finalizer alone owns consume/release; Railway does not duplicate billing |
| Anonymous onboarding | Separate entitlement-transfer design | Supabase anonymous auth plus the exactly-once onboarding V2 transfer migration | Onboarding remains unmetered once; permanent-user wallet initialization grants five exactly once |
| Product language | Named Vayrin uses/assistant terminology | User-facing Vayrin branding removed | Neutral “place finds” copy throughout; internal legacy identifiers remain only where current main already uses them |
| Queue/navigation | Older queue and handoff assumptions | Current queue inbox, job detail, auth routing, candidate review, and handoff flows | `awaiting_purchase` is integrated into those current components; no stale UI was restored |
| Recognition | Earlier, simpler result taxonomy | Metadata, Gemini/Sol escalation, cache, exact, candidate, multi-place, truthful partial/discovery, and explicit failure taxonomy | Settlement classifies current terminal output and charges once only for an actionable result |
| Cache | Conceptual cache policy | Current trusted recognition cache and centralized finalization | Cache-hit-shaped success consumes once per job, matching the prior product policy |
| Map | No awareness of current camera/pin transaction work | Current camera transaction and pin/cluster stability behavior | No map files or map semantics were changed by monetization |

Newer auth/session routing, onboarding V2, queue/review UI, candidate confirmation, multi-place review, recognition cache, notification behavior, map camera/pin stability, and Production configuration/release documentation were preserved. The final source rebase also incorporated `7ba7dbf`, `b1f71b0`, and `9950adf`; those new main commits touched only the branding-cleanup Production release record.

## D. Entitlement model

- Free allocation: one unmetered anonymous onboarding recognition plus five lifetime uses when a permanent account wallet is first initialized.
- Existing accounts: initialized lazily and receive the same `lifetime_v1` five-use grant exactly once, so an old account is not immediately blocked merely because it predates the ledger.
- Reserve: one use is atomically moved from available to reserved when an authenticated job is created. With no available use, the job is persisted as `awaiting_purchase` instead of being discarded.
- Consume: a completed result consumes. An actionable `needs_help` result also consumes when it contains a candidate, saved result, multi-place result, or an observable discovery lead.
- Release: technical failure, acquisition/no-media failure, cancellation, or a terminal result with no actionable output releases the reservation.
- Multi-place: one video/job consumes exactly one use, regardless of destination count.
- Cache: a successful cached result consumes one use, matching the existing product policy.
- Duplicate URL: an already completed URL returns its prior result without a new charge; explicit `forceRerun` creates a new billing cycle.
- Retry: only failed jobs may retry; a retry after release creates a new reservation cycle and cannot debit the prior reservation again.
- Crash/lease expiry: stale settlement recovery understands pending consume/release markers and releases true orphaned reservations.
- Anonymous reconciliation: current onboarding V2 ownership transfer remains exactly once. A physical-device reinstall guarantee is not claimed: a new anonymous auth identity can be minted after reinstall unless device attestation or another durable device signal is added.

## E. Ledger

- Server authority: PostgreSQL wallets, lots, reservations, free-grant claims, purchase transactions, onboarding claims, and append-only ledger rows are the source of truth. The client may display a fetched balance but cannot mint or mutate it.
- Audit data: each balance mutation records its wallet/user association, event type, deltas, reason, share job and/or transaction reference where applicable, an idempotency key, and creation time.
- Idempotency: unique grant claims, reservation-per-job identity, ledger idempotency keys, and unique purchase transaction identities prevent duplicate grants and charges across app resume, callbacks, finalizer replay, and worker replay.
- Concurrency: wallet rows are locked in server functions before allocation; two jobs cannot overspend the same last use.
- Account deletion: the wallet is closed and live reservations are released before auth deletion. Immutable transaction/replay evidence remains pseudonymized rather than being silently destroyed.
- RLS/grants: monetization tables have RLS enabled; users receive owner-scoped reads only where needed. Mutation procedures and mock purchase application are service-role-only.

## F. StoreKit

- Library: none present in the current app.
- Native module already in current binary: **NO**.
- New Dev build required: **YES for real StoreKit sandbox purchasing**. It is not required for the intentionally labeled Dev mock flow shipped by this ticket.
- Current Dev binary: app/runtime `1.3.52`, build `52`, build ID `4e118a76-9216-43ed-adf1-9069f9c69014`; created 2026-08-20 and expired for new installation on 2026-09-03. An already installed build can receive the OTA. A fresh installation requires a new internal build.
- Products: no Apple sandbox or Production product IDs were found. The only configured identifiers are explicitly fake `dev.mock.nearr.place_finds.*` IDs.
- Product fetch/purchase: real StoreKit product fetch and purchase are absent. The Dev mock endpoint is the only purchase path currently enabled.
- Verification: the database schema supports verified StoreKit transactions, but no App Store verification implementation exists. Any real verification request fails closed with HTTP 503 and grants nothing.
- Notifications: a storage table exists for idempotent notification intake, but there is no App Store Server Notifications endpoint, signature verification, refund, chargeback, or revocation processor.
- Restore/sync: the UI says “Sync purchases,” not “Restore Purchases.” Consumable packs are not represented as misleading restorable entitlements; real unfinished-transaction synchronization remains to be implemented with StoreKit.

## G. Pricing

- Current Dev mock Variant A: 10 place finds / $3.99; 25 / $8.99; 50 / $15.99.
- Displayed source: server-returned Dev mock product metadata, clearly labeled mock. Real StoreKit prices must come from App Store product metadata and are not faked.
- Configuration: shared policy lives in `lib/placeFindConfig.ts`; authoritative Dev product rows are seeded by `20260903000001_place_find_monetization.sql`.
- Changing Dev pricing: edit the centralized Dev mock pack definitions and the matching Dev product seed/update, run `npm run test:monetization-integration`, apply the database change to Nearr-Dev, and publish a development OTA. Multiple genuine StoreKit price variants require actual App Store Connect product/price configuration.
- Production safety: mock products are seeded inactive. A grant can activate the selected SKU only inside the exact Nearr-Dev project, with the Dev server flag enabled, for a permanent user on the server-side allowlist.

## H. Paywall UX

- Entry points: zero-balance share handoff, an `awaiting_purchase` queue/job detail, and the Settings purchase section. These converge on one monetization modal rather than stacking paywalls.
- Pending share preservation: the source URL and job remain in `awaiting_purchase`. A successful purchase can resume that exact job without asking the user to reshare.
- Balance: a reusable component reports natural language such as “5 place finds left”; available balance excludes a currently reserved use.
- Copy/visuals: cream `#F4F2EF`, charcoal `#0F1014`, orange `#FF6A1A`; no purple, token/crypto language, casino treatment, mascot, or user-facing Vayrin naming.
- States: normal, exhausted, loading, success, error/unavailable, permanent-account-required, and pending-share continuation are represented. Controls meet the 44-point minimum target and have accessible labels/roles.
- Share extension: future binaries include the updated extension source. Existing binaries cannot receive extension-code changes via OTA, so the host app queue/paywall is the reliable path for the currently installed build.

## I. Schema

- Main migration: `20260903000001_place_find_monetization.sql`.
- Dev history compatibility markers: `20260819000002`, `20260820000001`, `20260820000002`, and `20260824000001`. These reconcile versions already present in Nearr-Dev; they do not replay stale schema.
- Applied to Nearr-Dev: **YES**. The push applied `20260821000002`, `20260821000003`, `20260822000001`, `20260825000001`, and `20260903000001` successfully.
- Post-deploy migration check: local and remote histories match through `20260903000001`.
- Production: **UNCHANGED by this task**.

## J. Backend

- Billing lifecycle owner: `process-share-jobs` Edge finalization. It writes a recoverable pending settlement marker before the atomic settlement RPC.
- `create-share-job`: derives anonymity server-side, supports explicit rerun, reserves atomically, and returns `requiresPurchase` plus authoritative available balance.
- `monetization`: authenticated balance/product sync, allowlisted Nearr-Dev mock purchase, pending-job resume, and fail-closed real verification behavior.
- `delete-account`: closes the wallet and releases reservations before deleting the auth user.
- Live Nearr-Dev Edge versions: `monetization` v1 ACTIVE/JWT on; `create-share-job` v21 ACTIVE/JWT on; `process-share-jobs` v60 ACTIVE/JWT off for the protected worker callback contract; `delete-account` v18 ACTIVE/JWT on.
- Railway: media-worker code was unchanged, so no Railway deployment was justified. Existing Dev deployment `219fb783-3cbf-440a-875d-29f13010d6a8` remains SUCCESS/RUNNING and its health endpoint returned 200.

## K. Tests

All deterministic commands completed with zero exit status unless explicitly described as an expected negative probe.

| Command / gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run test:monetization-integration` | PASS — 25/25 |
| Auth account state, recovery, account/deletion suites | PASS |
| Onboarding V2 full suite | PASS |
| Share submission/client, routing, detail state, handoff suites | PASS |
| Queue inbox, UI, interaction suites | PASS |
| Result notification and failure presentation suites | PASS |
| Recognition cache and current recognition-core suites | PASS |
| Multi-place batch/review and candidate confirmation V2 suites | PASS |
| Full map pin/cluster/camera reliability suites | PASS |
| `services/media-worker: npm run typecheck` | PASS |
| `services/media-worker: npm test` | PASS — 450 tests, 443 passed, 7 skipped, 0 failed |
| `services/media-worker: npm run build` | PASS |
| Deno check of four changed Edge functions with root config discovery disabled | PASS |
| `npm run test:startup-smoke` | PASS |
| `npm run test:release-gate` | PASS |
| `npm run test:deployment-guards` | PASS |
| `npm run test:prebuild` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS |
| Nearr-Dev database push and migration history verification | PASS |
| Nearr-Dev Edge deploy and ACTIVE/JWT posture verification | PASS |
| Railway Dev health | PASS — HTTP 200 |
| Monetization unauthenticated negative probe | PASS — HTTP 401 |
| Development OTA publish | PASS |

The media-worker E2E harness includes a deliberate simulated “Railway never claimed task” failure inside its self-test; the enclosing test asserts that behavior and passed. Offline suites likewise log deliberately injected parse/disk failures while passing their recovery assertions.

## L. Nearr-Dev

- OTA: **DEPLOYED** to development only, runtime `1.3.52`, iOS and Android.
- OTA update group: `6d4a9f55-ab5f-4c23-b52c-5f0212498fe8`.
- OTA commit: `3fc5ed26e492fe35ea56e7837b34eccdb9df04d7`.
- Traceability: the OTA was published immediately before `origin/main` gained three Production release-record-only commits. The final rebase changed the implementation commit identity to `3a6d4d40bc4158c98a4c0f844bdea404351f0edf` but changed no app, Edge, migration, or worker payload, so the deployed bundle is code-equivalent to the final implementation.
- EAS build: **NOT CREATED**. No native dependency/config changed, and there is no honest StoreKit implementation to embed. The existing build can exercise the JS-only Dev mock flow if already installed; a new build is necessary for fresh installation and eventually for real StoreKit.
- Edge: four affected functions deployed to Supabase project `qnfxnmvxpjzfydgudtvs` only.
- Railway: unchanged; current Dev deployment remains healthy.
- Schema: monetization migration applied to `qnfxnmvxpjzfydgudtvs` only.
- EAS Dev environment: monetization enabled in `dev_mock` mode.
- Server Dev gate: mock purchase enabled with exactly one founder permanent account allowlisted. No account identifier or secret is stored in this report.
- Production OTA observed after deployment audit: group `e7cf618a-09ad-4280-a532-e07fb2368385`, runtime `1.3.52`, message “Remove user-facing Vayrin branding.” It was not published or modified by this task.

## M. Dev test accounts/setup

1. Use the one permanent founder account already present in Nearr-Dev and server-allowlisted for mock purchases.
2. Launch an already-installed Nearr development build and allow it to download the development OTA. Confirm runtime `1.3.52` and update group `6d4a9f55-ab5f-4c23-b52c-5f0212498fe8` in diagnostics if available.
3. The first permanent-account wallet read initializes five lifetime place finds exactly once. Logging out and back in must not repeat that grant.
4. An anonymous onboarding session may perform its single onboarding recognition, but it cannot buy mock packs until converted to a permanent account.
5. Only the allowlisted founder account can complete Dev mock purchases. Other users see the safe unavailable state and cannot mint a balance.
6. If the app is not already installed, the prior internal iOS build has expired and a fresh development build must be created before device QA. This is an installation constraint, not an OTA or server failure.

## N. Founder QA

Shortest physical test:

1. Open Settings → Place finds and confirm “5 place finds left” on first permanent-account initialization.
2. Confirm the three clearly labeled mock packs: 10/$3.99, 25/$8.99, 50/$15.99.
3. Share one resolvable place video. Confirm the balance reserves immediately and ends one lower after a useful exact, candidate, cache, or multi-place result.
4. Share a multi-place video and confirm it decreases by one, not by the number of destinations.
5. Trigger or observe a technical/acquisition failure and confirm the reserved use returns.
6. Exhaust the balance, share another post, and confirm the post remains visible as awaiting purchase and opens one clear purchase path.
7. Buy a Dev mock pack. Confirm success, refreshed balance, and automatic resumption of the preserved post.
8. Tap the same pack twice/retry after a network interruption; confirm the UI recovers and no single transaction identity grants twice.
9. Log out/in on the same permanent account and confirm the server balance persists without another free grant.

For deterministic zero/one-balance setup beyond natural consumption, use service-role/admin tooling against Nearr-Dev; no public reset or balance-mutation control was added.

## O. Production

- Main merge: **NO**.
- Production deployment: **NO**.
- Production schema/secrets/config: **UNCHANGED by this task**.
- No Production product IDs or prices were invented.

## P. Remaining blockers

These do not block the explicitly labeled Nearr-Dev mock UX review, but they block real sandbox purchase QA and any Production release:

1. Select and integrate a current Expo-compatible StoreKit 2/IAP native library, then create a new development binary.
2. Configure real App Store Connect sandbox and Production consumable product IDs and pricing. StoreKit/App Store metadata must drive real displayed prices.
3. Implement server-side App Store transaction verification, bind the transaction to the app account token/product/environment, and finish/synchronize transactions safely.
4. Implement and authenticate App Store Server Notifications with idempotent refund, revocation, chargeback, and correction policy. The existing notification table is storage only.
5. Decide the business rule for refunds after uses have already been consumed; the system must not blindly drive balances negative.
6. Add device attestation or another durable abuse control if the product requires onboarding entitlement enforcement across reinstall-created anonymous identities.
7. Produce a fresh internal Dev build if the founder no longer has build 52 installed; the prior install artifact has expired.
8. Perform physical accessibility/VoiceOver and actual device visual review. Windows had no iOS simulator, so no trustworthy screenshots were captured.

## Q. Final verdict

MONETIZATION INTEGRATION UPDATED TO LATEST MAIN — READY FOR FOUNDER DEV QA
