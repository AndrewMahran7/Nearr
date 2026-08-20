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
| Who publishes | any agent | you | you, from `main`, with `--yes` |

`main` means **production-ready**, not "whatever finished most recently". Nothing reaches
`main` before it has passed its own tests, integration tests, and a physical iPhone check
where the change is user-visible.

---

## 2. Start a task

```powershell
npm run task:new -- shazam-v2
```

Creates branch `feat/shazam-v2` and worktree `..\Nearr-shazam-v2` (matching the existing
`Nearr-<slug>` convention), based on `main`, and prints the base commit.

```powershell
cd ..\Nearr-shazam-v2
npm install     # worktrees do NOT share node_modules
```

Options: `--kind fix|chore|docs|test|integration`, `--base <ref>`.

List everything in flight: `npm run task:list`. Clean up after merge:

```powershell
git worktree remove ..\Nearr-shazam-v2
git branch -d feat/shazam-v2
```

## 3. Run several tasks at once

```powershell
npm run task:new -- shazam-v2       # agent 1  ->  ..\Nearr-shazam-v2
npm run task:new -- onboarding-v2   # agent 2  ->  ..\Nearr-onboarding-v2
npm run task:new -- tiktok-ingestion # agent 3 ->  ..\Nearr-tiktok-ingestion
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
npm run dev:worker          # deploys the working tree to Railway `development`
npm run dev:worker:logs
curl.exe -fsS https://media-worker-development.up.railway.app/health
```

Both scripts hardcode `--environment development --service media-worker` and the project
ID. There is deliberately **no `prod:worker` script** — production worker deploys are
manual and explicit (§10).

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

- **config generation** — `app.config.js` throws on a self-contradicting build.
- **before publishing** — `npm run verify:env -- --eas-environment <name>` reads the EAS
  environment and refuses if it is unsafe. Every `*:update` script runs this first.
- **at runtime** — `lib/appEnvironment.ts` logs the resolved lane at startup and feeds the
  Settings → Build info card.

The two rules that matter:

- A **production** app must never ship **development** endpoints.
- A **development** app must never silently reach the **production** backend. If you
  genuinely intend to (see §12), set `EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND=true` so the
  choice is recorded rather than accidental.

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
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | shared (restrict by bundle ID) | shared | EAS environment (sensitive) |
| `EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND` | only while §12 applies | never set | EAS environment |
| `APP_VARIANT` | `dev` | unset | `eas.json` build profile |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **dev project** | prod project | Railway env / Supabase secrets |
| `SHARE_JOBS_FINALIZE_URL`, `MEDIA_FINALIZE_SECRET`, `SHARE_MEDIA_WORKER_SECRET` | dev-specific | prod-specific | Railway env / Supabase secrets |
| `GEMINI_API_KEY`, `MEDIA_TRANSCRIPTION_API_KEY`, `GOOGLE_PLACES_KEY` | may be shared | shared | Railway env / Supabase secrets |
| `NEARR_DEV_SUPABASE_REF` | dev project ref | n/a | your `.env.local` |

Provider API keys (Gemini, transcription, Places) can safely be shared across
environments — they are quota, not data. **Anything that names a project, database, queue
or callback must be environment-specific**: that is the boundary that keeps experiments
away from real user rows.

---

## 7. Database migrations

`supabase/migrations/` is the source of truth. Never hand-edit schema in a dashboard, and
never modify a migration that has already been applied to production.

**Always apply through `npm run dev:db`, never `supabase db push --linked` by hand.**
`--linked` targets whichever project the CLI happens to be linked to, and on 2026-08-19 that
was production — one habitual command away from altering real user schema. The wrapper
proves its target before the CLI runs. There is deliberately no generic `db:push` script;
production migrations are typed by hand with the ref visible (§10).

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
supabase db push --linked

# 3. Edge Functions (only if changed) — explicit ref, explicit flags
supabase functions deploy process-share-jobs --project-ref <PROD_REF> --no-verify-jwt
supabase functions deploy create-share-job   --project-ref <PROD_REF>

# 4. Railway production worker (only if services/media-worker changed)
railway up services/media-worker --path-as-root --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment production --service Nearr
curl.exe -fsS https://nearr-production.up.railway.app/health

# 5. the app
npm run prod:update -- -m "Shazam V2" --yes      # JS-only
eas build --profile production --platform ios    # native change -> build + submit

# 6. validate on the real production Nearr, on a real device
```

`npm run prod:update` refuses unless: the branch is `main`, the working tree is clean,
`HEAD` matches `origin/main`, the production EAS environment passes validation, and you
passed `--yes`. Each of those checks corresponds to something that actually went wrong.

Steps 2–4 have **no npm script** on purpose. Production backend changes should be typed
deliberately, with the target visible in the command.

## 11. Rollback

Different layers roll back differently. This is the most important thing on this page.

**Frontend (OTA)** — fast and safe:

```powershell
eas update:rollback --channel production
```

Republishes the previous update on that channel. Users get it on next launch. If the app
cannot even boot, `eas update:republish` an older known-good update ID instead.

**Railway** — redeploy the last known-good deployment from the Railway dashboard
(Deployments → the green one → Redeploy), or `railway up` from the last known-good commit
with the same explicit `--environment` flags. Do not roll back by deleting the service.

**Edge Functions** — there is no built-in rollback. Check out the last known-good commit
into a temporary worktree and redeploy from it, preserving the flags:

```powershell
git worktree add ..\Nearr-fn-rollback <good-commit>
cd ..\Nearr-fn-rollback
supabase functions deploy process-share-jobs --project-ref <PROD_REF> --no-verify-jwt
cd ..\Nearr
git worktree remove ..\Nearr-fn-rollback
```

**Database — do NOT roll back schema migrations.** A reverse migration on live data
destroys rows that the forward migration created and cannot restore what it dropped. Fix
forward: write a new migration that corrects the problem. Only run a reverse migration when
one was deliberately written, reviewed, and proven against a copy of the data first.

Because of this asymmetry, **deploy migrations additively**. A column that is added but
unused is trivially recoverable; a column that is dropped is not.

---

## 12. Setup status — what is done, what you still owe

Updated 2026-08-19 after the development-lane build-out.

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
| Guards | `dev:db`, `dev:functions`, `dev:update`, `prod:update` all refuse the wrong target |

### Still required before the first dev build

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

**C. Railway `development` variables.** `MEDIA_FINALIZE_SECRET` is missing. The currently
deployed worker predates that check so `/ready` is green today, but current `main` requires
it and `npm run dev:worker` will drop the worker to 503 without it. Also add
`TIKTOK_MEDIA_RESOLVER_ENABLED` (and `FACEBOOK_`/`SNAPCHAT_` if wanted) — present in
production, absent in development.

`SHARE_MEDIA_WORKER_SECRET` is currently **identical** in development and production. Data
isolation still holds because each worker only talks to its own Supabase, but the
authentication boundary is shared. Rotate the development one to a distinct value.

**D. Railway auto-deploy.** The `development` service still deploys from
`fix/phase1-intermittent-crash-20260802` (2026-08-03), so it silently reverts anything you
push with `npm run dev:worker`. In the Railway dashboard → project `Nearr Phase 2 Dev` →
environment `development` → service `media-worker` → Settings → Source: disconnect the
branch trigger (or repoint it to `main`). Explicit `npm run dev:worker` is the model this
workflow assumes.

**E. Supabase Auth in `Nearr-Dev`.** Email/magic-link is enabled and signup is allowed, so
login works. Apple and Google are **disabled**, so those buttons cannot be tested in dev.
Add `nearr://auth-callback` and `nearr:///auth-callback` to the redirect allowlist
(`nearrdev://` variants only if you later enable side-by-side, §F).

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

## 13. Quick reference

```powershell
npm run task:new -- <slug>        # new branch + worktree
npm run task:list                 # what is in flight

npm run verify:env                # is my local config coherent?
npm run verify:env -- --eas-environment development
npm run verify:integration        # typecheck + full test suite

npm run dev:update -- -m "..."    # OTA to the dev app
npm run dev:build                 # new dev build (native changes)
npm run dev:worker                # media-worker -> Railway development
npm run dev:functions -- <fn> --yes
npm run dev:db -- --yes          # migrations -> Nearr-Dev (refuses production)

npm run preview:update -- -m "..." # integration build for combined testing

npm run prod:update -- -m "..." --yes   # main + clean + pushed + validated only
```

Related: [AGENT_TASK_TEMPLATE.md](AGENT_TASK_TEMPLATE.md) ·
[ENVIRONMENT.md](ENVIRONMENT.md) · [PHASE2_HOSTED_ROLLOUT.md](PHASE2_HOSTED_ROLLOUT.md)
