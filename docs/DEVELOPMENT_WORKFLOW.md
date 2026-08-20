# Nearr — Development Workflow

> Created 2026-08-19. Owner: Andrew.
> Purpose: run several tasks (and several AI agents) at once without risking production.

Production broke on 2026-08-18 because there was only ever **one lane**. `eas update`
with no arguments published to the `production` channel, from a feature branch, with a
dirty working tree, straight to real users. This document describes the three lanes that
replace it, and the small number of guards that make the wrong command fail instead of ship.

```
task A ─┐
task B ─┼─→ own branch + own worktree ─→ integration/<milestone> ─→ iPhone ─→ main ─→ production
task C ─┘
```

---

## 1. The three lanes

| | Feature | Integration | Production |
|---|---|---|---|
| Git | `feat/<slug>` in its own worktree | `integration/<milestone>` | `main` |
| EAS channel | `development` | `preview` | `production` |
| EAS environment | `development` | `preview` | `production` |
| App on the phone | dev build (replaces App Store Nearr — §12F) | same build | Nearr (App Store) |
| Backend | development Supabase + Railway `development` | same | production Supabase + Railway `production` |
| Who publishes | designated integration/deployment owner | you | you, from `main`, with `--yes` |

`main` means **production-ready**, not "whatever finished most recently". Nothing reaches
`main` before it has passed its own tests, integration tests, and a physical iPhone check
where the change is user-visible.

---

## 2. Start a task

```powershell
npm run task:new -- shazam-v2 --base integrate/safe-development-baseline
```

Creates branch `feat/shazam-v2` and worktree `..\Nearr-worktrees\shazam-v2`, based on the
explicit ref, and prints the base commit. `--base` is mandatory: until physical validation
and promotion, `main` is not the approved feature base. After promotion, use `--base main`.

```powershell
cd ..\Nearr-worktrees\shazam-v2
npm install     # worktrees do NOT share node_modules
```

Options: `--kind fix|chore|docs|test|integration`. Always provide `--base <ref>`.

List everything in flight: `npm run task:list`. Clean up after merge:

```powershell
git worktree remove ..\Nearr-worktrees\shazam-v2
git branch -d feat/shazam-v2
```

## 3. Run several tasks at once

```powershell
npm run task:new -- vayrin-core --base integrate/safe-development-baseline
npm run task:new -- onboarding-v2 --base integrate/safe-development-baseline
npm run task:new -- tiktok-parity --base integrate/safe-development-baseline
```

Give each agent the brief in [AGENT_TASK_TEMPLATE.md](AGENT_TASK_TEMPLATE.md). The rules
that matter:

1. Work **only** inside your assigned worktree. Never read or write another's.
2. Record the base commit you started from.
3. Commit your own work; report the commit hash and files changed.
4. Report migrations, backend impact, and what deployment the change needs.
5. Never merge yourself into `main`. Never publish to `production`.

Worktrees are genuinely isolated: separate working directory, separate index, separate
`node_modules`. They share only the object database, which is append-only.

### What if two tasks need the same thing?

| Situation | Rule |
|---|---|
| Both frontend-only | Run in parallel freely. |
| Both touch different backends (one Edge Function, one media-worker) | Run in parallel freely. |
| Both touch the **same** backend service | Code in parallel, **serialize the deploy**. One owns the dev worker at a time. |
| Both need the phone at once | They don't. The dev channel is one slot — see below. |

**The `development` channel is a single shared testing slot.** One feature's JS lives there
at a time. Say which one in the update message; the Settings → Build info card on the phone
shows the update ID so you can confirm what you are looking at. If you genuinely need two
features on the device together, that is what the integration branch and the `preview`
channel are for.

Only create a temporary Railway environment if serializing actually blocks you. One shared
development worker is the right default for a solo founder.

Backend deployment ownership is stricter than source ownership:

- Feature agents may write/test backend code locally, but do not deploy shared infrastructure.
- Merge the backend change into the current integration branch first.
- One named deployment owner runs one `dev:functions`, `dev:db`, or `dev:worker` command at
  a time and records the integration commit deployed.
- App-only OTA publishing also waits for integration approval; the development/preview
  channel is not an agent scratchpad.
- Production deployment is never run from a feature or integration worktree—only validated,
  promoted, clean `main` can satisfy the wrappers.

---

## 4. Test the frontend without production

**JS-only change** (screens, logic, styles) — publish over the air:

```powershell
npm run dev:update -- -m "Shazam V2: first pass"
```

Then open the dev build on the iPhone, force-quit, reopen. `npm run dev:update` always
passes `--channel development --environment development` explicitly and validates that
environment before publishing. There is no way to reach the production channel from it.

**Native change** (new native module, plugin, permission, entitlement, bundle ID, anything
in `app.json` `plugins` or `ios.infoPlist`) — a new build is required:

```powershell
npm run dev:build
```

Rule of thumb: if it changes `ios/` after `expo prebuild`, it needs a build, not an update.

## 5. Test the backend without production

**Media worker (Railway):**

```powershell
npm run dev:worker -- --yes # designated owner deploys to Railway `development`
npm run dev:worker:logs
curl.exe -fsS https://media-worker-development.up.railway.app/health
```

The deploy wrapper owns the Railway project/environment/service flags, reads Railway's
`SUPABASE_URL` first, and refuses unless it resolves to Nearr-Dev. `--yes` means the
designated deployment owner has acquired the shared development deployment slot. Logs are
read-only and do not need a confirmation. Production has its own stricter wrapper (§10).

**Edge Functions:**

```powershell
npm run dev:functions -- process-share-jobs --yes
```

Requires `NEARR_DEV_SUPABASE_REF` in `.env.local` (or `--project-ref`). It never falls back
to the linked project — the 2026-08-19 audit found that project was production. It also applies
`--no-verify-jwt` automatically to `process-share-jobs` and `process-share-link`, which
authenticate callers themselves and have broken before when redeployed without it.

**Database:**

```powershell
npm run dev:db              # dry run: shows the target and what would be applied
npm run dev:db -- --yes     # apply supabase/migrations/ to Nearr-Dev
```

Four gates, all of which must pass before the Supabase CLI is invoked at all: the ref must
be set explicitly, must not be the production ref, must be the Nearr-Dev ref this repo
knows, and the CLI's own link must agree with it. `npm run test:dev-db-guard` proves it
refuses production. See §7.

---

## 6. Environment variables

Two declarations decide everything. Both are explicit; neither is inferred from a URL.

| | `EXPO_PUBLIC_APP_ENV` | `EXPO_PUBLIC_BACKEND_ENV` |
|---|---|---|
| development lane | `development` | `development` |
| preview / integration | `preview` | `development` |
| production | `production` | `production` |

The rules live in [`lib/appEnvironmentCore.ts`](../lib/appEnvironmentCore.ts), are locked
down by `npm run test:app-environment`, and are enforced in three places:

- **config generation** — `app.config.js` throws on a contradictory lane or wrong project.
- **before publishing** — `npm run verify:env -- --eas-environment <name>` reads the EAS
  environment and refuses if it is unsafe. Every `*:update` script runs this first.
- **at runtime** — `lib/appEnvironment.ts` logs the resolved lane at startup and feeds the
  Settings → Build info card.

The two rules that matter:

- A **production** app must never ship **development** endpoints.
- A **development/preview** app must never reach the **production** backend. The former
  `EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND` escape hatch is retired and now fails the build.
- Labels are not trusted by themselves: `development` must resolve to project
  `qnfx…dtvs` (Nearr-Dev), and `production` to `rlqv…qztkw`. All share endpoint hosts must
  match that Supabase host.

### Matrix

No values here — only where each one lives. Never paste secrets into this repo.

| Variable | Dev | Production | Owner |
|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | `development` | `production` | EAS environment |
| `EXPO_PUBLIC_BACKEND_ENV` | `development` | `production` | EAS environment |
| `EXPO_PUBLIC_SUPABASE_URL` | dev project | prod project | EAS environment |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | dev project | prod project | EAS environment (sensitive) |
| `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` | dev project | prod project | EAS environment |
| `EXPO_PUBLIC_CREATE_SHARE_JOB_URL` | dev project | prod project | EAS environment |
| `EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED` | per experiment | `true` | EAS environment |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | native Maps SDK key | native Maps SDK key | EAS environment (sensitive) |
| `EXPO_PUBLIC_GOOGLE_PLACES_KEY` | dev-only REST key | production REST key | EAS environment (sensitive) |
| `EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND` | **must be unset** | **must be unset** | retired |
| `APP_VARIANT` | `dev` | unset | `eas.json` build profile |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **dev project** | prod project | Railway env / Supabase secrets |
| `SHARE_JOBS_FINALIZE_URL`, `MEDIA_FINALIZE_SECRET`, `SHARE_MEDIA_WORKER_SECRET` | dev-specific | prod-specific | Railway env / Supabase secrets |
| `GEMINI_API_KEY`, `MEDIA_TRANSCRIPTION_API_KEY`, `GOOGLE_PLACES_KEY` | may be shared | shared | Railway env / Supabase secrets |
| `NEARR_DEV_SUPABASE_REF` | dev project ref | n/a | your `.env.local` |

Provider API keys are quota/security surfaces. Prefer separate development keys, especially
for on-device REST calls. **Anything that names a project, database, queue
or callback must be environment-specific**: that is the boundary that keeps experiments
away from real user rows.

### Google Places on the development app

`services/placesService.ts` calls Google's legacy web-service endpoints (`place/textsearch`,
`place/details`, `place/photo`) plus `geocode/json`; it does not use Places API (New).
The key path is:

```text
EXPO_PUBLIC_GOOGLE_PLACES_KEY (preferred REST key)
  -> EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (compatibility fallback)
  -> app.config.js extra.googlePlacesKey
  -> services/placesService.ts
```

`npm run verify:google -- --eas-environment development` currently proves the EAS lane is
using the Maps fallback key: Geocoding API and Places API (New) are authorized, but legacy
Places API is denied. The repo cannot change a Google Cloud allowlist.

One manual action remains: create a **development-only** key, enable/restrict it to exactly
`Places API` (legacy) and `Geocoding API`, leave application restriction `None` because
these REST endpoints do not honor an iOS bundle restriction, apply a strict quota/budget
alert, and save it as `EXPO_PUBLIC_GOOGLE_PLACES_KEY` in EAS `development` and `preview`.
Do not edit the production key. Re-run `verify:google`; both required rows must say `OK`.

### iOS Share Extension lane contract

The extension excludes both `expo-updates` and `expo-dev-client`. It therefore runs the JS
and `extra` values inlined at **native build time**, even after the host app receives an OTA.
For the current same-identity development build, it also uses the production app's App Group
name (`group.com.nearr.ios`). This is not a data-routing authority—the endpoint guard is—but
it can contain a stale production session marker/token after replacing the App Store app.

Before its first network call the async extension now logs only lane names and endpoint host,
then requires all of the following:

- app/backend declarations are development/development (or preview/development),
- Supabase is exactly Nearr-Dev (`qnfx…dtvs`),
- `process-share-link` and `create-share-job` hosts agree with that project,
- the shared session is initialized and unexpired.

Any configuration violation renders non-retryable `config_error`; it never calls
`create-share-job`. Never log keys, JWTs, authorization headers, or token contents. After
installing a development build, launch the host first, sign in to Nearr-Dev, then share. If
stale App Group state is suspected, remove Nearr from the phone, reinstall the development
build, launch it, and sign in before opening the Share Sheet.

### Developer credential panel

The installed development client may execute a production-mode OTA bundle, so `__DEV__` is
not a lane identity. Developer password login is visible only when
`areDeveloperToolsVisible()` sees an explicitly declared development/preview app **and**
`EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN=true`. Production rejects the flag at validation and
never renders the panel. Credential values remain environment-provided and are not committed.

---

## 7. Database migrations

`supabase/migrations/` is the source of truth. Never hand-edit schema in a dashboard, and
never modify a migration that has already been applied to production.

**Always apply through `npm run dev:db`, never `supabase db push --linked` by hand.**
`--linked` targets whichever project the CLI happens to be linked to, and on 2026-08-19 that
was production — one habitual command away from altering real user schema. The wrapper
proves its target before the CLI runs. There is deliberately no generic `db:push` script;
the production wrapper is separately named, main-only, origin-matched and explicit (§10).

Flow:

```
write migration on the feature branch
  -> apply to the dev database, verify
  -> integration branch: renumber if two tasks collided, re-verify
  -> merge to main
  -> apply to production, deliberately (§10)
```

**Naming.** `YYYYMMDD` + a six-digit sequence + slug, matching the existing files:
`20260815000001_saved_place_source_type_platforms.sql`.

**Collisions.** Two branches created on the same day will both reach for `...000001`. This
is expected and is resolved at integration, not in advance:

1. Merge task A. Its migration keeps its number.
2. Merge task B. If its filename collides, **rename B's file** to the next free sequence so
   ordering matches merge order, and re-run it from scratch on the dev database.
3. Only rename migrations that have **not** been applied to production. If one has, leave
   it alone and add a new forward migration instead.

**Verify ordering from empty**, not just incrementally — a migration that works applied
after yours locally may fail applied before yours in production:

```powershell
supabase db reset      # local stack, rebuilds from migrations/ in order
```

**Destructive migrations** (drop column, drop table, narrowing a type) get their own PR,
their own iPhone check, and are deployed backend-first with a compatibility window: ship
code that tolerates both shapes, wait for the old clients to age out, then drop. Never
combine a destructive migration with a feature in one deploy.

## 8. Integration

`main` is not where unfinished parallel work first meets. The integration branch is.

```powershell
git switch main
git pull
git switch -c integration/pre-shazam

git merge feat/shazam-v2         ; npm run verify:integration
git merge feat/onboarding-v2     ; npm run verify:integration
git merge feat/tiktok-ingestion  ; npm run verify:integration

npm run verify:integration       # full run on the combined state
npm run preview:update -- -m "integration/pre-shazam: shazam + onboarding + tiktok"
```

**Merge, do not cherry-pick.** This repo's history is feature-branch merges
(`Merge branch 'fix/...'`), which keeps each task's commits and authorship intact.
Cherry-picking is for extracting one commit out of a branch you are *not* taking whole.

Run `verify:integration` after **each** merge, not only at the end — that is how you learn
which merge broke it. Then run it once more on the final combined state: three individually
green features are not evidence that the three together are green. That combined run is the
whole point of this branch.

### Conflicts

Conflicts are resolved **here**, on the integration branch — never inside a feature
worktree, and never by an agent that can only see one side.

Never take `--ours` or `--theirs` wholesale. For each conflict:

1. State what each side was *trying to do*, in words, before touching the code.
2. Decide whether both behaviours are still required. Usually they are — that is why both
   branches exist.
3. Write a resolution that delivers both. If they are genuinely incompatible, that is a
   product decision and it comes to you, not to the agent.
4. Re-run **both** tasks' tests, not just the suite for the file you edited.
5. If the conflict revealed an interaction the individual tests could not see, add a
   regression test for that interaction on the integration branch.

Silently dropping one feature to make a merge compile is the failure mode this exists to
prevent.

## 9. Test on the physical iPhone

```
1. agent finishes the branch and commits
2. you merge into integration/<milestone>
3. npm run verify:integration            (must be green)
4. npm run preview:update -- -m "..."    (JS-only)  OR  npm run preview:build (native)
5. open the dev build, force-quit, reopen
6. Settings -> Build info: confirm channel + update ID match what you just published
7. exercise the features together, not one at a time
8. approve
```

Step 6 is not optional. It is the answer to "am I testing what I think I am testing?", and
its absence is why the 2026-08-18 incident was hard to diagnose. The card shows app name,
version, build, runtimeVersion, channel, update ID, and whether the embedded (in-binary) JS
is running. It appears only when `APP_ENV` is explicitly `development` or `preview`, so it
can never show up in the App Store build.

**JS-only vs native, restated:** an OTA can only change JavaScript and assets. Native
modules, plugins, permissions, entitlements, the bundle identifier and `runtimeVersion` all
require a new build. An update whose `runtimeVersion` does not match the installed binary
is simply never delivered.

---

## 10. Promote to production

Order matters. Nearr's dependency chain is **database → Edge Functions → worker → app**, so
deploy backend-first and keep each step backward-compatible with the clients still running
the previous JS. Users update at their own pace; an OTA is not instantaneous.

```powershell
# 1. merge approved integration work
git switch main
git merge integration/pre-shazam
git push origin main

# 2. database (only if migrations changed) — additive/backward-compatible first
supabase link --project-ref rlqvxdwtetxsqxhqztkw
npm run prod:db -- --yes

# 3. Edge Functions (only if changed; wrapper preserves per-function JWT flags)
npm run prod:functions -- process-share-jobs create-share-job --yes

# 4. Railway production worker (only if services/media-worker changed)
npm run prod:worker -- --yes
curl.exe -fsS https://nearr-production.up.railway.app/health

# 5. the app
npm run prod:update -- -m "Shazam V2" --yes      # JS-only
npm run prod:build -- --yes                       # native change -> build + submit

# 6. validate on the real production Nearr, on a real device
```

Every `prod:*` wrapper refuses unless the branch is `main`, the tree is clean, and `HEAD`
matches `origin/main`; mutating commands require `--yes`. Database additionally requires
the CLI link to equal the known production ref. Functions pass the known production ref
explicitly. Railway reads its target environment's `SUPABASE_URL` and requires the known
production ref before `railway up`. Build/update validate the production EAS environment.
After a production DB deploy, relink this development checkout to Nearr-Dev.

## 11. Rollback

Different layers roll back differently. This is the most important thing on this page.

**Frontend (OTA)** — fast and safe:

```powershell
npm run prod:rollback -- --yes
```

Republishes the previous update on that fixed channel. For a bad development OTA use
`npm run dev:rollback`; for preview use `npm run preview:rollback`. Users get the rollback
on next launch. If the app
cannot even boot, `eas update:republish` an older known-good update ID instead.

**Railway** — redeploy the last known-good deployment from the Railway dashboard
(Deployments → the green one → Redeploy), or `railway up` from the last known-good commit
with the same explicit `--environment` flags. Do not roll back by deleting the service.

**Edge Functions** — there is no built-in rollback. Restore the known-good source as a
reviewed revert on `main`, push it, then use the guarded production wrapper:

```powershell
git switch main
git revert <bad-function-commit>
git push origin main
npm run prod:functions -- process-share-jobs --yes
```

**Database — do NOT roll back schema migrations.** A reverse migration on live data
destroys rows that the forward migration created and cannot restore what it dropped. Fix
forward: write a new migration that corrects the problem. Only run a reverse migration when
one was deliberately written, reviewed, and proven against a copy of the data first.

Because of this asymmetry, **deploy migrations additively**. A column that is added but
unused is trivially recoverable; a column that is dropped is not.

---

## 12. Setup status — validated facts and required rechecks

Updated 2026-08-19 during safe-baseline integration. Do not treat old dashboard observations
as current without rechecking; repo tests cannot prove hosted secrets or phone behavior.

### Done

| | |
|---|---|
| Supabase `Nearr-Dev` project | exists, `ACTIVE_HEALTHY`, distinct from production |
| Supabase CLI link | points at `Nearr-Dev` — `--linked` no longer means production |
| Dev schema | all 27 migrations applied; 13/13 tables present |
| Dev Edge Functions | `create-share-job`, `delete-account`, `process-share-jobs`, `process-share-link` deployed with the correct JWT flags |
| EAS channels | `development`, `preview`, `production` |
| EAS `development` / `preview` | fully declared, pointing at Nearr-Dev, both pass `verify:env` |
| EAS `production` | `APP_ENV`/`BACKEND_ENV` declared; endpoints untouched; passes `verify:env` |
| Railway `development` | URL, service-role key and finalize URL all Nearr-Dev; `/ready` 200 |
| Guards | update/rollback/build/DB/functions/worker have fixed-lane wrappers; production is main+clean+origin+`--yes` |

### Hosted configuration to revalidate before physical sharing

The user has since physically confirmed Google auth and the Railway development `/ready`
check. The remaining items below came from the earlier hosted audit; verify them read-only
before changing anything. They are possible share-pipeline failure boundaries, not permission
to copy production secrets or mutate production.

**A. Supabase Edge Function secrets in `Nearr-Dev`** — the functions are deployed but have
no configuration, so place resolution and the worker handshake will fail. Set with
`supabase secrets set --project-ref <dev-ref> NAME=...`:

| Name | Required? | Must match |
|---|---|---|
| `GOOGLE_PLACES_KEY` | required | any working Places key (may be shared with production) |
| `GEMINI_API_KEY` | required | any working Gemini key (may be shared) |
| `GEMINI_MODEL` | optional | defaults if unset |
| `SHARE_JOBS_WORKER_SECRET` | required | the Vault `share_jobs_worker_secret` below |
| `MEDIA_FINALIZE_SECRET` | required | Railway `development` `MEDIA_FINALIZE_SECRET` |
| `TRANSCRIPTION_PROVIDER`, `SELF_HOSTED_TRANSCRIPTION_URL`, `TRANSCRIPTION_SERVICE_API_KEY`, `SOSCRIPTED_API_KEY` | optional | legacy path only |
| `MEDIA_AUTO_SAVE_THRESHOLD`, `MEDIA_AUTO_SAVE_CANARY_USER_ID`, `PHASE2_CANARY_USER_ID` | optional | rollout controls |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase — do **not** set them.

**B. Vault secrets in `Nearr-Dev`** (SQL editor). This is how `process-share-jobs` finds the
worker; without it dev jobs never reach the dev worker:

| Vault secret | Value |
|---|---|
| `share_jobs_worker_edge_base_url` | the Nearr-Dev functions base URL |
| `share_jobs_worker_service_key` | the Nearr-Dev service-role key |
| `share_jobs_worker_secret` | must match the `SHARE_JOBS_WORKER_SECRET` above |
| `share_media_worker_url` | `https://media-worker-development.up.railway.app` — **not** production |
| `share_media_worker_secret` | must match Railway `development` `SHARE_MEDIA_WORKER_SECRET` |

**C. Railway `development` variables.** Recheck `MEDIA_FINALIZE_SECRET` before deploying
current source; `/ready` was confirmed green, but that only proves the deployed revision's
requirements. Also compare
`TIKTOK_MEDIA_RESOLVER_ENABLED` (and `FACEBOOK_`/`SNAPCHAT_` if wanted) — present in
production, absent in development.

The prior audit found `SHARE_MEDIA_WORKER_SECRET` identical across lanes. Recheck without
printing either value; if still true, rotate only the development secret and its matching
Nearr-Dev Vault value. Do not change production during this task.

**D. Railway auto-deploy.** The prior audit found the `development` service deploying from
`fix/phase1-intermittent-crash-20260802` (2026-08-03), so it silently reverts anything you
push with `npm run dev:worker`. In the Railway dashboard → project `Nearr Phase 2 Dev` →
environment `development` → service `media-worker` → Settings → Source: disconnect the
branch trigger (or repoint it to `main`). Explicit `npm run dev:worker` is the model this
workflow assumes.

**E. Supabase Auth in `Nearr-Dev`.** Google sign-in has now been physically confirmed.
Keep `nearr://auth-callback` and `nearr:///auth-callback` in the redirect allowlist
(`nearrdev://` variants only if side-by-side identity is later enabled, §F). Apple remains
separately unverified; do not infer it from Google success.

**F. Side-by-side dev app — deliberately deferred.** `eas.json` currently builds the
**existing** identity (`com.nearr.ios`), so the dev build **replaces** App Store Nearr on
your test phone. Isolation comes from the environment, not the bundle ID, so this is safe —
you just reinstall from the App Store when you want production back. To get a separate
**Nearr Dev** app later, register `com.nearr.ios.dev`,
`com.nearr.ios.dev.ShareExtension` and App Group `group.com.nearr.ios.dev` in the Apple
Developer portal, add the dev bundle ID to Supabase's Apple provider, allow
`nearrdev://auth-callback`, run `eas credentials` for both IDs, then restore
`"env": { "APP_VARIANT": "dev" }` on the development and preview profiles. `app.config.js`
still carries the whole mechanism and is inert without that flag.

**G. Development test data.** Do not copy real user rows into development. Create a
developer account in `Nearr-Dev` and seed synthetic data: ~15 saved places across two cities
(for nearby notifications and multi-place results), a handful of `share_jobs` in each
terminal state, and two or three `share_media_tasks`. A `supabase/seed.sql` checked in
alongside the migrations is the right home, so a rebuild is one command.

---

## 13. Final safe-baseline physical gate

Do not merge `integrate/safe-development-baseline` to `main` until one installed development
build passes every item:

1. Force-quit/cold-start signed out: no maximum-depth warning and no black screen.
2. Sign in with Google, force-quit, cold-start signed in, then background/resume warm.
3. Settings -> Build info must show `app=development`, `backend=development`,
   `supabase=Nearr-Dev(qnfx…dtvs)`, `channel=development`, and the expected update ID.
4. Search for a real place. Fail on `REQUEST_DENIED`; first complete the Google key action
   in §6 and rerun `verify:google`.
5. Open map, saved place, gallery/basic navigation, and nearby flow. A notification tap and
   a later cold start must not black-screen or dismiss/own the root UI.
6. From a real Instagram or TikTok video: Share -> Nearr. The extension must accept it.
   If it shows `config_error`, capture only the printed violation codes/hosts—never tokens.
7. In Nearr-Dev, locate the unique test URL/time in `share_jobs`; inspect
   `share_media_tasks` if created; wait for the development worker; confirm the resulting
   `saved_places` row.
8. Railway development logs must show that job/request and successful processing.
9. Read-only inspect production Supabase for the same unique URL/time: no matching
   `share_jobs`, `share_media_tasks`, or `saved_places` row. Production Railway must have no
   corresponding request/job log.
10. Pass means all nine checks succeed. Any production record/log, wrong Build Info lane,
    startup black screen, Places denial, or unprocessed share is a hard fail; do not promote.

Only after the user reports PASS:

```powershell
git switch main
git merge --no-ff integrate/safe-development-baseline
npm run verify:integration
git push origin main
```

The merge is deliberate and non-fast-forward so the physically validated integration state
has a named promotion boundary. Do not run these commands before approval.

---

## 14. Quick reference

```powershell
npm run task:new -- <slug> --base <safe-ref> # new branch + isolated worktree
npm run task:list                 # what is in flight

npm run verify:env                # is my local config coherent?
npm run verify:env -- --eas-environment development
npm run verify:google -- --eas-environment development
npm run verify:integration        # typecheck + full test suite

npm run dev:update -- -m "..."    # OTA to the dev app
npm run dev:rollback              # recover the development channel only
npm run dev:build                 # new dev build (native changes)
npm run dev:worker -- --yes       # designated owner -> Railway development
npm run dev:functions -- <fn> --yes
npm run dev:db -- --yes          # migrations -> Nearr-Dev (refuses production)

npm run preview:update -- -m "..." # integration build for combined testing
npm run preview:rollback

npm run prod:db -- --yes
npm run prod:functions -- <fn> --yes
npm run prod:worker -- --yes
npm run prod:update -- -m "..." --yes
npm run prod:build -- --yes              # all prod commands: main + clean + origin
```

Related: [AGENT_TASK_TEMPLATE.md](AGENT_TASK_TEMPLATE.md) ·
[ENVIRONMENT.md](ENVIRONMENT.md) · [PHASE2_HOSTED_ROLLOUT.md](PHASE2_HOSTED_ROLLOUT.md)
