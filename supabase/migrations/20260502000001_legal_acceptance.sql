alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists legal_version text;