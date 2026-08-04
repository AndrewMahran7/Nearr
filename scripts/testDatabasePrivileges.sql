-- scripts/testDatabasePrivileges.sql
--
-- Explicit privilege assertions for the ENTIRE Nearr public schema (Phase 1 +
-- Phase 2). Proves every application object grants EXACTLY the access each role
-- needs, independent of the Supabase CLI's default privileges (see migrations
-- 20260801000004_explicit_privileges.sql and 20260801000005_aux_privileges.sql).
--
-- Run pattern (auth.users seeding not required — pure catalog checks):
--   docker cp scripts/testDatabasePrivileges.sql supabase_db_Nearr:/tmp/p.sql
--   docker exec supabase_db_Nearr sh -c "psql -U postgres -d postgres -q \
--     -v ON_ERROR_STOP=1 -f /tmp/p.sql 2>&1"
--
-- COMPLETENESS: section 0 fails if any public table / function / sequence /
-- view / materialized view is NOT declared below, so a newly added application
-- object breaks this test until its privilege expectations are added.
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
-- 0. COMPLETENESS — every application object in `public` must be declared.
-- =====================================================================

-- 0a. Tables.
do $$
declare
  declared text[] := array[
    'analytics_events','feedback','notification_events','places','profiles',
    'saved_places','share_agent_runs','share_extraction_failures','share_job_place_results','share_jobs',
    'share_media_runs','share_media_tasks','user_push_tokens'
  ];
  undeclared text;
  missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into undeclared
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> all(declared);
  if undeclared is not null then
    raise exception 'FAIL undeclared public table(s): % — add privilege expectations', undeclared;
  end if;
  select string_agg(d, ', ') into missing from unnest(declared) d
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = d);
  if missing is not null then
    raise exception 'FAIL declared table(s) missing from schema: %', missing;
  end if;
  raise notice 'PASS table completeness (% tables declared + present)', array_length(declared,1);
end $$;

-- 0b. Functions (names are unique in this schema — no overloads).
do $$
declare
  declared text[] := array[
    'auto_save_share_job_place_result','bump_reminder_opportunity_count','cancel_share_job','claim_media_tasks',
    'claim_share_job_notifications','claim_share_job_receipts','claim_share_jobs',
    'claim_stranded_media_parents','create_share_job_for_user','expire_media_tasks',
    'handle_new_user','invoke_process_media_tasks','invoke_process_share_jobs',
    'register_push_token','requeue_media_task','resolve_share_job','retry_share_job',
    'set_saved_place_category','undo_auto_saved_place',
    'preserve_share_result_original_saved_place','set_updated_at','share_jobs_after_insert_kick','share_jobs_cascade_cancel_media',
    'share_media_tasks_after_insert_kick','share_media_tasks_enforce_owner'
  ];
  undeclared text;
  missing text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into undeclared
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> all(declared);
  if undeclared is not null then
    raise exception 'FAIL undeclared public function(s): % — add privilege expectations', undeclared;
  end if;
  select string_agg(d, ', ') into missing from unnest(declared) d
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = d);
  if missing is not null then
    raise exception 'FAIL declared function(s) missing from schema: %', missing;
  end if;
  raise notice 'PASS function completeness (% functions declared + present)', array_length(declared,1);
end $$;

-- 0c. No undeclared sequences / views / materialized views (there are none;
--     any that appear must be declared + given explicit privileges).
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relkind='S';
  if n <> 0 then raise exception 'FAIL % undeclared public sequence(s)', n; end if;
  select count(*) into n from information_schema.views where table_schema='public';
  if n <> 0 then raise exception 'FAIL % undeclared public view(s)', n; end if;
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relkind='m';
  if n <> 0 then raise exception 'FAIL % undeclared public materialized view(s)', n; end if;
  raise notice 'PASS no undeclared sequences / views / materialized views';
end $$;

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

-- analytics_events: append-only telemetry — authenticated INSERT only.
select pg_temp._t(pg_temp._tbl('authenticated','public.analytics_events','INSERT'), 'authenticated INSERT analytics_events');
select pg_temp._t(not pg_temp._tbl('authenticated','public.analytics_events','SELECT'), 'authenticated NO SELECT analytics_events');
select pg_temp._t(not pg_temp._tbl('authenticated','public.analytics_events','UPDATE'), 'authenticated NO UPDATE analytics_events');
select pg_temp._t(not pg_temp._tbl('authenticated','public.analytics_events','DELETE'), 'authenticated NO DELETE analytics_events');

-- feedback: authenticated INSERT own only; no client read.
select pg_temp._t(pg_temp._tbl('authenticated','public.feedback','INSERT'), 'authenticated INSERT feedback');
select pg_temp._t(not pg_temp._tbl('authenticated','public.feedback','SELECT'), 'authenticated NO SELECT feedback');
select pg_temp._t(not pg_temp._tbl('authenticated','public.feedback','UPDATE'), 'authenticated NO UPDATE feedback');
select pg_temp._t(not pg_temp._tbl('authenticated','public.feedback','DELETE'), 'authenticated NO DELETE feedback');

-- share_job_place_results: owner-readable audit, worker-managed writes.
select pg_temp._t(pg_temp._tbl('authenticated','public.share_job_place_results','SELECT'), 'authenticated SELECT share_job_place_results');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_job_place_results','INSERT'), 'authenticated NO INSERT share_job_place_results');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_job_place_results','UPDATE'), 'authenticated NO UPDATE share_job_place_results');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_job_place_results','DELETE'), 'authenticated NO DELETE share_job_place_results');

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
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_agent_runs','SELECT'), 'authenticated NO SELECT share_agent_runs');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_agent_runs','INSERT'), 'authenticated NO INSERT share_agent_runs');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_extraction_failures','SELECT'), 'authenticated NO SELECT share_extraction_failures');
select pg_temp._t(not pg_temp._tbl('authenticated','public.share_extraction_failures','INSERT'), 'authenticated NO INSERT share_extraction_failures');

-- =====================================================================
-- 3. anon access — INSERT-only on analytics_events; nothing anywhere else.
--    (anon holds every PUBLIC privilege, so anon=false also proves PUBLIC=false.)
-- =====================================================================
select pg_temp._t(pg_temp._tbl('anon','public.analytics_events','INSERT'), 'anon INSERT analytics_events (pre-signin telemetry)');
select pg_temp._t(not pg_temp._tbl('anon','public.analytics_events','SELECT'), 'anon NO SELECT analytics_events');
select pg_temp._t(not pg_temp._tbl('anon','public.analytics_events','UPDATE'), 'anon NO UPDATE analytics_events');
select pg_temp._t(not pg_temp._tbl('anon','public.analytics_events','DELETE'), 'anon NO DELETE analytics_events');
select pg_temp._t(not pg_temp._tbl('anon','public.analytics_events','TRUNCATE'), 'anon NO TRUNCATE analytics_events');

do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'public.profiles','public.places','public.saved_places','public.notification_events',
    'public.share_jobs','public.user_push_tokens','public.share_media_tasks','public.share_media_runs',
    'public.share_job_place_results','public.feedback','public.share_agent_runs','public.share_extraction_failures'
  ] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', t, p) then
        raise exception 'FAIL anon must NOT have % on %', p, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS anon has no access to any table except analytics_events INSERT';
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
    'public.invoke_process_media_tasks()',
    'public.auto_save_share_job_place_result(uuid, uuid, uuid, text, text, text, text, numeric, numeric, text, text, text, numeric, text, jsonb)'
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
  raise notice 'PASS worker RPCs: anon+authenticated denied, service_role granted (11 fns)';
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
    'public.bump_reminder_opportunity_count(uuid[])',
    'public.undo_auto_saved_place(uuid, text, uuid)',
    'public.set_saved_place_category(uuid, text)'
  ] loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FAIL authenticated must execute owner RPC %', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FAIL anon must NOT execute owner RPC %', fn;
    end if;
  end loop;
  raise notice 'PASS owner RPCs: authenticated granted, anon denied (7 fns)';
end $$;

-- =====================================================================
-- 6. Trigger / helper functions: not callable by client roles (system-invoked).
-- =====================================================================
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.set_updated_at()',
    'public.preserve_share_result_original_saved_place()',
    'public.handle_new_user()',
    'public.share_jobs_after_insert_kick()',
    'public.share_jobs_cascade_cancel_media()',
    'public.share_media_tasks_after_insert_kick()',
    'public.share_media_tasks_enforce_owner()'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FAIL anon must NOT execute trigger fn %', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FAIL authenticated must NOT execute trigger fn %', fn;
    end if;
  end loop;
  raise notice 'PASS trigger/helper functions not client-executable (7 fns)';
end $$;

-- =====================================================================
-- 7. service_role retains the required direct-DML access on EVERY app table.
-- =====================================================================
do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'public.profiles','public.places','public.saved_places','public.notification_events',
    'public.share_jobs','public.user_push_tokens','public.share_media_tasks','public.share_media_runs',
    'public.share_job_place_results','public.analytics_events','public.feedback','public.share_agent_runs','public.share_extraction_failures'
  ] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'FAIL service_role must have % on %', p, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS service_role has SELECT/INSERT/UPDATE/DELETE on all 13 app tables';
end $$;

select 'ALL DATABASE PRIVILEGE ASSERTIONS PASSED' as result;

rollback;
