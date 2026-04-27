# Nearr Database Schema (V1)

Source of truth: [supabase/migrations/20260426000001_init_schema.sql](../supabase/migrations/20260426000001_init_schema.sql).
The legacy single-file `supabase/schema.sql` is kept only for reference and is **superseded** by the migration.

## Apply the migration

```bash
# With the Supabase CLI (preferred — keeps history)
supabase db push

# Or, in the Supabase dashboard:
# SQL Editor → New query → paste contents of the migration file → Run
```

## Tables

### `profiles`
One row per `auth.users` user. Stores user-level defaults and notification preferences. A trigger on `auth.users` (`on_auth_user_created`) auto-inserts a row on signup, so the client can always read `profiles` after the first session.

| column | purpose |
| --- | --- |
| `id` | PK, FK → `auth.users.id` (cascade delete) |
| `email` | mirrored from auth, denormalized for convenience |
| `default_radius_value` | numeric, default `1` |
| `default_radius_unit` | `'miles'` or `'minutes'`, default `'miles'` |
| `notifications_enabled` | master toggle |
| `nearby_notifications_enabled` | nearby-alerts toggle (separate from any future kinds) |
| `quiet_hours_enabled` | gate for quiet-hours window |
| `quiet_hours_start` / `quiet_hours_end` | `time` columns |
| `created_at` / `updated_at` | timestamps; `updated_at` maintained by trigger |

### `places`
Canonical place records — **shared** across users. Deduped on `google_place_id` (unique). Holds Google Places metadata only; nothing user-specific lives here.

| column | purpose |
| --- | --- |
| `id` | PK |
| `google_place_id` | unique, used as the dedupe key |
| `name`, `formatted_address`, `latitude`, `longitude` | from Google |
| `category`, `google_maps_url` | optional metadata |
| `created_at` | timestamp |

Indexed on `(latitude, longitude)` for future geo queries.

### `saved_places`
The per-user "I want to go here" record. Joins a user to a `places` row with overrides.

| column | purpose |
| --- | --- |
| `id` | PK |
| `user_id` | FK → `auth.users.id` (cascade) |
| `place_id` | FK → `places.id` (cascade) |
| `radius_value`, `radius_unit` | per-place override (nullable → use profile default) |
| `notes` | user notes |
| `source_type` | `'manual' \| 'tiktok' \| 'instagram' \| 'link'` |
| `source_url` | original share URL |
| `notifications_enabled` | per-place toggle |
| `last_notified_at` | populated by the proximity loop for cooldown |
| `created_at` / `updated_at` | timestamps |

`unique (user_id, place_id)` so a user can only save a given place once.

### `notification_events`
Append-only audit log. The proximity loop inserts a row each time it fires (or silences) an alert. Useful for debugging cooldowns and as a source of truth instead of in-memory state.

| column | purpose |
| --- | --- |
| `id` | PK |
| `user_id` | FK → `auth.users.id` |
| `saved_place_id` | FK → `saved_places.id` |
| `event_type` | `'nearby' \| 'entered' \| 'exited' \| 'silenced'` |
| `user_latitude`, `user_longitude`, `distance_meters` | telemetry |
| `created_at` | timestamp |

Indexed on `(user_id, created_at desc)` and `(saved_place_id, created_at desc)`.

## Row-Level Security

RLS is **enabled on every table**. Policies:

| table | policies |
| --- | --- |
| `profiles` | `select / insert / update` only where `auth.uid() = id`. |
| `places` | `select / insert` open to **authenticated** users. No update or delete from clients. (Multiple users naturally share rows because of the `google_place_id` unique constraint.) |
| `saved_places` | `select / insert / update / delete` only where `auth.uid() = user_id`. |
| `notification_events` | `select / insert` only where `auth.uid() = user_id`. No update or delete (audit log is immutable from clients). |

There is no service-role bypass needed for the V1 client; everything works with the anon key + a logged-in session.

## Triggers

- `set_updated_at()` — generic `before update` trigger; attached to `profiles` and `saved_places`.
- `handle_new_user()` — `after insert on auth.users`; auto-creates the matching `profiles` row.

## Migration relationship to `lib/` types

The TypeScript types in `types/index.ts` will be updated in the next task to match this normalized schema (currently they reflect the older flat `places` table). The migration file is the source of truth — types follow it.
