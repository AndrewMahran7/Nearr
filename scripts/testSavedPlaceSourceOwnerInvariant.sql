-- Local restored Production-schema database only. Fixture transaction rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() p,
       gen_random_uuid() p2,gen_random_uuid() sa,gen_random_uuid() sb,
       gen_random_uuid() source_id \gset
insert into auth.users(id,is_anonymous) values (:'a',true),(:'b',false);
insert into public.places(id,name,latitude,longitude) values
  (:'p','invariant-primary',1,1),(:'p2','invariant-other',2,2);
insert into public.saved_places(id,user_id,place_id) values
  (:'sa',:'a',:'p'),(:'sb',:'a',:'p2');
insert into public.saved_place_sources
  (id,saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values (:'source_id',:'sa',:'a','fixture:invariant',1,'link','source',
        'https://example.invalid/invariant',true);
create temp table fixture_source_hash on commit drop as
  select md5((to_jsonb(s)-'user_id'-'updated_at')::text) h
  from public.saved_place_sources s where s.id=:'source_id';
select set_config('fixture.owner.save',:'sa',true);
select set_config('fixture.owner.wrong',:'b',true);
select set_config('fixture.owner.source',:'source_id',true);

-- A direct privileged stale-owner insert cannot commit.
do $$ begin
  begin
    insert into public.saved_place_sources
      (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url)
    values (current_setting('fixture.owner.save')::uuid,
            current_setting('fixture.owner.wrong')::uuid,
            'fixture:wrong',1,'link','wrong','https://example.invalid/wrong');
    raise exception 'wrong_owner_insert_accepted';
  exception when others then
    if sqlerrm not in ('saved_place_source_owner_mismatch','insert or update on table "saved_place_sources" violates foreign key constraint "saved_place_sources_owner_fk"') then raise; end if;
  end;
end $$;

-- Prove the declarative FK, not merely the older user trigger, is the final
-- defense. Disable only that user trigger inside this rollback-only fixture.
alter table public.saved_place_sources disable trigger saved_place_sources_owner_guard;
do $$ begin
  begin
    insert into public.saved_place_sources
      (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url)
    values (current_setting('fixture.owner.save')::uuid,
            current_setting('fixture.owner.wrong')::uuid,
            'fixture:fk-alone',1,'link','wrong','https://example.invalid/fk-alone');
    raise exception 'composite_fk_did_not_reject_wrong_owner';
  exception when foreign_key_violation then null;
  end;
end $$;
alter table public.saved_place_sources enable trigger saved_place_sources_owner_guard;

-- Parent-only owner changes, including legacy V1's old shape, cascade the
-- redundant child owner without changing child IDs or canonical identity.
update public.saved_places set user_id=:'b' where id=:'sa';
select 1 / case when
  (select count(*) from public.saved_place_sources
    where id=:'source_id' and saved_place_id=:'sa' and user_id=:'b'
      and identity_key='fixture:invariant')=1
  and (select md5((to_jsonb(s)-'user_id'-'updated_at')::text)
       from public.saved_place_sources s where id=:'source_id')
      =(select h from fixture_source_hash)
  and (select count(*) from public.saved_place_sources s
    join public.saved_places p on p.id=s.saved_place_id
    where s.user_id<>p.user_id)=0 then 1 else 0 end as parent_cascade_assertion;

select set_config('fixture.owner.save',:'sa',true);
select set_config('fixture.owner.wrong',:'a',true);
do $$ begin
  begin
    insert into public.saved_place_sources
      (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url)
    values (current_setting('fixture.owner.save')::uuid,
            current_setting('fixture.owner.wrong')::uuid,
            'fixture:stale',1,'link','stale','https://example.invalid/stale');
    raise exception 'stale_owner_insert_accepted';
  exception when others then
    if sqlerrm not in ('saved_place_source_owner_mismatch','insert or update on table "saved_place_sources" violates foreign key constraint "saved_place_sources_owner_fk"') then raise; end if;
  end;
end $$;
do $$ begin
  begin
    update public.saved_place_sources set user_id=current_setting('fixture.owner.wrong')::uuid
     where id=current_setting('fixture.owner.source')::uuid;
    raise exception 'stale_owner_update_accepted';
  exception when others then
    if sqlerrm not in ('saved_place_source_owner_mismatch','insert or update on table "saved_place_sources" violates foreign key constraint "saved_place_sources_owner_fk"') then raise; end if;
  end;
end $$;

-- Valid reattachment to a save owned by A changes both relationship keys.
update public.saved_place_sources set saved_place_id=:'sb',user_id=:'a'
 where id=:'source_id';
select 1 / case when
  (select count(*) from public.saved_place_sources
    where id=:'source_id' and saved_place_id=:'sb' and user_id=:'a')=1
  and (select count(*) from public.saved_place_sources s
    join public.saved_places p on p.id=s.saved_place_id
    where s.user_id<>p.user_id)=0 then 1 else 0 end as reattachment_assertion;

select 1 / case when exists (
  select 1 from pg_constraint where conrelid='public.saved_place_sources'::regclass
    and conname='saved_place_sources_owner_fk' and contype='f' and convalidated
    and pg_get_constraintdef(oid) like '%ON UPDATE CASCADE%'
) then 1 else 0 end as validated_fk_assertion;
delete from public.saved_places where id=:'sb';
select 1 / case when
  not exists(select 1 from public.saved_place_sources where id=:'source_id')
  and (select count(*) from public.saved_place_sources s
       left join public.saved_places p on p.id=s.saved_place_id where p.id is null)=0
  then 1 else 0 end as parent_delete_cascade_assertion;
rollback;
