-- Run only on isolated restored database after the candidate V2 migration.
-- All identities and secrets are synthetic. The outer transaction rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() foreign_a,gen_random_uuid() b,
       gen_random_uuid() foreign_b,gen_random_uuid() session_id,
       gen_random_uuid() foreign_session_id,
       md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text) secret,
       md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text) foreign_secret,
       md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text) malformed_secret
\gset
insert into auth.users(id,is_anonymous) values
  (:'a',true),(:'foreign_a',true),(:'b',false),(:'foreign_b',false);
insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle)
values (:'session_id',:'a',:'a','anonymous_active'),
       (:'foreign_session_id',:'foreign_a',:'foreign_a','anonymous_active');
select set_config('fixture.v2.session',:'session_id',true) is not null as fixture_session_set;
select set_config('fixture.v2.foreign_session',:'foreign_session_id',true) is not null as foreign_session_set;
select set_config('fixture.v2.secret',:'secret',true) is not null as fixture_secret_set;
select set_config('fixture.v2.foreign_secret',:'foreign_secret',true) is not null as foreign_secret_set;
select set_config('fixture.v2.malformed_secret',:'malformed_secret',true) is not null as malformed_secret_set;
select set_config('fixture.v2.b',:'b',true) is not null as fixture_b_set;

select 1 / case when
  not has_function_privilege('anon','public.begin_onboarding_account_transfer_v2(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.complete_onboarding_account_transfer_v2(text)','EXECUTE')
  and has_function_privilege('authenticated','public.begin_onboarding_account_transfer_v2(uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.complete_onboarding_account_transfer_v2(text)','EXECUTE')
  then 1 else 0 end as rpc_grants_assertion;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'foreign_a',true) is not null as foreign_a_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'foreign_a','is_anonymous',true)::text,true) is not null as foreign_a_jwt;
do $$
begin
  begin
    perform public.begin_onboarding_account_transfer_v2(
      current_setting('fixture.v2.session')::uuid,current_setting('fixture.v2.foreign_secret'));
    raise exception 'foreign_session_accepted';
  exception when others then
    if sqlerrm<>'onboarding_session_not_transferable' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true) is not null as a_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'a','is_anonymous',true)::text,true) is not null as a_jwt;
do $$
begin
  begin
    perform public.begin_onboarding_account_transfer_v2(
      current_setting('fixture.v2.session')::uuid,'short');
    raise exception 'weak_secret_accepted';
  exception when others then
    if sqlerrm<>'invalid_transfer_secret' then raise; end if;
  end;
end $$;
select public.begin_onboarding_account_transfer_v2(:'session_id',:'secret') grant_id
\gset
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'foreign_a',true) is not null as foreign_source_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'foreign_a','is_anonymous',true)::text,true) is not null as foreign_source_jwt;
do $$
begin
  begin
    perform public.complete_onboarding_account_transfer_v2('not-the-secret');
    raise exception 'foreign_source_completed';
  exception when others then
    if sqlerrm<>'permanent_auth_required' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt;
do $$
begin
  begin
    perform public.complete_onboarding_account_transfer_v2('not-the-secret');
    raise exception 'tampered_secret_accepted';
  exception when others then
    if sqlerrm<>'transfer_grant_not_found' then raise; end if;
  end;
end $$;
select public.complete_onboarding_account_transfer_v2(:'secret') result
\gset
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'foreign_b',true) is not null as foreign_b_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'foreign_b','is_anonymous',false)::text,true) is not null as foreign_b_jwt;
do $$
begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'foreign_destination_replay_accepted';
  exception when others then
    if sqlerrm<>'transfer_destination_mismatch' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'foreign_a',true) is not null as foreign_a_claim_2;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'foreign_a','is_anonymous',true)::text,true) is not null as foreign_a_jwt_2;
select public.begin_onboarding_account_transfer_v2(:'foreign_session_id',:'foreign_secret') expired_grant
\gset
reset role;
update public.onboarding_account_transfer_grants set expires_at=now()-interval '1 second'
 where id=:'expired_grant'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_2;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_2;
do $$
begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.foreign_secret'));
    raise exception 'expired_grant_accepted';
  exception when others then
    if sqlerrm<>'transfer_grant_not_pending' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'foreign_a',true) is not null as foreign_a_claim_3;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'foreign_a','is_anonymous',true)::text,true) is not null as foreign_a_jwt_3;
select public.begin_onboarding_account_transfer_v2(:'foreign_session_id',:'malformed_secret') malformed_grant
\gset
reset role;
update public.onboarding_account_transfer_grants
 set source_user_id=:'foreign_b' where id=:'malformed_grant'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_3;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_3;
do $$
begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.malformed_secret'));
    raise exception 'malformed_source_accepted';
  exception when others then
    if sqlerrm<>'transfer_source_not_anonymous' then raise; end if;
  end;
end $$;
reset role;

select 1 / case when
  (:'result'::jsonb->>'transferred_saved_place_count')::integer=0
  and (:'result'::jsonb->>'tutorial_saved_place_id') is null
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='completed' and destination_user_id=:'b')=1
  and (select count(*) from public.saved_places where user_id in (:'a',:'foreign_a'))=0
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'expired_grant'::uuid and status='expired')=1
  then 1 else 0 end as security_and_zero_save_assertion;
rollback;
