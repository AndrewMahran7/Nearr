-- Local restored Production-schema database only. Manual/client and worker
-- source-attachment contracts; all synthetic fixture data rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() place_id,
       gen_random_uuid() save_id,gen_random_uuid() worker_save \gset
insert into auth.users(id,is_anonymous) values (:'a',true),(:'b',false);
insert into public.places(id,name,latitude,longitude) values
  (:'place_id','client-attach-fixture',1,1);
insert into public.saved_places(id,user_id,place_id,source_type)
values (:'save_id',:'a',:'place_id','manual');
set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'a','is_anonymous',true)::text,true);
select * from public.attach_saved_place_source(
  :'a',:'save_id','fixture:manual-attach',1,'link','manual',
  'https://example.invalid/manual');
select 1 / case when (select count(*) from public.saved_place_sources
  where saved_place_id=:'save_id' and user_id=:'a' and identity_key='fixture:manual-attach')=1
  then 1 else 0 end as manual_attach_assertion;
reset role;

-- Legacy parent-only ownership move must cascade the existing association.
update public.saved_places set user_id=:'b' where id=:'save_id';
select set_config('fixture.attach.a',:'a',true);
select set_config('fixture.attach.save',:'save_id',true);
set local role authenticated;
select set_config('request.jwt.claim.sub',:'a',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'a','is_anonymous',true)::text,true);
do $$ begin
  begin
    perform public.attach_saved_place_source(
      current_setting('fixture.attach.a')::uuid,
      current_setting('fixture.attach.save')::uuid,
      'fixture:stale-client',1,'link','stale','https://example.invalid/stale');
    raise exception 'stale_client_attachment_accepted';
  exception when others then
    if sqlerrm<>'saved_place_not_owned' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub',:'b',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',:'b','is_anonymous',false)::text,true);
select * from public.attach_saved_place_source(
  :'b',:'save_id','fixture:manual-after-transfer',1,'link','after',
  'https://example.invalid/after');
reset role;

-- The recognition/worker caller uses service_role with no end-user JWT.
insert into public.saved_places(id,user_id,place_id,source_type)
values (:'worker_save',:'a',:'place_id','link');
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select * from public.attach_saved_place_source(
  :'a',:'worker_save','fixture:worker-attach',1,'link','worker',
  'https://example.invalid/worker');
reset role;
select 1 / case when
  (select count(*) from public.saved_place_sources where saved_place_id=:'save_id' and user_id=:'b')=2
  and (select count(*) from public.saved_place_sources where saved_place_id=:'worker_save' and user_id=:'a')=1
  and (select count(*) from public.saved_place_sources s join public.saved_places p
       on p.id=s.saved_place_id where s.user_id<>p.user_id)=0
  then 1 else 0 end as manual_and_worker_contract_assertion;
rollback;
