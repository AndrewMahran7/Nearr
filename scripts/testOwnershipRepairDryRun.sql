-- Local-only dry run against an isolated Production restore. The outer
-- transaction ALWAYS rolls back. No identifiers or source URLs are printed.
\set ON_ERROR_STOP on
select s.id as source_link_id, s.saved_place_id, s.user_id as user_a,
       p.user_id as user_b, s.identity_key as source_identity
  from public.saved_place_sources s
  join public.saved_places p on p.id = s.saved_place_id
 where s.user_id <> p.user_id
\gset

begin;
select count(*) as preexisting_mismatches
  from public.saved_place_sources s
  join public.saved_places p on p.id = s.saved_place_id
 where s.user_id <> p.user_id;

select id from public.saved_places where id = :'saved_place_id' for update \gset
select id from public.saved_place_sources where id = :'source_link_id' for update \gset

with repaired as (
  update public.saved_place_sources s
     set user_id = :'user_b'
   where s.id = :'source_link_id'
     and s.saved_place_id = :'saved_place_id'
     and s.user_id = :'user_a'
     and exists (select 1 from public.saved_places p
                  where p.id = s.saved_place_id and p.user_id = :'user_b')
  returning 1
)
select count(*) as repaired_rows from repaired;

with replay as (
  update public.saved_place_sources s
     set user_id = :'user_b'
   where s.id = :'source_link_id'
     and s.saved_place_id = :'saved_place_id'
     and s.user_id = :'user_a'
  returning 1
)
select count(*) as replayed_rows from replay;

select count(*) as remaining_mismatches
  from public.saved_place_sources s
  join public.saved_places p on p.id = s.saved_place_id
 where s.user_id <> p.user_id;
select count(*) as relationship_rows_after_repair
  from public.saved_place_sources where id = :'source_link_id';
select count(*) as same_identity_other_user_rows_after_repair
  from public.saved_place_sources
 where identity_key = :'source_identity' and id <> :'source_link_id';
select 1 / case when
       (select count(*) from public.saved_place_sources where id=:'source_link_id' and user_id=:'user_b') = 1
   and (select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id) = 0
   and (select count(*) from public.saved_place_sources where identity_key=:'source_identity' and id<>:'source_link_id') = 4
  then 1 else 0 end as repair_assertion;

savepoint rls_a;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true) is not null as user_a_claim_set;
select 'USER_A' as actor,
       (select count(*) from public.saved_place_sources where id = :'source_link_id') as source_links_visible,
       (select count(*) from public.saved_places where id = :'saved_place_id') as saved_places_visible;
select 1 / case when
       (select count(*) from public.saved_place_sources where id=:'source_link_id') = 0
   and (select count(*) from public.saved_places where id=:'saved_place_id') = 0
  then 1 else 0 end as repaired_user_a_assertion;
rollback to savepoint rls_a;

savepoint rls_b;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true) is not null as user_b_claim_set;
select 'USER_B' as actor,
       (select count(*) from public.saved_place_sources where id = :'source_link_id') as source_links_visible,
       (select count(*) from public.saved_places where id = :'saved_place_id') as saved_places_visible;
select 1 / case when
       (select count(*) from public.saved_place_sources where id=:'source_link_id') = 1
   and (select count(*) from public.saved_places where id=:'saved_place_id') = 1
  then 1 else 0 end as repaired_user_b_assertion;
rollback to savepoint rls_b;

rollback;
select count(*) as mismatch_restored_after_rollback
  from public.saved_place_sources s
  join public.saved_places p on p.id = s.saved_place_id
 where s.user_id <> p.user_id;
select 1 / case when
       (select count(*) from public.saved_place_sources s join public.saved_places p on p.id=s.saved_place_id where s.user_id<>p.user_id) = 1
  then 1 else 0 end as rollback_assertion;
