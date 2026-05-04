-- Opportunity / visited / archived state for saved_places.
--
-- Additive only. No destructive changes. No RLS policy changes — existing
-- per-user policies on saved_places already cover SELECT/UPDATE for these
-- new columns.
--
-- Columns:
--   reminder_opportunity_count  number of nearby reminders the user has
--                               received for this place (gates archival
--                               after the third opportunity).
--   archived_at                 set when the user (or auto-archive after
--                               3 opportunities) archives a saved place.
--   visited_at                  set when the user marks a saved place as
--                               visited from the opportunity screen.
--   reminders_exhausted_at      set when archive happens because the user
--                               declined the third opportunity, used for
--                               analytics + future "opportunity expired"
--                               UI.

alter table public.saved_places
  add column if not exists reminder_opportunity_count integer not null default 0,
  add column if not exists archived_at timestamptz,
  add column if not exists visited_at timestamptz,
  add column if not exists reminders_exhausted_at timestamptz;

-- Active = not archived AND not visited. This is the hottest filter
-- in the Places tab so a partial index pays for itself.
create index if not exists saved_places_active_idx
  on public.saved_places (user_id)
  where archived_at is null and visited_at is null;

-- Atomic, race-safe increment used by the notification delivery path.
-- Callable by authenticated users; the WHERE clause restricts to rows
-- they own so this function cannot be used to mutate other users' data.
create or replace function public.bump_reminder_opportunity_count(
  saved_place_ids uuid[]
)
returns void
language sql
security invoker
as $$
  update public.saved_places
  set reminder_opportunity_count = reminder_opportunity_count + 1
  where id = any (saved_place_ids)
    and user_id = auth.uid();
$$;

grant execute on function public.bump_reminder_opportunity_count(uuid[]) to authenticated;
