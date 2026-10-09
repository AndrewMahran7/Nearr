-- Isolated Production restore only. Synthetic fixtures and failpoint triggers
-- exist only inside this outer transaction, which always rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() b,
       gen_random_uuid() unique_place,gen_random_uuid() duplicate_place,
       gen_random_uuid() unique_save,gen_random_uuid() a_duplicate_save,
       gen_random_uuid() b_duplicate_save,gen_random_uuid() session_id,
       md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text) secret
\gset
insert into auth.users(id,is_anonymous) values (:'a',true),(:'b',false);
insert into public.places(id,name,latitude,longitude) values
  (:'unique_place','fixture-failure-unique',1,1),
  (:'duplicate_place','fixture-failure-duplicate',2,2);
insert into public.saved_places(id,user_id,place_id,notes) values
  (:'unique_save',:'a',:'unique_place',null),
  (:'a_duplicate_save',:'a',:'duplicate_place','A note'),
  (:'b_duplicate_save',:'b',:'duplicate_place',null);
insert into public.saved_place_sources
  (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values
  (:'unique_save',:'a','fixture-failure:unique',1,'link','unique','https://example.invalid/failure/unique',true),
  (:'a_duplicate_save',:'a','fixture-failure:missing',1,'link','missing','https://example.invalid/failure/missing',true);
insert into public.onboarding_v2_sessions(id,user_id,anonymous_user_id,lifecycle)
values (:'session_id',:'a',:'a','anonymous_active');
select set_config('fixture.v2.secret',:'secret',true) is not null as fixture_secret_set;
select set_config('fixture.v2.unique_save',:'unique_save',true) is not null as fixture_save_set;
select set_config('fixture.v2.a',:'a',true) is not null as fixture_a_set;
select set_config('fixture.v2.b',:'b',true) is not null as fixture_b_set;
select set_config('fixture.v2.b_duplicate_save',:'b_duplicate_save',true) is not null as fixture_b_save_set;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true) is not null as a_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'a','is_anonymous',true)::text,true) is not null as a_jwt;
select public.begin_onboarding_account_transfer_v2(:'session_id',:'secret') grant_id
\gset
reset role;

create function public.test_v2_failure_trigger() returns trigger
language plpgsql as $$
declare v_point text := current_setting('fixture.v2.failpoint',true);
begin
  if tg_table_name='saved_place_sources' then
    if v_point='after_parent' and tg_op='UPDATE'
       and new.identity_key='fixture-failure:unique' then
      raise exception 'injected_after_parent';
    elsif v_point='during_source_copy' and tg_op='INSERT'
       and new.identity_key='fixture-failure:missing'
       and new.saved_place_id=current_setting('fixture.v2.b_duplicate_save')::uuid then
      raise exception 'injected_source_copy';
    end if;
  elsif tg_table_name='saved_places' then
    if v_point='during_note_merge' and tg_op='UPDATE'
       and new.id=current_setting('fixture.v2.b_duplicate_save')::uuid
       and new.notes is distinct from old.notes then
      raise exception 'injected_note_merge';
    end if;
  elsif tg_table_name='onboarding_account_transfer_grants' then
    if v_point='before_grant_completion' and tg_op='UPDATE' and new.status='completed' then
      raise exception 'injected_grant_completion';
    end if;
  end if;
  return new;
end $$;
create trigger test_v2_fail_source before insert or update on public.saved_place_sources
  for each row execute function public.test_v2_failure_trigger();
create trigger test_v2_fail_save before update on public.saved_places
  for each row execute function public.test_v2_failure_trigger();
create trigger test_v2_fail_grant before update on public.onboarding_account_transfer_grants
  for each row execute function public.test_v2_failure_trigger();

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt;
select set_config('fixture.v2.failpoint','after_parent',true) is not null as parent_failpoint_set;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'after_parent_failure_not_injected';
  exception when others then
    if sqlerrm<>'injected_after_parent' then raise; end if;
  end;
end $$;
reset role;
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'a')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'unique_save' and user_id=:'a')=1
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='pending')=1
  then 1 else 0 end as after_parent_rollback_assertion;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_2;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_2;
select set_config('fixture.v2.failpoint','during_source_copy',true) is not null as copy_failpoint_set;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'source_copy_failure_not_injected';
  exception when others then
    if sqlerrm<>'injected_source_copy' then raise; end if;
  end;
end $$;
reset role;
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'a')=1
  and (select count(*) from public.saved_place_sources
       where saved_place_id=:'b_duplicate_save')=0
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='pending')=1
  then 1 else 0 end as source_copy_rollback_assertion;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_3;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_3;
select set_config('fixture.v2.failpoint','during_note_merge',true) is not null as note_failpoint_set;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'note_failure_not_injected';
  exception when others then
    if sqlerrm<>'injected_note_merge' then raise; end if;
  end;
end $$;
reset role;
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'a')=1
  and (select notes is null from public.saved_places where id=:'b_duplicate_save')
  then 1 else 0 end as note_rollback_assertion;

set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_4;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_4;
select set_config('fixture.v2.failpoint','before_grant_completion',true) is not null as grant_failpoint_set;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'grant_failure_not_injected';
  exception when others then
    if sqlerrm<>'injected_grant_completion' then raise; end if;
  end;
end $$;
reset role;
select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'a')=1
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='pending')=1
  then 1 else 0 end as grant_rollback_assertion;

-- A mismatched parent/child graph is the exact historical V1 bug shape.
savepoint historical_mismatch;
update public.saved_places set user_id=:'b' where id=:'unique_save';
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_5;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_5;
select set_config('fixture.v2.failpoint','off',true) is not null as failpoint_off;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'historical_mismatch_accepted';
  exception when others then
    if sqlerrm<>'transfer_source_owner_mismatch' then raise; end if;
  end;
end $$;
reset role;
rollback to savepoint historical_mismatch;

-- A foreign saved-place UUID in A's terminal job cannot be laundered into B.
savepoint foreign_job;
insert into public.share_jobs(user_id,source_url,status,saved_place_id)
values (:'a','https://example.invalid/failure/job','completed',:'b_duplicate_save');
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_6;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_6;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'foreign_job_accepted';
  exception when others then
    if sqlerrm<>'transfer_unresolved_dependent_graph' then raise; end if;
  end;
end $$;
reset role;
rollback to savepoint foreign_job;

-- Active queue work is a typed abort, not a partial conversion.
savepoint active_job;
insert into public.share_jobs(user_id,source_url,status)
values (:'a','https://example.invalid/failure/active','queued');
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_7;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_7;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'active_job_accepted';
  exception when others then
    if sqlerrm<>'transfer_active_work' then raise; end if;
  end;
end $$;
reset role;
rollback to savepoint active_job;

-- Duplicate metadata conflict aborts rather than overwriting B's note.
savepoint duplicate_conflict;
update public.saved_places set notes='B conflicting note' where id=:'b_duplicate_save';
set local role authenticated;
select set_config('request.jwt.claim.sub',:'b',true) is not null as b_claim_8;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',:'b','is_anonymous',false)::text,true) is not null as b_jwt_8;
do $$ begin
  begin
    perform public.complete_onboarding_account_transfer_v2(current_setting('fixture.v2.secret'));
    raise exception 'metadata_conflict_accepted';
  exception when others then
    if sqlerrm<>'transfer_duplicate_metadata_conflict' then raise; end if;
  end;
end $$;
reset role;
rollback to savepoint duplicate_conflict;

select 1 / case when
  (select count(*) from public.saved_places where id=:'unique_save' and user_id=:'a')=1
  and (select count(*) from public.saved_place_sources s
       join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id)=0
  and (select count(*) from public.onboarding_account_transfer_grants
       where id=:'grant_id'::uuid and status='pending')=1
  then 1 else 0 end as all_failure_rollbacks_assertion;
rollback;
