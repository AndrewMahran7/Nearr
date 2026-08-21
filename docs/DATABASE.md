# Nearr — Database Schema

> Last updated: 2026-08-01
> Source of truth: `supabase/migrations/`

Do not use `supabase/schema.sql` as the canonical schema. The migration files under `supabase/migrations/` are the source of truth.

## Supabase CLI version (local dev + CI)

**Pinned/minimum Supabase CLI: `2.111.0`** (validated on 2026-08-01). Use one
consistent version for `supabase start` / `supabase db reset` / `supabase db
lint` locally and in CI — do **not** mix a globally installed CLI with a
different `npx supabase` version.

Newer CLI versions reduced the schema default privileges so a freshly created
table grants only `REFERENCES/TRIGGER/TRUNCATE` (not `SELECT/INSERT/UPDATE/
DELETE`) to `anon`/`authenticated`/`service_role`. Nearr's migrations therefore
declare **every** required table + function privilege EXPLICITLY (see
`20260801000004_explicit_privileges.sql` and
`20260801000005_aux_privileges.sql`), so a clean database behaves
identically regardless of the CLI's default privileges. A change in CLI defaults
can no longer silently drop `authenticated`'s reads or `service_role`'s worker
access.

## Migration inventory

- `20260426000001_init_schema.sql`
- `20260427000001_analytics_events.sql`
- `20260501000001_notification_count.sql`
- `20260502000001_legal_acceptance.sql`
- `20260503000001_opportunity_archive.sql`
- `20260504000001_share_agent_runs.sql`
- `20260706000001_feedback.sql`
- `20260708000001_share_extraction_failures.sql`
- `20260731000001_share_jobs.sql`
- `20260731000002_user_push_tokens.sql`
- `20260731000003_share_jobs_worker.sql`
- `20260731000004_share_jobs_notifications.sql`
- `20260731000005_lock_worker_rpc_grants.sql`
- `20260801000001_share_media_tasks.sql` (Phase 2)
- `20260801000002_share_media_worker.sql` (Phase 2)
- `20260801000003_share_media_task_recovery.sql` (Phase 2 — bounded recovery + retry backoff + cancellation)
- `20260801000004_explicit_privileges.sql` (Phase 1+2 — CLI-independent explicit table/function grants)
- `20260801000005_aux_privileges.sql` (Phase 1+2 — explicit grants for analytics_events/feedback/share_agent_runs/share_extraction_failures + trigger-function locks)

## Schema overview

```text
auth.users
  └─ profiles (1:1)

places
  └─ saved_places (many per user, unique per user/place)
       └─ notification_events

analytics_events
feedback
share_agent_runs            (service-role only)
share_extraction_failures   (service-role only)
share_jobs                  (async share queue; owner RLS + service-role worker)
user_push_tokens            (Expo push tokens; owner RLS)
share_media_tasks           (Phase 2 video-analysis queue; SERVICE-ROLE ONLY)
share_media_runs            (Phase 2 media diagnostics; SERVICE-ROLE ONLY)
```

## `profiles`

Created in `20260426000001_init_schema.sql` and extended in `20260502000001_legal_acceptance.sql`.

Columns:

- `id uuid primary key references auth.users(id) on delete cascade`
- `email text`
- `default_radius_value numeric not null default 1` — legacy compatibility only; current clients do not read or write it
- `default_radius_unit text not null default 'miles' check in ('miles','minutes')` — legacy compatibility only; current clients do not read or write it
- `notifications_enabled boolean not null default true`
- `nearby_notifications_enabled boolean not null default true`
- `quiet_hours_enabled boolean not null default false`
- `quiet_hours_start time`
- `quiet_hours_end time`
- `terms_accepted_at timestamptz null`
- `privacy_accepted_at timestamptz null`
- `legal_version text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Behavior:

- `handle_new_user()` auto-creates a profile row on auth signup.
- `set_updated_at()` trigger maintains `updated_at`.

## `places`

Canonical shared place table.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `google_place_id text unique`
- `name text not null`
- `formatted_address text`
- `latitude numeric not null`
- `longitude numeric not null`
- `category text`
- `google_maps_url text`
- `created_at timestamptz not null default now()`

Notes:

- This table is shared across users.
- Client code intentionally does SELECT-then-INSERT instead of upsert because RLS does not allow client UPDATE on this table.
- Index: `places_lat_lng_idx` on `(latitude, longitude)`.

## `saved_places`

Per-user saved place table.

Columns from init migration:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `place_id uuid not null references public.places(id) on delete cascade`
- `radius_value numeric null`
- `radius_unit text null check in ('miles','minutes')`
- `notes text null`
- `source_type text null check in ('manual','tiktok','instagram','link')`
- `source_url text null`
- `notifications_enabled boolean not null default true`
- `last_notified_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Column added later:

- `notification_count integer not null default 0` from `20260501000001_notification_count.sql`
- `reminder_opportunity_count integer not null default 0` from `20260503000001_opportunity_archive.sql`
- `archived_at timestamptz null` from `20260503000001_opportunity_archive.sql`
- `visited_at timestamptz null` from `20260503000001_opportunity_archive.sql`
- `reminders_exhausted_at timestamptz null` from `20260503000001_opportunity_archive.sql`

Constraints and indexes:

- unique `(user_id, place_id)`
- `saved_places_user_idx`
- `saved_places_place_idx`
- `saved_places_active_idx` partial index on `(user_id) where archived_at is null and visited_at is null` from `20260503000001_opportunity_archive.sql`
- `saved_places_set_updated_at` trigger updates `updated_at`

Important current behavior:

- Duplicate saves are handled in app logic by updating the existing row instead of erroring to the user.
- `notification_count` is enforced in app logic, not by a DB constraint.
- Grouped nearby notifications increment `notification_count` for every saved place included in the grouped notification.
- `reminder_opportunity_count` is incremented atomically by the SQL function `bump_reminder_opportunity_count(saved_place_ids uuid[])` (see migration `20260503000001`) at notification delivery time. The function is `security invoker` and restricted to rows owned by `auth.uid()`.
- `archived_at`, `visited_at`, and `reminders_exhausted_at` are written by the app's opportunity flow (`markVisited`, `markArchived`, `unarchive` in [services/savedPlacesService.ts](../services/savedPlacesService.ts)). The proximity and geofence queries filter `archived_at IS NULL AND visited_at IS NULL` so archived/visited places never trigger reminders.

## `notification_events`

Append-only audit table.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `saved_place_id uuid not null references public.saved_places(id) on delete cascade`
- `event_type text not null check in ('nearby','entered','exited','silenced')`
- `user_latitude numeric null`
- `user_longitude numeric null`
- `distance_meters numeric null`
- `created_at timestamptz not null default now()`

Current code reality:

- The app currently inserts `event_type = 'nearby'`.
- The additional enum values exist in the schema but are not currently emitted by the client code.

Indexes:

- `notif_events_user_idx`
- `notif_events_saved_place_idx`

## `analytics_events`

Added in `20260427000001_analytics_events.sql`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid null references auth.users(id) on delete set null`
- `anonymous_id text null`
- `event_name text not null`
- `properties jsonb not null default '{}'::jsonb`
- `platform text null`
- `app_version text null`
- `build_number text null`
- `created_at timestamptz not null default now()`

Indexes:

- `analytics_events_event_created_idx`
- `analytics_events_user_created_idx`
- `analytics_events_created_idx`
- `analytics_events_properties_gin_idx`

Purpose:

- lightweight product analytics
- append-only inserts from the client via `lib/analytics.ts`

## `feedback`

Added in `20260706000001_feedback.sql`. In-app, founder-led product
feedback (Settings → "Send feedback").

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid null references auth.users(id) on delete set null`
- `email text null`
- `category text not null`
- `message text not null`
- `metadata jsonb not null default '{}'::jsonb`
- `status text not null default 'new'`
- `created_at timestamptz not null default now()`

Indexes:

- `feedback_created_idx`
- `feedback_status_created_idx`
- `feedback_category_created_idx`
- `feedback_user_created_idx`

Purpose:

- Append-only from the client. Authenticated users may INSERT feedback
  attributed to themselves only (`user_id = auth.uid()`); anonymous
  (`user_id null`) inserts are not permitted.
- Only the service role can read/triage feedback — there are no client
  SELECT/UPDATE/DELETE policies.
- `metadata` is free-form JSONB (snake_case keys; never store auth tokens
  or personal-token URLs).

## `share_agent_runs`

Added in `20260504000001_share_agent_runs.sql`. Shadow-mode persistence
for the new share-extraction AI agent (Stage 1 of the rebuild). The agent
runs alongside the existing pipeline; its result is persisted here for
offline comparison and does NOT affect user-facing behavior in this stage.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid null references auth.users(id) on delete set null`
- `url text not null`
- `platform text not null`
- `prompt_version text not null`
- `model_used text not null`
- `agent_decision text not null`
- `safety_decision text not null`
- `safe_to_auto_save boolean not null default false`
- `confidence text not null`
- `reasoning text null`
- `tool_calls jsonb not null default '[]'::jsonb`
- `candidates jsonb not null default '[]'::jsonb`
- `evidence_used jsonb not null default '[]'::jsonb`
- `latency_ms integer null`
- `errors jsonb not null default '[]'::jsonb`
- `raw_response jsonb null`
- `created_at timestamptz not null default now()`

Indexes:

- `share_agent_runs_created_idx`
- `share_agent_runs_decision_idx`
- `share_agent_runs_platform_idx`

Purpose:

- Service-role write-only debugging traces. Contains reasoning text that
  may include caption/bio excerpts, so it must never be exposed to clients.
- Inserted by the `process-share-link` Edge Function via the service-role
  client (which bypasses RLS).

## `share_extraction_failures`

Added in `20260708000001_share_extraction_failures.sql`. LLM-friendly
extraction miss diagnostics — one structured row per debug-worthy
extraction attempt (manual fallback, failed/open_app paths, suspicious
confirmations, etc.).

Columns:

- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `user_id uuid null references auth.users(id) on delete set null`
- `original_url text not null`
- `canonical_url text null`
- `platform text null`
- `status text null`
- `user_facing_decision text null`
- `safe_to_auto_save boolean null`
- `confidence text null`
- `failure_class text null`
- `failure_reason text null`
- `selected_candidate_name text null`
- `selected_candidate_address text null`
- `selected_candidate_place_id text null`
- `selected_candidate_score numeric null`
- `address_present boolean not null default false`
- `address_count integer not null default 0`
- `candidate_count integer not null default 0`
- `query_count integer not null default 0`
- `title_preview text null`
- `description_preview text null`
- `suggested_query text null`
- `evidence jsonb not null default '{}'::jsonb`
- `query_plan jsonb not null default '[]'::jsonb`
- `candidates jsonb not null default '[]'::jsonb`
- `warnings jsonb not null default '[]'::jsonb`
- `diagnostics jsonb not null default '{}'::jsonb`
- `llm_summary jsonb not null default '{}'::jsonb`
- `app_version text null`
- `backend_version text null`
- `request_id text null`

Indexes:

- `share_extraction_failures_created_idx`
- `share_extraction_failures_platform_idx`
- `share_extraction_failures_decision_idx`
- `share_extraction_failures_failure_class_idx`
- `share_extraction_failures_address_present_idx`
- `share_extraction_failures_user_idx`

Purpose:

- Developer/debug only. Client roles have NO access (deny-all policy).
- Inserted by the `process-share-link` Edge Function via the service-role
  client.

## `share_jobs`

Added in `20260731000001_share_jobs.sql`. Durable queue for the async
share-to-app flow (source of truth). See [ASYNC_SHARE_JOBS.md](./ASYNC_SHARE_JOBS.md)
for the full flow.

Key columns: `user_id`, `source_url`, `canonical_url`, `source_platform`,
`status` (`queued|processing_metadata|completed|needs_help|failed|cancelled`),
`decision`, `saved_place_id` (FK -> `saved_places` **ON DELETE SET NULL**),
`candidate_payload`/`extraction_payload` (jsonb), `suggested_query`,
`needs_help_reason`, `failure_reason`, `idempotency_key`, `attempts`,
`max_attempts`, `locked_until`, `last_error`,
`notification_status` (`pending|sending|submitted|retryable_failed|permanently_failed`),
`notification_attempts`, `notification_last_attempt_at`,
`notification_next_attempt_at`, `notification_ticket_ids`,
`notification_error_code`, `notification_submitted_at`,
`notification_payload`, `notification_receipts_checked_at`,
`created_at`, `updated_at`, `completed_at`.

Notes:

- Owner-only RLS. Jobs are created by the authenticated `create-share-job`
  Edge Function (service role) — there is no anonymous/orphan path.
- Idempotency: unique `(user_id, idempotency_key)` and unique
  short-window same-URL dedupe via
  `create_share_job_for_user(..., p_dedupe_window_seconds)`.
- `claim_share_jobs(p_limit, p_lock_seconds)` — `SECURITY DEFINER`, service-role
  only, `FOR UPDATE SKIP LOCKED` claim + stale-lease reclaim.
- Added to the `supabase_realtime` publication for live queue updates.

## `user_push_tokens`

Added in `20260731000002_user_push_tokens.sql`. Expo push tokens for
server-sent share-job notifications (distinct from local place reminders).

Columns: `user_id`, `token` (unique), `platform`, `device_id`, `enabled`,
`last_seen_at`, `created_at`, `updated_at`.

Notes:

- Owner-only RLS. The worker reads tokens via the service role.
- `register_push_token(token, platform, device_id)` — `SECURITY DEFINER` RPC
  that reassigns a device token to the current user (last-writer-wins).
- Invalid tokens (`DeviceNotRegistered`) are set `enabled = false` by the worker.

## `share_media_tasks` / `share_media_runs` (Phase 2)

Added in `20260801000001_share_media_tasks.sql`. The durable video-analysis
fallback queue + diagnostics. **Both are SERVICE-ROLE ONLY** — RLS enabled with
NO client policies and `anon`/`authenticated` revoked, so the mobile client can
never read or write them. The parent `share_jobs` row stays the user-facing
source of truth. See [MEDIA_FALLBACK.md](./MEDIA_FALLBACK.md).

- `share_media_tasks`: one task per share job (`share_job_id` unique, FK
  `ON DELETE CASCADE`); a BEFORE trigger enforces `user_id` = parent job owner.
  Worker bookkeeping (`attempts`, `max_attempts`, `locked_at`, `locked_until`,
  `next_attempt_at`) plus size-bounded diagnostics-lite columns. No raw media
  bytes are stored.
- `claim_media_tasks(p_limit, p_lock_seconds)` — `SECURITY DEFINER`,
  service-role only, `FOR UPDATE SKIP LOCKED` + stale-lease reclaim + bounded
  attempts; also skips tasks whose `next_attempt_at` is in the future and any
  task whose parent job is no longer `processing_metadata`; terminal tasks are
  never reclaimed.
- `expire_media_tasks(p_limit)` — backstop reaper that fails exhausted tasks.
- `20260801000002_share_media_worker.sql` adds `invoke_process_media_tasks()`
  (pg_net wake-up sending the dedicated `SHARE_MEDIA_WORKER_SECRET`, NOT the
  service-role key), a per-minute `pg_cron` sweep, and an AFTER-INSERT trigger.
  All defensive no-ops until the operator sets the Vault secrets.
- `20260801000003_share_media_task_recovery.sql` (forward, idempotent) adds
  bounded recovery: the `next_attempt_at` column + retry gate above;
  `requeue_media_task(p_task_id, p_backoff_seconds, p_failure_code)` (re-queues
  with backoff **without** incrementing `attempts`; no-op on terminal tasks);
  `claim_stranded_media_parents(p_limit)` (returns `processing_metadata` parents
  whose media task is `failed`/`cancelled`, `FOR UPDATE SKIP LOCKED`, for the
  worker's stranded-parent sweep); and a `share_jobs_cancel_cascade_media`
  AFTER-UPDATE trigger that cancels a media task when its parent is cancelled.
  All new functions are `SECURITY DEFINER`, service-role only (execute revoked
  from `public`/`anon`/`authenticated`).

## Worker wiring

`20260731000003_share_jobs_worker.sql` adds `invoke_process_share_jobs()`
(pg_net call to the worker), a per-minute `pg_cron` sweep, and an AFTER-INSERT
trigger. All defensive: no-ops until the operator enables `pg_net`/`pg_cron`
and sets the Vault secrets (see [ASYNC_SHARE_JOBS.md](./ASYNC_SHARE_JOBS.md)).

## Row-level security

RLS is enabled on:

- `profiles`
- `places`
- `saved_places`
- `notification_events`
- `analytics_events`
- `feedback`
- `share_agent_runs`
- `share_extraction_failures`
- `share_jobs`
- `user_push_tokens`

Current policy model:

- `profiles`: owner-only read/update/insert
- `places`: authenticated read + insert, no client update/delete
- `saved_places`: owner-only read/write/delete
- `notification_events`: owner-only read/insert
- `analytics_events`: insert allowed for authenticated and anonymous clients under controlled rules, no client read path
- `feedback`: authenticated insert-own only (`user_id = auth.uid()`), no client read path; service-role read/triage
- `share_agent_runs`: deny-all for client roles; service-role only
- `share_extraction_failures`: deny-all for client roles; service-role only
- `share_jobs`: owner-only read/insert/update/delete; worker uses service role
- `user_push_tokens`: owner-only read/insert/update/delete; worker reads via service role

## Table & function privileges (explicit)

RLS is the row-level boundary; these are the table/function GRANTs it sits on
top of, declared explicitly in `20260801000004_explicit_privileges.sql` and
`20260801000005_aux_privileges.sql` so they do not depend on the Supabase CLI's
default privileges. Every public table + function is covered; the completeness
gate in `scripts/testDatabasePrivileges.sql` fails if a new application object
is added without declared privilege expectations.

| table | `authenticated` | `anon` | `service_role` |
| --- | --- | --- | --- |
| profiles | SELECT, INSERT, UPDATE | — | full DML |
| places | SELECT, INSERT | — | full DML |
| saved_places | SELECT, INSERT, UPDATE, DELETE | — | full DML |
| notification_events | SELECT, INSERT | — | full DML |
| user_push_tokens | SELECT, INSERT, UPDATE, DELETE | — | full DML |
| share_jobs | SELECT, DELETE (never INSERT/UPDATE) | — | full DML |
| share_media_tasks | — | — | full DML |
| share_media_runs | — | — | full DML |
| analytics_events | INSERT | INSERT | full DML |
| feedback | INSERT | — | full DML |
| share_agent_runs | — | — | full DML |
| share_extraction_failures | — | — | full DML |

- `authenticated` gets exactly the DML each table's RLS policies allow; it never
  gets direct INSERT/UPDATE on `share_jobs` (those go through the
  resolve/cancel/retry RPCs), any access to the media tables, or TRUNCATE.
- `anon` has no privileges on any of these tables (Nearr requires an
  authenticated session) **except** `analytics_events` INSERT (pre-sign-in
  telemetry). Because every role holds PUBLIC's privileges, an otherwise-empty
  `anon` also proves PUBLIC is empty.
- `service_role` (trusted backend; bypasses RLS but still needs table GRANTs for
  direct DML) has full DML on all twelve tables.
- Trigger/helper functions (`set_updated_at`, `handle_new_user`,
  `share_jobs_after_insert_kick`, `share_jobs_cascade_cancel_media`,
  `share_media_tasks_after_insert_kick`, `share_media_tasks_enforce_owner`) are
  system-invoked only — EXECUTE revoked from PUBLIC/anon/authenticated.

Function EXECUTE:

- Owner-facing RPCs — `authenticated` only: `resolve_share_job`,
  `cancel_share_job`, `retry_share_job`, `register_push_token`,
  `bump_reminder_opportunity_count`.
- Worker-only RPCs — `service_role` only (revoked from PUBLIC/anon/authenticated):
  `claim_share_jobs`, `create_share_job_for_user`,
  `claim_share_job_notifications`, `claim_share_job_receipts`,
  `invoke_process_share_jobs`, `claim_media_tasks`, `expire_media_tasks`,
  `requeue_media_task`, `claim_stranded_media_parents`,
  `invoke_process_media_tasks`.

## Triggers and helper functions

- `set_updated_at()`
- `handle_new_user()`
- `profiles_set_updated_at`
- `saved_places_set_updated_at`
- `on_auth_user_created`

## Account deletion (Apple 5.1.1(v))

Permanent account deletion is performed by the `delete-account` Edge
Function ([supabase/functions/delete-account/index.ts](../supabase/functions/delete-account/index.ts))
using a service-role admin client. The user id is derived only from the
caller's verified access token. Confirmed foreign-key behavior per table:

| Table | FK to `auth.users` | On user delete | How it is removed |
| --- | --- | --- | --- |
| `profiles` | `id` | `ON DELETE CASCADE` | Cascade |
| `saved_places` | `user_id` | `ON DELETE CASCADE` | Cascade |
| `notification_events` | `user_id` (+ `saved_place_id` → `saved_places` cascade) | `ON DELETE CASCADE` | Cascade |
| `analytics_events` | `user_id` | `ON DELETE SET NULL` | **Explicit delete** before auth-user removal |
| `feedback` | `user_id` | `ON DELETE SET NULL` | **Explicit delete** before auth-user removal |
| `share_agent_runs` | `user_id` | `ON DELETE SET NULL` | **Explicit delete** before auth-user removal |
| `share_extraction_failures` | `user_id` | `ON DELETE SET NULL` | **Explicit delete** before auth-user removal |
| `places` | — (shared) | n/a | **Never deleted** (shared across users) |

Deletion order: explicit `SET NULL` tables first, then
`auth.admin.deleteUser(userId)` triggers the cascades. The function returns
success only when every step succeeds; a failed step aborts before the auth
user is removed (no partial "success"). There are no user-owned Supabase
Storage objects.

**No migration is required** for account deletion — the existing cascade
rules plus the service-role explicit deletes cover all user-owned data.

## Current code assumptions that matter

- `saved_places.notification_count` must exist for reminder count-limit behavior and reset actions.
- There is currently no `saved_places` column for archived state, visited state, reminder-opportunity count, or reminder exhaustion state.
- Legal acceptance columns must exist for the profile/legal scaffolding to work, even though acceptance is disabled in beta.
- `places` is intentionally shared and reused across users.

## Do not claim these as current schema behavior

- no `deleted_at` on `saved_places`
- no `archived_at`, `visited_at`, `reminder_opportunity_count`, or `reminders_exhausted_at` on `saved_places`
- no photo tables or visit-completion tables
- no dedicated crash analytics tables
