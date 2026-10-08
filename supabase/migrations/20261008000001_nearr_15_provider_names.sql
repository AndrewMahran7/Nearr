-- Nearr 1.5 compatibility only. Old clients omit these nullable columns.
-- The 1.5 provider callback writes non-empty structured names through the
-- existing self-upsert policy; the existing auth trigger is intentionally left
-- unchanged so current-client signup behavior is identical.
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;
