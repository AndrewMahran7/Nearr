# October 8 product consistency QA

Date: 2026-10-08
Branch: `fix/place-capabilities-images-notifications-nearby`
Base: Development commit `18f237e63305efef20def38576984980ef9c68c4`

## Scope and environment safety

Work was performed in an isolated worktree. The existing dirty checkout was not modified. The configured app/backend lane is Development and the linked Supabase project is Nearr-Dev (`qnfxnmvxpjzfydgudtvs`). Production (`rlqvxdwtetxsqxhqztkw`) is not linked and must not be written or deployed by this change.

No onboarding redesign, recognition-model change, Jev integration, monetization change, database migration, or Railway service change is included.

## Founder issue disposition

| Issue | Resolution |
|---|---|
| Mad Yolks broken actions | Central capability model; valid local actions retained and server-only actions hidden/guarded |
| One-photo continuity | Lossless candidate conversion, canonical max-five inventory, progressive persistence, snapshot-v3 restart recovery |
| Roughly one-minute notification | Proven minute-cron wait; event-driven post-finalization dispatch added with cron fallback |
| Foreground suppression | Suppress only the exact share-job result already visible; nearby/unrelated notifications still present |
| Nearby showing distant places | Canonical radius gate now precedes nearest sorting |
| Mad Yolks in Other | Fixture normalized to `restaurant`; Food includes `cafe` |
| Dev preview cards in normal queue | Removed from normal queue; retained in Development-only QA screen |
| Share extension completion | Primary Done action and explicit safe-to-close copy retained; Open Nearr stays secondary |
| Quick Check missing image | Candidate photo fields now survive conversion and are consumed immediately |
| Extra post-auth tap | Normal successful auth already completes and routes automatically; Continue remains only as Development/recovery affordance |
| Duplicate completion | Existing single navigation authority retained; no second completion owner added |
| Map camera shift after card close | Existing close-without-camera-move contract retained and regression-tested |
| `RCTAppearance` warning | No app-owned listener/suppression found; exact warning absent from retained evidence and deferred to physical capture if reproducible |

## Automated QA matrix

The focused aggregate command is `npm run test:oct8-product-consistency-suite`. It covers place capability boundaries, photo contract, notification authority/presentation, Nearby/category rules, cross-file product consistency, and the founder journey.

Additional focused coverage includes saved snapshots/images, share completion and extension completion, Quick Check rolodex, category pipeline, place sharing, result notification/tap routing, worker boot, Google cost controls, onboarding final journey, onboarding Phase 2, onboarding physical QA regressions, and map camera transaction behavior.

Release-gate results:

1. `npm run typecheck` — PASS
2. `npm run test:oct8-product-consistency-suite` — PASS
3. `npm run test:prebuild` — PASS after installing the media-worker's locked dependencies with `npm ci`
4. `npx expo export --platform ios` — PASS, 1,809 modules / 42 assets
5. `npx expo export --platform android` — PASS, 1,809 modules / 42 assets

The first prebuild attempt stopped before product assertions completed because the fresh worktree did not yet have `services/media-worker/node_modules` and therefore could not resolve `tsx`. After `npm ci` in that package, the complete gate passed from the beginning.

## Development deployment plan

Only components changed by this task should deploy:

- Supabase Edge Function: `process-share-jobs` to Nearr-Dev;
- Expo OTA JavaScript update to the Development branch/runtime, because the client changes are JS-only;
- no Railway deployment;
- no native build unless the export/runtime checks reveal a native requirement;
- no Production deployment.

The lane/project/runtime must be re-read immediately before each write or deployment.

## Physical founder QA still required

Automated validation cannot establish T5/T6 device receipt timing or visually approve the real iOS flows. On a physical iPhone Development build, verify:

1. fresh onboarding through Mad Yolks, including Directions, Watch, and native Share;
2. absence of reminder/edit/visited/wrong/delete actions on the tutorial card;
3. a real multi-photo share through Quick Check, Recent Finds, saved card, detail gallery, force-quit, and relaunch;
4. a completed share notification in background, foreground on another screen, and foreground on the exact same result screen;
5. nearby places at radius boundaries and Mad Yolks in Food only;
6. share extension Done/Open Nearr behavior;
7. post-auth automatic transition and a single completion transition;
8. map card close without camera motion;
9. full capture of any recurring `RCTAppearance` warning.
