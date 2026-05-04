# Nearr — Database Schema

> Last updated: 2026-05-03
> Source of truth: `supabase/migrations/`

Do not use `supabase/schema.sql` as the canonical schema. The migration files under `supabase/migrations/` are the source of truth.

## Migration inventory

- `20260426000001_init_schema.sql`
- `20260427000001_analytics_events.sql`
- `20260501000001_notification_count.sql`
- `20260502000001_legal_acceptance.sql`
- `20260503000001_opportunity_archive.sql`

## Schema overview

```text
auth.users
  └─ profiles (1:1)

places
  └─ saved_places (many per user, unique per user/place)
       └─ notification_events

analytics_events
```

## `profiles`

Created in `20260426000001_init_schema.sql` and extended in `20260502000001_legal_acceptance.sql`.

Columns:

- `id uuid primary key references auth.users(id) on delete cascade`
- `email text`
- `default_radius_value numeric not null default 1`
- `default_radius_unit text not null default 'miles' check in ('miles','minutes')`
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

## Row-level security

RLS is enabled on:

- `profiles`
- `places`
- `saved_places`
- `notification_events`
- `analytics_events`

Current policy model:

- `profiles`: owner-only read/update/insert
- `places`: authenticated read + insert, no client update/delete
- `saved_places`: owner-only read/write/delete
- `notification_events`: owner-only read/insert
- `analytics_events`: insert allowed for authenticated and anonymous clients under controlled rules, no client read path

## Triggers and helper functions

- `set_updated_at()`
- `handle_new_user()`
- `profiles_set_updated_at`
- `saved_places_set_updated_at`
- `on_auth_user_created`

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
