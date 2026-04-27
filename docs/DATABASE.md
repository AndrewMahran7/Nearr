# Nearr — Database Schema

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

> Source: [supabase/migrations/20260426000001_init_schema.sql](../supabase/migrations/20260426000001_init_schema.sql).
> The legacy [supabase/schema.sql](../supabase/schema.sql) file is a
> pre-normalized prototype — DO NOT use it.

## Diagram

```
auth.users (Supabase managed)
    │ 1
    │
    ▼
profiles (PK = auth.users.id)
    │ 1
    │
    ▼ N
saved_places ──► places (M:1 via place_id)
    │ 1
    │
    ▼ N
notification_events
```

## Tables

### `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | references `auth.users(id)` ON DELETE CASCADE |
| `email` | text | mirrored at signup, kept loosely in sync |
| `default_radius_unit` | text | `'miles' | 'minutes'`, default `'miles'` |
| `default_radius_value` | numeric | default `1` |
| `notifications_enabled` | bool | default `true` |
| `nearby_notifications_enabled` | bool | default `true` |
| `quiet_hours_start` | text | `'HH:MM'` 24h, default `'22:00'` |
| `quiet_hours_end` | text | `'HH:MM'` 24h, default `'07:00'` |
| `created_at` / `updated_at` | timestamptz | `now()` defaults; `updated_at` maintained by trigger |

Auto-created by trigger `handle_new_user` on `auth.users` insert.

### `places`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `google_place_id` | text UNIQUE NOT NULL | dedupes everything |
| `name` | text NOT NULL |
| `address` | text |
| `lat` | double precision NOT NULL |
| `lng` | double precision NOT NULL |
| `categories` | text[] |
| `created_at` | timestamptz |

Cache of resolved Google places. **One row per `google_place_id`.**
RLS: anyone authenticated can SELECT/INSERT; **UPDATE / DELETE are
denied.** This is enforced in code by always doing SELECT-then-INSERT
in [savedPlacesService.saveSavedPlace](../services/savedPlacesService.ts)
(and in the Edge Function), with 23505 race recovery.

Index: `idx_places_google_place_id`.

### `saved_places`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK |
| `user_id` | uuid → `auth.users(id)` ON DELETE CASCADE |
| `place_id` | uuid → `places(id)` ON DELETE CASCADE |
| `radius_unit` | text NULL | `'miles' | 'minutes'`; NULL = inherit profile |
| `radius_value` | numeric NULL | NULL = inherit profile |
| `notes` | text |
| `notifications_enabled` | bool default `true` |
| `last_notified_at` | timestamptz |
| `source_type` | text default `'manual'` | `'manual' | 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'facebook' | 'pinterest' | 'reddit' | 'web'` |
| `source_url` | text |
| `created_at` / `updated_at` | timestamptz |

Constraints:

- `unique_user_place UNIQUE (user_id, place_id)` — one save per user
  per place. The save path catches 23505 and converts it into an UPDATE
  of `source_type` / `source_url` / `notes` / radius.
- Indexes: `idx_saved_places_user_id`, `idx_saved_places_place_id`,
  `idx_saved_places_user_created`.
- Trigger: `updated_at = now()` on UPDATE.

### `notification_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK |
| `user_id` | uuid → `auth.users(id)` ON DELETE CASCADE |
| `saved_place_id` | uuid → `saved_places(id)` ON DELETE CASCADE |
| `event_type` | text CHECK (`'nearby' | 'entered' | 'exited' | 'silenced'`) |
| `distance_meters` | numeric |
| `created_at` | timestamptz |

Indexes: `idx_notification_events_user`, `idx_notification_events_saved_place`,
`idx_notification_events_created`.

**Reality check.** Only `'nearby'` is emitted today
(see [lib/notifications.ts](../lib/notifications.ts) → `fireNotification`).
`'entered'`, `'exited'`, `'silenced'` are V2 placeholders kept in the
CHECK constraint so we can ship richer events without a migration. In
particular, quiet-hours suppressions silently skip both the local
notification AND the event-row insert today.

## Row Level Security

Enabled on every table. Policies (per migration):

- `profiles`
  - SELECT: `auth.uid() = id`
  - UPDATE: `auth.uid() = id`
  - INSERT: by trigger only (no client INSERT path)
- `places`
  - SELECT: any authenticated
  - INSERT: any authenticated (server and clients alike)
  - **No UPDATE, no DELETE policy.** Code never tries.
- `saved_places`
  - All four verbs gated on `auth.uid() = user_id`.
- `notification_events`
  - SELECT / INSERT gated on `auth.uid() = user_id`. No UPDATE / DELETE
    policy needed — events are append-only.

The Edge Function uses the **service-role** key, so it bypasses RLS;
it explicitly verifies `auth.getUser(accessToken)` before doing any
write so the effective user identity is still the caller's.

## Triggers / Functions

- `handle_updated_at()` — generic `updated_at = now()` BEFORE UPDATE.
  Attached to `profiles` and `saved_places`.
- `handle_new_user()` — AFTER INSERT on `auth.users`, inserts a
  matching `profiles` row with defaults.

## Migration / setup

1. Initialize project: `supabase init` (already committed).
2. Link: `supabase link --project-ref <ref>`.
3. Push: `supabase db push` (applies migrations in
   [supabase/migrations](../supabase/migrations)).
4. Verify in dashboard: tables exist, RLS is on for all four, the
   `handle_new_user` trigger fires (sign up a test user → check
   `profiles`).
5. Edge Function: `supabase functions deploy process-share-link` plus
   `supabase secrets set GEMINI_API_KEY=… GOOGLE_PLACES_KEY=…`.
6. Auth: confirm Site URL + redirect URLs include `nearr://auth-callback`
   AND `exp://…/--/auth-callback` for Expo Go testing.
