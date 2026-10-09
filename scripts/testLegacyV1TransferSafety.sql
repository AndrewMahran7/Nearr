-- Local restored Production-schema database only. All fixture data rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c,gen_random_uuid() p,
       gen_random_uuid() s,gen_random_uuid() child1,gen_random_uuid() child2,
       gen_random_uuid() session_id,
       md5(random()::text)||md5(random()::text) secret \gset
insert into auth.users(id,is_anonymous) values (:'a',true),(:'b',false),(:'c',false);
insert into public.places(id,name,latitude,longitude) values (:'p','v1-unique',1,1);
insert into public.saved_places(id,user_id,place_id) values (:'s',:'a',:'p');
insert into public.saved_place_sources
  (id,saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values
  (:'child1',:'s',:'a','fixture:v1-unique:1',1,'link','one','https://example.invalid/v1/one',true),
  (:'child2',:'s',:'a','fixture:v1-unique:2',1,'link','two','https://example.invalid/v1/two',false);
insert into public.onboarding_v2_sessions
  (id,user_id,anonymous_user_id,tutorial_saved_place_id,lifecycle)
values (:'session_id',:'a',:'a',:'s','anonymous_active');
set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'a','is_anonymous',true)::text,true);
select public.begin_onboarding_account_transfer(:'session_id',:'secret');
select set_config('request.jwt.claim.sub',:'b',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'b','is_anonymous',false)::text,true);
select public.complete_onboarding_account_transfer(:'secret');
select set_config('request.jwt.claim.sub',:'c',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'c','is_anonymous',false)::text,true);
select set_config('fixture.v1.secret',:'secret',true);
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer(current_setting('fixture.v1.secret'));
    raise exception 'foreign_destination_replay_accepted';
  exception when others then
    if sqlerrm<>'transfer_destination_mismatch' then raise; end if;
  end;
end $$;
reset role;
select set_config('fixture.v1.converted_a',:'a',true);
select set_config('fixture.v1.place',:'p',true);
do $$ begin
  begin
    insert into public.saved_places(user_id,place_id)
    values (current_setting('fixture.v1.converted_a')::uuid,
            current_setting('fixture.v1.place')::uuid);
    raise exception 'v1_late_anonymous_save_accepted';
  exception when others then
    if sqlerrm<>'converted_anonymous_save_read_only' then raise; end if;
  end;
end $$;
select 1 / case when
  (select count(*) from public.saved_places where id=:'s' and user_id=:'b')=1
  and (select count(*) from public.saved_place_sources
       where id in (:'child1',:'child2') and saved_place_id=:'s' and user_id=:'b')=2
  and (select count(*) from public.saved_place_sources x join public.saved_places p
       on p.id=x.saved_place_id where x.user_id<>p.user_id)=0
  then 1 else 0 end as v1_unique_owner_assertion;

select gen_random_uuid() a2,gen_random_uuid() b2,gen_random_uuid() p2,
       gen_random_uuid() sa2,gen_random_uuid() sb2,
       gen_random_uuid() ca2,gen_random_uuid() ca3,gen_random_uuid() cb2,gen_random_uuid() session2,
       md5(random()::text)||md5(random()::text) secret2 \gset
insert into auth.users(id,is_anonymous) values (:'a2',true),(:'b2',false);
insert into public.places(id,name,latitude,longitude) values (:'p2','v1-duplicate',2,2);
insert into public.saved_places(id,user_id,place_id,source_url,source_type,notes)
values (:'sa2',:'a2',:'p2','https://example.invalid/v1/a','link','anonymous note'),
       (:'sb2',:'b2',:'p2',null,'manual','destination note');
insert into public.saved_place_sources
  (id,saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values (:'ca2',:'sa2',:'a2','fixture:v1-duplicate:a',1,'link','a','https://example.invalid/v1/a',true),
       (:'ca3',:'sa2',:'a2','fixture:v1-duplicate:b',1,'link','b','https://example.invalid/v1/b',false),
       (:'cb2',:'sb2',:'b2','fixture:v1-duplicate:b',1,'link','b','https://example.invalid/v1/b',true);
insert into public.onboarding_v2_sessions
  (id,user_id,anonymous_user_id,tutorial_saved_place_id,lifecycle)
values (:'session2',:'a2',:'a2',:'sa2','anonymous_active');
set local role authenticated;
select set_config('request.jwt.claim.sub',:'a2',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'a2','is_anonymous',true)::text,true);
select public.begin_onboarding_account_transfer(:'session2',:'secret2');
select set_config('request.jwt.claim.sub',:'b2',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'b2','is_anonymous',false)::text,true);
select public.complete_onboarding_account_transfer(:'secret2');
select 1 / case when (public.complete_onboarding_account_transfer(:'secret2')->>'replayed')::boolean
  then 1 else 0 end as v1_replay_assertion;
reset role;
select 1 / case when
  (select count(*) from public.saved_places where id=:'sa2' and user_id=:'a2')=1
  and (select count(*) from public.saved_place_sources where id in (:'ca2',:'ca3') and saved_place_id=:'sa2' and user_id=:'a2')=2
  and (select count(*) from public.saved_place_sources where saved_place_id=:'sb2' and user_id=:'b2')=2
  and (select count(*) from public.saved_place_sources where id=:'cb2' and saved_place_id=:'sb2' and is_primary)=1
  and (select notes from public.saved_places where id=:'sb2')='destination note'
  and (select source_url from public.saved_places where id=:'sb2')='https://example.invalid/v1/a'
  and not exists(select 1 from public.list_anonymous_onboarding_cleanup_candidates(
    interval '0 seconds',interval '0 seconds',500) where anonymous_user_id=:'a2')
  and (select count(*) from public.saved_place_sources x join public.saved_places p
       on p.id=x.saved_place_id where x.user_id<>p.user_id)=0
  then 1 else 0 end as v1_duplicate_preservation_assertion;
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b2',true);
select 1 / case when
  (select count(*) from public.saved_places where id=:'sb2')=1
  and (select count(*) from public.saved_place_sources where saved_place_id=:'sb2')=2
  and (select count(*) from public.saved_place_sources where saved_place_id=:'sa2')=0
  then 1 else 0 end as v1_destination_rls_assertion;
select set_config('request.jwt.claim.sub',:'a2',true);
select 1 / case when
  (select count(*) from public.saved_places where id=:'sa2')=1
  and (select count(*) from public.saved_place_sources where saved_place_id=:'sa2')=2
  and (select count(*) from public.saved_place_sources where saved_place_id=:'sb2')=0
  then 1 else 0 end as v1_source_rls_assertion;
reset role;
rollback;
