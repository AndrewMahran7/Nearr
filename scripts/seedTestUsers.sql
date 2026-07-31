-- scripts/seedTestUsers.sql
--
-- Idempotently (re)create the two placeholder auth.users the SQL test suites
-- (testShareJobsRls.sql / testShareJobsDurability.sql) reference. `supabase db
-- reset` wipes auth.users, so this is run right after a reset to restore them.
--
-- These are LOCAL-DEV-ONLY throwaway accounts. Never run against a real project.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/seedTestUsers.sql
--
--   User A: 11111111-1111-4111-8111-111111111111
--   User B: 22222222-2222-4222-8222-222222222222

\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'share-jobs-test-a@example.com',
    crypt('test-password-a', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'share-jobs-test-b@example.com',
    crypt('test-password-b', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    '', '', '', ''
  )
on conflict (id) do nothing;

select id, email from auth.users
 where id in (
   '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222'
 )
 order by email;
