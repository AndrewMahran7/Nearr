-- Run ONLY on an isolated Production-schema restore with auth.uid/auth.jwt
-- test stubs, after 20261008000001. Never run against Production.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000011','legacy@example.invalid'),
  ('00000000-0000-0000-0000-000000000012','other@example.invalid');
insert into public.profiles(id,email) values
  ('00000000-0000-0000-0000-000000000011','legacy@example.invalid'),
  ('00000000-0000-0000-0000-000000000012','other@example.invalid')
on conflict (id) do update set email=excluded.email;
insert into public.places(id,google_place_id,name,latitude,longitude) values
  ('00000000-0000-0000-0000-000000000021','fixture-place','Fixture place',1,1);
insert into public.saved_places(id,user_id,place_id,source_type) values
  ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','manual'),
  ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000021','manual');
-- Fixture insertion bypasses only the *local* worker-kick trigger. The
-- authenticated read/RLS checks below run with normal trigger/RLS settings.
set local session_replication_role = replica;
insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url) values
  ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000011','fixture:legacy',1,'link','legacy','https://example.invalid/legacy'),
  ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000012','fixture:other',1,'link','other','https://example.invalid/other');
insert into public.share_jobs(id,user_id,source_url,status,saved_place_id,notification_status,notification_payload) values
  ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','https://example.invalid/legacy','completed','00000000-0000-0000-0000-000000000031','submitted','{"title":"Saved","body":"Open Nearr","data":{"type":"share_job_completed","jobId":"00000000-0000-0000-0000-000000000041"}}'),
  ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000012','https://example.invalid/other','completed','00000000-0000-0000-0000-000000000032','submitted','{"title":"Saved","body":"Open Nearr","data":{"type":"share_job_completed","jobId":"00000000-0000-0000-0000-000000000042"}}');
insert into public.share_job_place_results(share_job_id,user_id,logical_result_id,google_place_id,place_id,saved_place_id,original_saved_place_id,outcome,origin,rule_version) values
  ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','result-1','fixture-place','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000031','auto_saved','automatic','fixture-v1');
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$
declare v_count integer;
begin
  -- LEGACY_CLIENT_CONTRACT: the exact legacy profile fields remain readable.
  select count(*) into v_count from (
    select id,email,notifications_enabled,nearby_notifications_enabled,
      quiet_hours_enabled,quiet_hours_start,quiet_hours_end,
      terms_accepted_at,privacy_accepted_at,legal_version,created_at,updated_at
    from public.profiles
  ) p;
  if v_count <> 1 then raise exception 'legacy_profile_rls_failed'; end if;
  -- NEARR_1_5_CLIENT_CONTRACT: the additive nullable selector is readable.
  select count(*) into v_count from (
    select id,email,first_name,last_name,notifications_enabled,
      nearby_notifications_enabled,quiet_hours_enabled,quiet_hours_start,
      quiet_hours_end,terms_accepted_at,privacy_accepted_at,legal_version,
      created_at,updated_at from public.profiles
  ) p;
  if v_count <> 1 then raise exception 'new_profile_rls_failed'; end if;
  select count(*) into v_count from public.saved_places;
  if v_count <> 1 then raise exception 'saved_places_rls_failed'; end if;
  select count(*) into v_count from public.saved_place_sources;
  if v_count <> 1 then raise exception 'saved_place_sources_rls_failed'; end if;
  select count(*) into v_count from public.share_jobs;
  if v_count <> 1 then raise exception 'share_jobs_rls_failed'; end if;
  select count(*) into v_count from public.share_job_place_results;
  if v_count <> 1 then raise exception 'share_results_rls_failed'; end if;
end $$;
update public.profiles set first_name='Ada' where id='00000000-0000-0000-0000-000000000011';
do $$
begin
  if (select first_name from public.profiles) <> 'Ada' then
    raise exception 'self_name_update_failed';
  end if;
end $$;
reset role;
rollback;
\echo PASS isolated Production-schema LEGACY_CLIENT_CONTRACT and NEARR_1_5_CLIENT_CONTRACT selectors/RLS
