-- Owner-scoped category correction and exact automatic-save undo checks.
-- Local only; requires scripts/seedTestUsers.sql after a database reset.

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp._t(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label;
  else raise exception 'FAIL %', label;
  end if;
end $$;

create temporary table _undo_ctx (
  job_a uuid, job_a_correct uuid, job_b uuid,
  saved_a uuid, saved_a_correct uuid, saved_a_keep uuid, saved_b uuid
) on commit drop;
grant select on _undo_ctx to authenticated;

with
  ja as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage, candidate_payload)
    values ('11111111-1111-4111-8111-111111111111', 'https://example.com/a', 'instagram', 'processing_metadata', 'verifying_place', '{}'::jsonb)
    returning id
  ),
  jac as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage, candidate_payload)
    values ('11111111-1111-4111-8111-111111111111', 'https://example.com/a-correct', 'instagram', 'processing_metadata', 'verifying_place', '{}'::jsonb)
    returning id
  ),
  jb as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage, candidate_payload)
    values ('22222222-2222-4222-8222-222222222222', 'https://example.com/b', 'instagram', 'processing_metadata', 'verifying_place', '{}'::jsonb)
    returning id
  )
insert into _undo_ctx (job_a, job_a_correct, job_b)
select ja.id, jac.id, jb.id from ja, jac, jb;

do $$
declare c _undo_ctx%rowtype; v_saved uuid; v_place uuid; v_reused boolean;
begin
  select * into c from _undo_ctx;
  select * into v_saved, v_place, v_reused from public.auto_save_share_job_place_result(
    c.job_a, null, null, 'a1', 'undo-google-a', 'Auto A', null,
    34.01, -118.01, 'park', 'instagram', 'https://example.com/a', 0.9, 'test.v1', '[]');
  update _undo_ctx set saved_a = v_saved;
  select * into v_saved, v_place, v_reused from public.auto_save_share_job_place_result(
    c.job_a_correct, null, null, 'a2', 'undo-google-a2', 'Auto A2', null,
    34.02, -118.02, 'museum', 'instagram', 'https://example.com/a-correct', 0.9, 'test.v1', '[]');
  update _undo_ctx set saved_a_correct = v_saved;
  select * into v_saved, v_place, v_reused from public.auto_save_share_job_place_result(
    c.job_b, null, null, 'b1', 'undo-google-b', 'Auto B', null,
    35.01, -119.01, 'hotel', 'instagram', 'https://example.com/b', 0.9, 'test.v1', '[]');
  update _undo_ctx set saved_b = v_saved;
end $$;

with p as (
  insert into public.places (google_place_id, name, latitude, longitude)
  values ('undo-google-keep', 'Keep A', 34.03, -118.03) returning id
), s as (
  insert into public.saved_places (user_id, place_id, source_type, category, category_source)
  select '11111111-1111-4111-8111-111111111111', id, 'manual', 'cafe', 'google_types' from p returning id
)
update _undo_ctx set saved_a_keep = s.id from s;

update public.share_jobs j
set saved_place_id = c.saved_a,
    candidate_payload = jsonb_build_object('savedPlaceIds', jsonb_build_array(c.saved_a::text, c.saved_a_keep::text))
from _undo_ctx c where j.id = c.job_a;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare c _undo_ctx%rowtype;
begin
  select * into c from _undo_ctx;
  begin
    perform * from public.undo_auto_saved_place(c.saved_b);
    raise exception 'FAIL cross-user undo accepted';
  exception when others then
    if sqlerrm = 'FAIL cross-user undo accepted' then raise; end if;
    perform pg_temp._t(position('automatic_save_not_found' in sqlerrm) > 0, 'cross-user undo rejected');
  end;
  begin
    perform * from public.undo_auto_saved_place(c.saved_a_correct, 'corrected', c.saved_b);
    raise exception 'FAIL cross-user replacement accepted';
  exception when others then
    if sqlerrm = 'FAIL cross-user replacement accepted' then raise; end if;
    perform pg_temp._t(position('replacement_not_owned' in sqlerrm) > 0, 'cross-user replacement rejected');
  end;
end $$;

select pg_temp._t((select undone and not already_undone from public.undo_auto_saved_place((select saved_a from _undo_ctx))), 'owner undo succeeds');
select pg_temp._t(not exists (select 1 from public.saved_places where id = (select saved_a from _undo_ctx)), 'undo deletes exact auto-saved row');
select pg_temp._t(exists (select 1 from public.saved_places where id = (select saved_a_keep from _undo_ctx)), 'unrelated owner row survives');
select pg_temp._t((select outcome = 'undone_by_user' and saved_place_id is null and original_saved_place_id = (select saved_a from _undo_ctx) from public.share_job_place_results where share_job_id = (select job_a from _undo_ctx)), 'audit identity survives deletion');
select pg_temp._t((select not (candidate_payload->'savedPlaceIds' @> jsonb_build_array((select saved_a::text from _undo_ctx))) and candidate_payload->'savedPlaceIds' @> jsonb_build_array((select saved_a_keep::text from _undo_ctx)) from public.share_jobs where id = (select job_a from _undo_ctx)), 'job payload removes only undone ID');
select pg_temp._t((select not undone and already_undone from public.undo_auto_saved_place((select saved_a from _undo_ctx))), 'undo retry is idempotent');

select pg_temp._t((select undone from public.undo_auto_saved_place((select saved_a_correct from _undo_ctx), 'corrected', (select saved_a_keep from _undo_ctx))), 'owned correction succeeds');
select pg_temp._t((select undo_action = 'corrected' and replacement_saved_place_id = (select saved_a_keep from _undo_ctx) from public.share_job_place_results where share_job_id = (select job_a_correct from _undo_ctx)), 'correction audit preserves replacement');

select pg_temp._t(public.set_saved_place_category((select saved_a_keep from _undo_ctx), 'hiking_trail'), 'owner category correction succeeds');
select pg_temp._t((select category = 'hiking_trail' and category_source = 'user' and category_user_overridden from public.saved_places where id = (select saved_a_keep from _undo_ctx)), 'user category override is durable');
select pg_temp._t(not public.set_saved_place_category((select saved_b from _undo_ctx), 'park'), 'cross-user category correction rejected');

select pg_temp._t(not has_function_privilege('anon', 'public.undo_auto_saved_place(uuid,text,uuid)', 'execute'), 'anon cannot execute undo RPC');
select pg_temp._t(not has_function_privilege('anon', 'public.set_saved_place_category(uuid,text)', 'execute'), 'anon cannot execute category RPC');
select pg_temp._t(not has_table_privilege('authenticated', 'public.share_job_place_results', 'update'), 'authenticated cannot bypass undo audit RPC');

reset role;
select pg_temp._t(exists (select 1 from public.saved_places where id = (select saved_b from _undo_ctx)), 'other user saved row survives attacks');

rollback;