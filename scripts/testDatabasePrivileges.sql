-- scripts/testDatabasePrivileges.sql
--
-- Explicit privilege assertions for Nearr Phase 1 + Phase 2. Proves the schema
-- grants EXACTLY the access each role needs, independent of the Supabase CLI's
-- default privileges (see migration 20260801000004_explicit_privileges.sql).
--
-- Run pattern (auth.users seeding not required — pure catalog checks):
--   docker cp scripts/testDatabasePrivileges.sql supabase_db_Nearr:/tmp/p.sql
--   docker exec supabase_db_Nearr sh -c "psql -U postgres -d postgres -q \
--     -v ON_ERROR_STOP=1 -f /tmp/p.sql 2>&1"
--
-- Any violated assertion raises an exception -> ON_ERROR_STOP aborts with a
-- non-zero exit and the failing label. No rows are written.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp._t(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then
    raise notice 'PASS %', label;
  else
    raise exception 'FAIL %', label;
  end if;
end $$;

create or replace function pg_temp._tbl(role_name text, tbl text, priv text) returns boolean
language sql stable as $$
  select has_table_privilege(role_name, tbl, priv);
$$;

create or replace function pg_temp._fn(role_name text, fn text) returns boolean
language sql stable as $$
  select has_function_privilege(role_name, fn, 'EXECUTE');
$$;

-- =====================================================================
-- 1. authenticated has EXACTLY the required access to owner-readable tables
-- =====================================================================

-- profiles: select/insert/update; NOT delete/truncate.
select pg_temp._t(pg_temp._tbl('authenticated','public.profiles','SELECT'), 'authenticated SELECT profiles');
select pg_temp._t(pg_temp._tbl('authenticated','public.profiles','INSERT'), 'authenticated INSERT profiles');
select pg_temp._t(pg_temp._tbl('authenticated','public.profiles','UPDATE'), 'authenticated UPDATE profiles');
select pg_temp._t(not pg_temp._tbl('authenticated','public.profiles','DELETE'), 'authenticated NO DELETE profiles');
select pg_temp._t(not pg_temp._tbl('authenticated','public.profiles','TRUNCATE'), 'authenticated NO TRUNCATE profiles');

-- places: select/insert; NOT update/delete.
select pg_temp._t(pg_temp._tbl('authenticated','public.places','SELECT'), 'authenticated SELECT places');
select pg_temp._t(pg_temp._tbl('authenticated','public.places','INSERT'), 'authenticated INSERT places');
select pg_temp._t(not pg_temp._tbl('authenticated','public.places','UPDATE'), 'authenticated NO UPDATE places');
select pg_temp._t(not pg_temp._tbl('authenticated','public.places','DELETE'), 'authenticated NO DELETE places');

-- saved_places: full owner CRUD.
select pg_temp._t(pg_temp._tbl('authenticated','public.saved_places','SELECT'), 'authenticated SELECT saved_places');
select pg_temp._t(pg_temp._tbl('authenticated','public.saved_places','INSERT'), 'authenticated INSERT saved_places');
select pg_temp._t(pg_temp._tbl('authenticated','public.saved_places','UPDATE'), 'authenticated UPDATE saved_places');
select pg_temp._t(pg_temp._tbl('authenticated','public.saved_places','DELETE'), 'authenticated DELETE saved_places');

-- notification_events: select/insert; NOT update/delete.
select pg_temp._t(pg_temp._tbl('authenticated','public.notification_events','SELECT'), 'authenticated SELECT notification_events');
select pg_temp._t(pg_temp._tbl('authenticated','public.notification_events','INSERT'), 'authenticated INSERT notification_events');
select pg_temp._t(not pg_temp._tbl('authenticated','public.notification_events','UPDATE'), 'authenticated NO UPDATE notification_events');
select pg_temp._t(not pg_temp._tbl('authenticated','public.notification_events','DELETE'), 'authenticated NO DELETE notification_events');

-- user_push_tokens: full owner CRUD.
select pg_temp._t(pg_temp._tbl('authenticated','public.user_push_tokens','SELECT'), 'authenticated SELECT user_push_tokens');
select pg_temp._t(pg_temp._tbl('authenticated','public.user_push_tokens','INSERT'), 'authenticated INSERT user_push_tokens');
select pg_temp._t(pg_temp._tbl('authenticated','public.user_push_tokens','UPDATE'), 'authenticated UPDATE user_push_tokens');
select pg_temp._t(pg_temp._tbl('authenticated','public.user_push_tokens','DELETE'), 'authenticated DELETE user_push_tokens');

-- share_jobs: owner may READ + DELETE; NEVER direct insert/update (worker state).
select pg_temp._t(pg_temp._tbl('authenticated','public.share_jobs','SELECT'), 'authenticated SELECT share_jobs');
select pg_temp._t(pg_temp._tbl('authenticated','public.share_jobs','DELETE'), 'authenticated DELETE share_jobs');

-- =====================================================================
-- 2. authenticated does NOT have direct worker-managed writes
-- =====================================================================
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_jobs','INSERT'), 'authenticated NO INSERT share_jobs');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_jobs','UPDATE'), 'authenticated NO UPDATE share_jobs');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_tasks','SELECT'), 'authenticated NO SELECT share_media_tasks');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_tasks','INSERT'), 'authenticated NO INSERT share_media_tasks');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_tasks','UPDATE'), 'authenticated NO UPDATE share_media_tasks');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_tasks','DELETE'), 'authenticated NO DELETE share_media_tasks');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_runs','SELECT'), 'authenticated NO SELECT share_media_runs');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_media_runs','INSERT'), 'authenticated NO INSERT share_media_runs');

-- =====================================================================
-- 3. anon has NO access to any app table (Nearr requires an auth session).
--    Checking anon also proves PUBLIC has nothing (every role holds PUBLIC's
--    privileges, so anon=false => PUBLIC=false).
-- =====================================================================
do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'public.profiles','public.places','public.saved_places','public.notification_events',
    'public.share_jobs','public.user_push_tokens','public.share_media_tasks','public.share_media_runs'
  ] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', t, p) then
        raise exception 'FAIL anon must NOT have % on %', p, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS anon has no SELECT/INSERT/UPDATE/DELETE/TRUNCATE on any app table';
end $$;

-- =====================================================================
-- 4. Worker-only RPCs: unavailable to PUBLIC/anon/authenticated; service_role yes
-- =====================================================================
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_share_jobs(integer, integer)',
    'public.create_share_job_for_user(uuid, text, text, text, text, integer)',
    'public.claim_share_job_notifications(integer, integer)',
    'public.claim_share_job_receipts(integer, integer)',
    'public.invoke_process_share_jobs()',
    'public.claim_media_tasks(integer, integer)',
    'public.expire_media_tasks(integer)',
    'public.requeue_media_task(uuid, integer, text)',
    'public.claim_stranded_media_parents(integer)',
    'public.invoke_process_media_tasks()'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FAIL anon must NOT execute worker RPC %', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FAIL authenticated must NOT execute worker RPC %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'FAIL service_role must execute worker RPC %', fn;
    end if;
  end loop;
  raise notice 'PASS worker RPCs: anon+authenticated denied, service_role granted (10 fns)';
end $$;

-- =====================================================================
-- 5. Owner-facing RPCs: authenticated may execute; anon may not.
-- =====================================================================
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.resolve_share_job(uuid, uuid)',
    'public.cancel_share_job(uuid)',
    'public.retry_share_job(uuid)',
    'public.register_push_token(text, text, text)',
    'public.bump_reminder_opportunity_count(uuid[])'
  ] loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FAIL authenticated must execute owner RPC %', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FAIL anon must NOT execute owner RPC %', fn;
    end if;
  end loop;
  raise notice 'PASS owner RPCs: authenticated granted, anon denied (5 fns)';
end $$;

-- =====================================================================
-- 6. service_role retains the required direct-DML worker access on every table.
-- =====================================================================
do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'public.profiles','public.places','public.saved_places','public.notification_events',
    'public.share_jobs','public.user_push_tokens','public.share_media_tasks','public.share_media_runs'
  ] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'FAIL service_role must have % on %', p, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS service_role has SELECT/INSERT/UPDATE/DELETE on all 8 app tables';
end $$;

select 'ALL DATABASE PRIVILEGE ASSERTIONS PASSED' as result;

rollback;
