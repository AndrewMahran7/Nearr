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
| App on the phone | Nearr Dev | Nearr Dev | Nearr (App Store) |
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

Then open **Nearr Dev** on the iPhone, force-quit, reopen. `npm run dev:update` always
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
to the linked project, because the linked project is production. It also applies
`--no-verify-jwt` automatically to `process-share-jobs` and `process-share-link`, which
authenticate callers themselves and have broken before when redeployed without it.

**Database:** see §7.

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
5. open Nearr Dev, force-quit, reopen
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

## 12. Known gaps — one-time setup still required

The repo-side work is done. These need your account and, in one case, your money.

**A. Create the EAS channels and environments** (required before any of this works):

```powershell
eas channel:create development
eas channel:create preview

eas env:create --environment development --name EXPO_PUBLIC_APP_ENV --value development --visibility plaintext
eas env:create --environment development --name EXPO_PUBLIC_BACKEND_ENV --value development --visibility plaintext
# ...plus SUPABASE_URL / ANON_KEY / the two function URLs / GOOGLE_MAPS_API_KEY
# repeat for --environment preview with EXPO_PUBLIC_APP_ENV=preview

eas env:create --environment production --name EXPO_PUBLIC_APP_ENV --value production --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_BACKEND_ENV --value production --visibility plaintext
```

Verify each with `npm run verify:env -- --eas-environment <name>`. Until the production
environment declares `APP_ENV=production`, `npm run prod:update` will refuse to publish —
that is intentional, and it is a two-minute fix, not a workaround to skip.

**B. One development build.** No development or preview build has ever existed for this
project; all twelve builds to date are `production`/STORE. You need exactly one:

```powershell
npm run dev:build
```

Install it from the EAS link. After that, JS iteration is OTA only.

**C. Side-by-side dev app.** `APP_VARIANT=dev` (already set in the `development` and
`preview` build profiles) produces **Nearr Dev** — `com.nearr.ios.dev`, scheme `nearrdev`
— which installs *alongside* App Store Nearr instead of replacing it. Everything derived
from the bundle ID moves with it automatically: `com.nearr.ios.dev.ShareExtension` and App
Group `group.com.nearr.ios.dev`. Before the first build, in the Apple Developer portal:

1. Register App IDs `com.nearr.ios.dev` and `com.nearr.ios.dev.ShareExtension`.
2. Create App Group `group.com.nearr.ios.dev` and attach it to both.
3. Enable Sign in with Apple on `com.nearr.ios.dev`, and add it to the Supabase Auth Apple
   provider's allowed client IDs — otherwise Apple sign-in fails in the dev app only.
4. Add `nearrdev://auth-callback` and `nearrdev:///auth-callback` to Supabase Auth's
   allowed redirect URLs.
5. `eas credentials` → iOS → let EAS generate profiles for both new bundle IDs.

If you would rather not do this yet, set `"env": {}` in the `development` profile in
`eas.json`. The dev build then uses `com.nearr.ios` and **replaces** App Store Nearr on the
device — everything else in this document still works, you just lose side-by-side. The
separate `scheme` is what prevents iOS from handing a `nearr://` deep link to whichever of
the two apps it feels like, so do not keep the dev bundle ID while reverting the scheme.

**D. A development Supabase project.** There isn't one — the org has `Nearr` (production)
and the unrelated `StayReel`, and no branches. Until one exists there is no safe database
for experiments. Options:

- **Create a `Nearr Dev` project** (may require Pro; a third project is beyond the free
  tier). Then `supabase link --project-ref <new>`, `supabase db push`,
  `npm run dev:functions -- --yes`, and set `NEARR_DEV_SUPABASE_REF` in `.env.local`.
  This is the target state.
- **Local Supabase** for schema and function iteration, free: `supabase init` (there is no
  `supabase/config.toml` yet), then `supabase start` and `supabase db reset`. Reachable
  from the iPhone over LAN. Good for migrations; awkward for Apple sign-in.
- **Interim:** point the development lane at production with a *dedicated test account*
  and `EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND=true`. This is a deliberate, recorded
  compromise, not the default — and it does not protect other users' rows from a bad
  migration or a service-role bug. Treat it as temporary.

**E. Repoint the Railway `development` worker.** It currently uses the **production**
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SHARE_JOBS_FINALIZE_URL` — it is a second
worker competing for the production `share_media_tasks` queue with full service-role write
access to real user data. It is isolated in name only. Once (D) exists:

```powershell
railway variables --set SUPABASE_URL=... --environment development --service media-worker
# ...and SUPABASE_SERVICE_ROLE_KEY, SHARE_JOBS_FINALIZE_URL, MEDIA_FINALIZE_SECRET
```

Enter secrets through the dashboard or `--stdin`, never as shell arguments.

**F. Development test data.** Do not copy real user rows into development. Create a
developer account in the dev project and seed synthetic data: ~15 saved places across two
cities (for nearby notifications and multi-place results), a handful of `share_jobs` in
each terminal state, and two or three `share_media_tasks`. A `supabase/seed.sql` checked in
alongside the migrations is the right home for it, so `supabase db reset` rebuilds a usable
database in one command.

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

npm run preview:update -- -m "..." # integration build for combined testing

npm run prod:update -- -m "..." --yes   # main + clean + pushed + validated only
```

Related: [AGENT_TASK_TEMPLATE.md](AGENT_TASK_TEMPLATE.md) ·
[ENVIRONMENT.md](ENVIRONMENT.md) · [PHASE2_HOSTED_ROLLOUT.md](PHASE2_HOSTED_ROLLOUT.md)
