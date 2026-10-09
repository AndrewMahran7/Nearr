-- Synthetic ownership/merge fixtures against an isolated Production-schema
-- restore. All inserts/updates are local and the entire script rolls back.
\set ON_ERROR_STOP on
begin;
select gen_random_uuid() as user_a, gen_random_uuid() as user_b,
       gen_random_uuid() as place_unique, gen_random_uuid() as place_duplicate,
       gen_random_uuid() as place_partial,
       gen_random_uuid() as save_unique, gen_random_uuid() as save_a_duplicate,
       gen_random_uuid() as save_b_duplicate, gen_random_uuid() as save_partial
\gset

insert into auth.users(id, is_anonymous)
values (:'user_a', true), (:'user_b', false);
insert into public.places(id, name, latitude, longitude)
values (:'place_unique', 'fixture-unique', 1, 1),
       (:'place_duplicate', 'fixture-duplicate', 2, 2),
       (:'place_partial', 'fixture-partial', 3, 3);
insert into public.saved_places(id, user_id, place_id)
values (:'save_unique', :'user_a', :'place_unique'),
       (:'save_a_duplicate', :'user_a', :'place_duplicate'),
       (:'save_b_duplicate', :'user_b', :'place_duplicate'),
       (:'save_partial', :'user_a', :'place_partial');
insert into public.saved_place_sources
  (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url,is_primary)
values
  (:'save_unique', :'user_a', 'fixture:unique', 1, 'link', 'unique', 'https://example.invalid/unique', true),
  (:'save_a_duplicate', :'user_a', 'fixture:source-unique', 1, 'link', 'source-unique', 'https://example.invalid/source-unique', true),
  (:'save_a_duplicate', :'user_a', 'fixture:source-shared', 1, 'link', 'source-shared', 'https://example.invalid/source-shared', false),
  (:'save_b_duplicate', :'user_b', 'fixture:source-shared', 1, 'link', 'source-shared', 'https://example.invalid/source-shared', true),
  (:'save_partial', :'user_a', 'fixture:partial', 1, 'link', 'partial', 'https://example.invalid/partial', true);

-- The live trigger rejects a cross-owner child at creation time.
select set_config('fixture.user_b', :'user_b', true) is not null as destination_claim_set,
       set_config('fixture.save_partial', :'save_partial', true) is not null as partial_save_set;
do $$
begin
  begin
    insert into public.saved_place_sources
      (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url)
    values
      (current_setting('fixture.save_partial')::uuid,
       current_setting('fixture.user_b')::uuid,
       'fixture:invalid-owner', 1, 'link', 'invalid-owner', 'https://example.invalid/invalid-owner');
    raise exception 'owner_guard_failed_open';
  exception when others then
    if sqlerrm <> 'saved_place_source_owner_mismatch' then raise; end if;
  end;
end;
$$;

-- Unique save: parent move must be paired with every child owner move before
-- commit. The live child trigger checks the resulting parent owner.
update public.saved_places set user_id = :'user_b'
 where id = :'save_unique' and user_id = :'user_a';
update public.saved_place_sources set user_id = :'user_b'
 where saved_place_id = :'save_unique' and user_id = :'user_a';
select 'unique_save' as case_name,
       (select count(*) from public.saved_places where id=:'save_unique' and user_id=:'user_b') as destination_saves,
       (select count(*) from public.saved_place_sources where saved_place_id=:'save_unique' and user_id=:'user_b') as destination_sources;

-- Duplicate destination place: keep BOTH saved rows and their original links.
-- Materialize A's source identity missing under B as a NEW B-owned relation;
-- preserve B's existing primary and A's original source provenance. B already
-- has the other identity, so no duplicate child is created there.
insert into public.saved_place_sources
  (saved_place_id,user_id,identity_key,identity_version,platform,content_id,
   canonical_url,original_url,ai_note,is_primary,first_attached_at,last_seen_at)
select :'save_b_duplicate', :'user_b', identity_key,identity_version,platform,content_id,
       canonical_url,original_url,ai_note,false,first_attached_at,last_seen_at
  from public.saved_place_sources
 where saved_place_id = :'save_a_duplicate'
   and user_id = :'user_a'
   and identity_key = 'fixture:source-unique'
on conflict (saved_place_id, identity_key) do nothing;
select 'duplicate_place' as case_name,
       (select count(*) from public.saved_places where place_id=:'place_duplicate') as preserved_save_rows,
       (select count(*) from public.saved_place_sources where saved_place_id=:'save_b_duplicate') as destination_sources,
       (select count(*) from public.saved_place_sources where saved_place_id=:'save_a_duplicate') as preserved_source_account_sources,
       (select count(*) from public.saved_place_sources where saved_place_id=:'save_b_duplicate' and is_primary) as destination_primaries;
insert into public.saved_place_sources
  (saved_place_id,user_id,identity_key,identity_version,platform,content_id,canonical_url)
values
  (:'save_b_duplicate', :'user_b', 'fixture:source-shared', 1, 'link', 'source-shared', 'https://example.invalid/source-shared')
on conflict (saved_place_id, identity_key) do nothing;
select 'duplicate_replay' as case_name,
       (select count(*) from public.saved_place_sources
         where saved_place_id=:'save_b_duplicate' and identity_key='fixture:source-shared') as destination_same_identity_rows;
select 1 / case when
       (select count(*) from public.saved_places where id=:'save_unique' and user_id=:'user_b') = 1
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_unique' and user_id=:'user_b') = 1
   and (select count(*) from public.saved_places where place_id=:'place_duplicate') = 2
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_a_duplicate') = 2
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_b_duplicate') = 2
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_b_duplicate' and is_primary) = 1
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_b_duplicate' and identity_key='fixture:source-shared') = 1
  then 1 else 0 end as transfer_fixture_assertion;

-- Simulate an exception mid-transfer. PL/pgSQL's exception block is a
-- subtransaction: the parent owner change must roll back with it.
do $$
begin
  begin
    update public.saved_places set user_id = current_setting('fixture.user_b')::uuid
     where id = current_setting('fixture.save_partial')::uuid;
    raise exception 'injected_failure';
  exception when others then
    if sqlerrm <> 'injected_failure' then raise; end if;
  end;
end;
$$;
select 'partial_failure' as case_name,
       (select count(*) from public.saved_places where id=:'save_partial' and user_id=:'user_a') as original_owner_preserved,
       (select count(*) from public.saved_place_sources where saved_place_id=:'save_partial' and user_id=:'user_a') as original_source_preserved;
select 1 / case when
       (select count(*) from public.saved_places where id=:'save_partial' and user_id=:'user_a') = 1
   and (select count(*) from public.saved_place_sources where saved_place_id=:'save_partial' and user_id=:'user_a') = 1
  then 1 else 0 end as failure_rollback_assertion;

select 'all_fixture_links' as case_name,
       (select count(*) from public.saved_place_sources where identity_key like 'fixture:%') as links_before_outer_rollback;
rollback;
select 1 / case when
       (select count(*) from public.saved_place_sources where identity_key like 'fixture:%') = 0
  then 1 else 0 end as outer_rollback_assertion;
