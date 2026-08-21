# Nearr-Dev end-to-end regression suite (Tier 3)

Nearr has a lot of tests, and until now none of them could fail when the
*deployment* was broken. Two real failures proved it:

1. Nearr-Dev was missing `MEDIA_FALLBACK_ENABLED` and
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED`, so hard videos never reached Railway.
   Every unit and contract test passed.
2. After the fallback was correctly enqueued, media tasks could still fail to
   reach Railway. Every code-level test still passed.

Both are *cross-service configuration* failures. Code-level tests cannot see
them, by construction: they mock the boundary that broke. This tier exists to
run against the real deployment and fail when it does.

---

## The four tiers

| Tier | What it is | What it proves | Runs |
| --- | --- | --- | --- |
| 1 — Unit | Pure functions, no I/O | Logic is correct in isolation | `test:prebuild` |
| 2 — Contract / integration | Payloads, adapters, RPC contracts, routing, result mapping, mocked boundaries | The pieces agree on their interfaces | `test:prebuild` |
| **3 — Nearr-Dev deployed E2E** | **Real Nearr-Dev, real Railway development worker, real queues, real config, real HTTP/RPC** | **The deployed system is wired together and a share can actually travel it** | **explicit command** |
| 4 — Physical device | iOS Share Extension, notifications, native maps, App Groups, performance | The thing a human touches works | by hand, on a phone |

Tier 3 does **not** replace Tier 4. It is the gate you run *before* picking up
the phone, so that a failed physical test means something new.

---

## Commands

| Command | Kind | Cost | Mutates Nearr-Dev | Time |
| --- | --- | --- | --- | --- |
| `npm run test:e2e:harness` | local deterministic | free | no | ~2s |
| `npm run test:e2e:dev:config` | development E2E | free | no | ~5s |
| `npm run test:e2e:dev:dispatch` | development E2E | free | yes (cleaned) | ~15s |
| `npm run test:e2e:dev:pipeline` | development E2E | free¹ | yes (cleaned) | ~20s |
| `npm run test:e2e:dev:safety` | development E2E | free¹ | yes (cleaned) | ~10s |
| `npm run test:e2e:dev` | development E2E | free¹ | yes (cleaned) | ~25s |
| `npm run verify:dev:e2e` | development E2E | free¹ | yes (cleaned) | ~15s |
| `npm run test:e2e:dev:vayrin-live` | **paid live** | **model + provider calls** | yes (cleaned) | minutes |

¹ "Free" means no model/provider spend. These suites do drive the deterministic
resolver, which makes a small number of Google Places calls — the same calls a
single real share makes. Budget it as pennies, not as a model bill.

`npm run test:e2e:harness` is the only one in `test:prebuild`. It is pure and
offline: it tests the harness's own guards, configuration contract, lifecycle
assertions, polling and reporting with injected snapshots, and it asserts that
none of the deployed commands have crept into `test:prebuild`.

**`test:prebuild` must never depend on the internet, Railway, Supabase, OpenAI
or a live social URL.** The harness test enforces that.

---

## Required development environment

Everything is read from the **deployments**, not from a local `.env` — a local
file proves what your laptop believes, not what Nearr-Dev is running.

You need:

- `railway` CLI, logged in, with access to project `Nearr Phase 2 Dev`.
  This is where the suite reads the development worker's configuration and the
  development service-role key. Nothing is pasted by hand.
- `supabase` CLI, logged in. Used only for `secrets list`, which returns
  **SHA-256 digests**, never values.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (or `NEARR_E2E_SUPABASE_ANON_KEY`),
  used to sign the ephemeral test identity in. It is a public key by design.

There is nothing else to provision, and **no personal credential is ever
involved**.

### Optional environment variables

| Variable | Effect |
| --- | --- |
| `NEARR_E2E_TIMEOUT_<STAGE>_MS` | Override a stage budget, e.g. `NEARR_E2E_TIMEOUT_RAILWAYCLAIM_MS=180000`. Stages: `CREATEJOB`, `EDGECLAIM`, `MEDIATASK`, `RAILWAYCLAIM`, `WORKERSTAGE`, `FINALIZE`, `TERMINAL`. |
| `NEARR_E2E_KEEP_ROWS=1` | Skip cleanup and leave the run's rows in Nearr-Dev for inspection. The run prints exactly what it retained. |
| `NEARR_E2E_CHEAP_URL` | Replace the Fixture A source. |
| `NEARR_E2E_FALLBACK_URL` | Replace the Fixture B source. |
| `NEARR_E2E_NEGATIVE_URL` | Replace the Fixture E source. |
| `NEARR_E2E_VAYRIN_URL` / `_PLATFORM` / `_TRUTH` | Required to run the paid canary. |

---

## Safety — this suite cannot touch production

There is no `--force`, no `--yes`, and no environment variable that relaxes any
of this. Identity is proven before a client is constructed; a refusal exits `2`
(distinct from `1` for a test failure) and nothing "best effort" continues.

- The Supabase project ref must be `qnfxnmvxpjzfydgudtvs` (Nearr-Dev).
  The production ref is refused **by name**, and anything unrecognised is
  refused too — an unrecognised target cannot be proven safe.
- The production ref is read from `scripts/devTarget.mjs`, the same single
  source of truth the deployment scripts use, so the two guards cannot drift.
- Railway must report environment `development`, service `media-worker`, and
  the known project id. The production environment and the production service
  name are refused by name.
- The worker URL must be HTTPS and must match the Railway development
  deployment's own public domain. A development database dialling a different
  worker is itself a cross-service break.
- The Railway environment and service are **hard-coded**, not taken from a
  flag. A suite that lets you choose which Railway environment to read is one
  typo away from reading production.
- The project ref, worker URL and Railway lane are all derived from the
  development worker's own configuration, so there is no local file whose
  contents could redirect the run.

## Secrets

No secret value is ever printed, logged, or placed in a report line.

- **Presence** — for anything whose content does not matter.
- **Digest equality** — for values two services must agree on.
  `supabase secrets list` returns digests, so the Edge side is compared without
  this process ever holding its plaintext.
- **`digest == sha256("true")`** — how a boolean flag is proven ON without the
  checker seeing a value.

---

## What mutates Nearr-Dev, and what cleans it up

Each run creates **one ephemeral confirmed user** — `nearr-e2e-<timestamp>-<hex>@nearr.invalid`
— with a random password that exists only in memory for the length of the run.
Every row the suite creates belongs to that user.

Cleanup deletes the user, which cascades away its share jobs, media tasks,
saved places, push tokens and place results. The append-only diagnostics tables
(`share_media_runs`, `share_agent_runs`, `share_extraction_failures`) use
`ON DELETE SET NULL`, so those rows are deleted explicitly, by the job ids the
run recorded, *before* the user goes.

Cleanup is scoped three ways and cannot reach an unrelated row: only the user id
this process created, only the job ids this process recorded, and only against a
project already proven to be Nearr-Dev. It is idempotent, and it runs in a
`finally` block so a failed run still cleans up.

`NEARR_E2E_KEEP_ROWS=1` skips it and prints what was retained.

Correlation uses `share_jobs.idempotency_key`, which the client already
populates from `clientRequestId` — no production change was invented for this.
Every run prints its correlation id, user id, job id and task id, and a failure
prints the log-search commands.

---

## Fixtures

| Fixture | Path exercised | Expected | Cost |
| --- | --- | --- | --- |
| **A — cheap metadata path** | `create-share-job` → `process-share-jobs` → deterministic resolver → Google Places → terminal | A place is identified; **no media task** is created | free¹ |
| **B — media fallback dispatch** | `create-share-job` → metadata fetch fails → `shouldRunMediaFallbackOnMetadataFailure` → `share_media_tasks` → Railway claim | A media task **is** created and Railway claims it | free |
| **C — live model boundary** | media → frames → real provider → structured hypothesis → finalizer | Each hop happened; the finalizer accepted a structured payload | **paid** |
| **D — creator identity safety** | synthetic evidence → deployed `finalize_media_task` → auto-save gate | **No** `auto_save`, **no** `saved_place_id` | free¹ |
| **E — hard negative** | a page with no place content → terminal | Safe no-answer; nothing persisted | free¹ |

**No fixture depends on a particular live social post staying up.** A suite that
goes red because a stranger deleted a reel trains people to ignore it. Fixture A
uses a long-lived reference page, B uses a URL shape that is *deterministically*
unavailable (which is the behaviour under test), D is a synthetic payload posted
to a real deployed endpoint, and E uses `example.com`, reserved by RFC 2606.

### Fixture B is the one that would have caught the missing flags

With either flag unset, `shouldRunMediaFallbackOnMetadataFailure` returns
`{ run: false }`, no `share_media_tasks` row appears, and the job goes to
`needs_help` instead of Railway — silently. Fixture B asserts the row exists and
names both flags in the failure. `test:e2e:dev:config` catches the same thing
one layer earlier and in five seconds.

### What Fixture A can and cannot prove

It proves the deterministic path resolves a place on the deployed stack without
spending the worker. It does **not** prove the "strong address evidence
suppresses fallback on a *supported* platform" rule, because Tier 3 cannot
deterministically obtain Instagram metadata. That rule is proven at Tier 2 by
`npm run test:media-fallback`.

---

## How the media-dispatch proof works

This is the most important test in the suite, and the reason it is empirical
rather than a config read.

The dispatch architecture is **hybrid**, and deliberately silent when
unconfigured (see `supabase/migrations/20260801000002_share_media_worker.sql`):

- **push** — an `AFTER INSERT` statement trigger fires `net.http_post` at the
  worker's `/v1/process-media-tasks`;
- **pull** — a per-minute `pg_cron` job calls the same function as a backstop;
- **claim** — the worker then pulls with `claim_media_tasks()`
  (`FOR UPDATE SKIP LOCKED`), which is what actually takes ownership.

`invoke_process_media_tasks()` returns **without raising** when the Vault
secrets `share_media_worker_url` / `share_media_worker_secret` are missing, and
swallows every pg_net error, because durability is meant to come from the cron
sweep. If both legs are unconfigured, the queue fills up and nothing reports a
problem. That is failure #2, exactly.

So the suite inserts a real row, touches nothing else, and watches for a claim.
A claim proves the whole chain at once: trigger or cron, Vault config, worker
URL, worker secret, container liveness, and the claim RPC's grants.

**When it fails it immediately runs a differential**: it POSTs the same
invocation the database would have made, directly. If the task is claimed then,
the worker is healthy and the *database-side* dispatch is broken. If not, the
break is on the worker side. One extra request turns "Railway never claimed the
task" into an actionable finding.

The probe task carries a platform no resolver matches, so the worker claims it,
fails `selectResolver` immediately with `unsupported_platform`, and finalizes.
No media is downloaded and no model is called — but the claim, the finalize
callback, the parent transition and the terminal task state are all real. That
also makes it a live test of `MEDIA_FINALIZE_SECRET` agreement across the two
services.

---

## Cost control

`npm run test:e2e:dev` never calls a model. Only
`npm run test:e2e:dev:vayrin-live` can spend provider money, and:

- it **refuses to run** unless you name a source with `NEARR_E2E_VAYRIN_URL`,
  so the paid path is always a deliberate act;
- it prints `LIVE MODEL TEST` with the maximum call count before doing anything;
- the ceiling is **4 calls** (1 transcription, 1 evidence analysis, 1 OCR,
  1 Vayrin visual geolocation), enforced structurally: the task is inserted with
  `max_attempts = 1`, so the claim RPC can hand it to the worker exactly once.
  There is no retry budget to burn and no way for the fixture to loop.

The canary has **no default URL on purpose**. Every candidate rots — a social
post gets deleted, a long video breaches `MEDIA_MAX_DURATION_SECONDS`, and a
Wikimedia file is not on the worker's host allowlist (adding it would mean
loosening a production SSRF control to suit a test).

It is a **service-boundary** canary, not an intelligence benchmark. Whether the
model named the right place is reported as a `WARN`, never a `FAIL`: a model
having a bad day is not a deployment defect and must not block physical QA.

---

## How to read a failure

Every stage is named, timed, and printed as it happens. A failure carries the
last observed state and the identifiers needed to search both services' logs.
You should never see a bare "E2E FAILED".

```
PASS parent share job created (196ms) — job 25f68aac-… parked in processing_metadata
PASS media task inserted (110ms) — task 46b5d345-… queued
FAIL Railway worker claimed the task (15.0s) — no claim within 15s; even a direct
     invocation did not produce a claim — the worker is reachable but
     claim_media_tasks() returned nothing (check the parent job status,
     next_attempt_at, attempts vs max_attempts, and the service-role grant)
       taskStatusTrail: cancelled
       lastObservedTask: {"status":"cancelled","attempts":0,"locked_at":null,…}
       directInvocation: HTTP 200 {"ok":true,"claimed":0,"processed":0}
       workerBaseUrl: https://media-worker-development.up.railway.app
       jobId: ea299a15-…    taskId: c356b2e3-…
```

Common failures and what they mean:

| Failure | Means |
| --- | --- |
| `Edge secret MEDIA_FALLBACK_ENABLED is NOT SET` | Regression #1. Media fallback is off; hard videos will never reach Railway. |
| `SHARE_MEDIA_WORKER_SECRET DIFFERS between …` | The database presents one secret and the container expects another. Every dispatch 401s, and pg_net swallows it by design. |
| `no claim within Ns; a DIRECT invocation … claimed the task immediately` | The worker is healthy; the **database-side** dispatch is broken. Check the Vault secrets, the `share_media_tasks_kick_worker` trigger, and the `process-media-tasks-sweep` cron job. |
| `no claim within Ns; the worker is ALSO unreachable from here` | The break is on Railway, not in the database. |
| `the media task is terminal but the parent job never moved` | The finalize callback did not land. Check `MEDIA_FINALIZE_SECRET` on both sides and `SHARE_JOBS_FINALIZE_URL` on Railway. Users see jobs that never finish. |
| `the job never left "queued"` | Both the pg_net kick and the `process-share-jobs-sweep` cron backstop failed to dispatch. |
| `GET /health returned 404` | The worker URL does not point at a running media-worker. |

### `WARN` lines are drift, not failure

Warnings do not fail a run. They report configuration that is *inconsistent* but
not *broken* — most usefully, a resolver flag that is ON for the Railway worker
and OFF/unset on the Supabase Edge. Because the Edge decides whether to enqueue,
that platform never reaches the worker at all. Worth knowing every run; not a
reason to block a build.

---

## When to run it

- **Before physical QA.** `npm run verify:dev:e2e` ends with exactly one of
  `READY FOR PHYSICAL QA` / `NOT READY FOR PHYSICAL QA`.
- **After any Edge, Railway, or configuration change** — including
  `npm run dev:functions`, `npm run dev:worker`, and any `supabase secrets set`
  or `railway variables --set`.
- **After a major integration batch**, alongside `npm run verify:integration`.
- **Before a beta or release candidate.**
- `npm run test:e2e:dev:vayrin-live` when the provider itself is what you need
  to check — not on a schedule.

---

## What this suite still cannot validate

Tier 3 stops at the network boundary of the phone. It says nothing about:

- the **iOS Share Extension** — its process lifecycle, memory limits, the
  handoff into the app, or the sheet's UI;
- **App Group** container behaviour and shared-auth session hand-off between
  the extension and the host app;
- **push notifications** — delivery, permissions, tap-through routing, badges;
- **native map rendering** — pins, clustering, camera ownership, frame rate;
- **physical gestures** — swipes, scroll, haptics;
- **native performance** — cold start, memory pressure, battery, thermals;
- **offline and poor-network behaviour** on a real radio;
- anything about the **production** environment, which this suite refuses to
  touch by design.

A green Tier 3 means the backend is wired correctly and a share can travel it.
It does not mean the app works. That still needs a phone.
