-- Only run against an isolated Production-schema restore with the new V2
-- migration applied. Synthetic UUIDs/content only; outer transaction rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c,
       gen_random_uuid() unique_place,gen_random_uuid() duplicate_place,
       gen_random_uuid() unique_save,gen_random_uuid() a_duplicate_save,
       gen_random_uuid() b_duplicate_save,gen_random_uuid() c_duplicate_save,
       gen_random_uuid() unique_source_1,gen_random_uuid() unique_source_2,
       gen_random_uuid() a_duplicate_source_1,gen_random_uuid() a_duplicate_source_2,
       gen_random_uuid() b_existing_source,gen_random_uuid() c_source,
       gen_random_uuid() session_id,encode(extensions.gen_random_bytes(32),'hex') secret
\gset

insert into auth.users(id,is_anonymous) values
  (:'a',true),(:'b',false),(:'c',false);
insert into public.places(id,name,latitude,longitude) values
  (:'unique_place','fixture-v2-unique',1,1),
  (:'duplicate_place','fixture-v2-duplicate',2,2);
insert into public.saved_places(id,user_id,place_id,notes) values
  (:'unique_save',:'a',:'unique_place','A unique note'),
  (:'a_duplicate_save',:'a',:'duplicate_place','A source-only note'),
  (:'b_duplicate_save',:'b',:'duplicate_place',null),
  (:'c_duplicate_save',:'c',:'duplicate_place',null);
insert into public.saved_place_sources
  (id,saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values
  (:'unique_source_1',:'unique_save',:'a','fixture-v2:unique-1',1,'link','unique-1','https://example.invalid/v2/unique-1',true),
  (:'unique_source_2',:'unique_save',:'a','fixture-v2:unique-2',1,'link','unique-2','https://example.invalid/v2/unique-2',false),
  (:'a_duplicate_source_1',:'a_duplicate_save',:'a','fixture-v2:missing',1,'link','missing','https://example.invalid/v2/missing',true),
  (:'a_duplicate_source_2',:'a_duplicate_save',:'a','fixture-v2:shared',1,'link','shared','https://example.invalid/v2/shared',false),
  (:'b_existing_source',:'b_duplicate_save',:'b','fixture-v2:shared',1,'link','shared','https://example.invalid/v2/shared',true),
  (:'c_source',:'c_duplicate_save',:'c','fixture-v2:shared',1,'link','shared','https://example.invalid/v2/shared',true);
insert into public.onboarding_v2_sessions
  (id,user_id,anonymous_user_id,lifecycle,tutorial_saved_place_id)
values (:'session_id',:'a',:'a','anonymous_active',:'unique_save');

set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true) is not null as a_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'a','is_anonymous',true)::text,true) is not null as a_jwt;
select public.begin_onboarding_account_transfer_v2(:'session_id',:'secret') grant_id
\gset
select public.begin_onboarding_account_transfer_v2(:'session_id',:'secret')=:'grant_id'::uuid
  as begin_retry_same_grant;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt;
select public.complete_onboarding_account_transfer_v2(:'secret') result
\gset
select public.complete_onboarding_account_transfer_v2(:'secret') replay_result
\gset
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'unique_save')=2
  and (select count(*) from public.saved_places where id=:'b_duplicate_save')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'b_duplicate_save')=2
  then 1 else 0 end as destination_rls_assertion;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true) is not null as a_claim_after;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'a','is_anonymous',true)::text,true) is not null as a_jwt_after;
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save')=0
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'unique_save')=0
  and (select count(*) from public.saved_places where id=:'a_duplicate_save')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'a_duplicate_save')=2
  then 1 else 0 end as source_rls_assertion;
reset role;

select 1 / case when
  (:'result'::jsonb->>'replayed')::boolean=false
  and (:'replay_result'::jsonb->>'replayed')::boolean=true
  and (:'result'::jsonb->>'transferred_saved_place_count')::integer=2
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='completed' and destination_user_id=:'b')=1
  and (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'b')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'unique_save' and user_id=:'b'
         and id in (:'unique_source_1',:'unique_source_2'))=2
  and (select count(*) from public.saved_places
       where id in (:'a_duplicate_save',:'b_duplicate_save'))=2
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'a_duplicate_save' and user_id=:'a')=2
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'b_duplicate_save' and user_id=:'b')=2
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'b_duplicate_save' and identity_key='fixture-v2:shared')=1
  and (select count(*) from public.saved_place_sources
       where id=:'b_existing_source' and saved_place_id=:'b_duplicate_save' and is_primary)=1
  and (select count(*) from public.saved_place_sources
       where id=:'c_source' and user_id=:'c')=1
  and (select notes from public.saved_places where id=:'b_duplicate_save')='A source-only note'
  and (select count(*) from public.saved_place_sources s
       join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id)=0
  and to_regprocedure('public.complete_onboarding_account_transfer(text)') is not null
  and not exists(select 1 from public.list_anonymous_onboarding_cleanup_candidates(
       interval '0 seconds',interval '0 seconds',500) where anonymous_user_id=:'a')
  then 1 else 0 end as core_v2_assertion;
rollback;

select 1 / case when (select count(*) from public.saved_place_sources
  where identity_key like 'fixture-v2:%')=0 then 1 else 0 end as fixture_rollback_assertion;
