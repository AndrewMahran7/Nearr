-- Add notification_count to saved_places.
--
-- Tracks how many proximity notifications have been sent for each saved place.
-- Max 3 per place (enforced in app logic, not DB constraint, so existing rows
-- with a high count are preserved). Reset to 0 via the "Give me 3 more
-- chances" notification action.
--
-- Run via Supabase CLI: supabase db push

alter table public.saved_places
  add column if not exists notification_count integer not null default 0;
