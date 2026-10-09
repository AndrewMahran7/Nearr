-- Run ONLY against an isolated restore. Prints counts/booleans, never IDs.
\set ON_ERROR_STOP on
select s.id as source_link_id, s.saved_place_id, s.user_id as user_a,
       p.user_id as user_b
  from public.saved_place_sources s
  join public.saved_places p on p.id = s.saved_place_id
 where s.user_id <> p.user_id
\gset

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true) is not null as user_a_claim_set;
select 'USER_A' as actor,
       (select count(*) from public.saved_place_sources where id = :'source_link_id') as source_links_visible,
       (select count(*) from public.saved_places where id = :'saved_place_id') as saved_places_visible,
       has_table_privilege('authenticated', 'public.saved_place_sources', 'UPDATE') as can_update_source_table,
       has_table_privilege('authenticated', 'public.saved_place_sources', 'DELETE') as can_delete_source_table;
select 1 / case when
       (select count(*) from public.saved_place_sources where id = :'source_link_id') = 1
   and (select count(*) from public.saved_places where id = :'saved_place_id') = 0
   and not has_table_privilege('authenticated', 'public.saved_place_sources', 'UPDATE')
   and not has_table_privilege('authenticated', 'public.saved_place_sources', 'DELETE')
  then 1 else 0 end as user_a_assertion;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true) is not null as user_b_claim_set;
select 'USER_B' as actor,
       (select count(*) from public.saved_place_sources where id = :'source_link_id') as source_links_visible,
       (select count(*) from public.saved_places where id = :'saved_place_id') as saved_places_visible,
       has_table_privilege('authenticated', 'public.saved_place_sources', 'UPDATE') as can_update_source_table,
       has_table_privilege('authenticated', 'public.saved_place_sources', 'DELETE') as can_delete_source_table;
select 1 / case when
       (select count(*) from public.saved_place_sources where id = :'source_link_id') = 0
   and (select count(*) from public.saved_places where id = :'saved_place_id') = 1
   and not has_table_privilege('authenticated', 'public.saved_place_sources', 'UPDATE')
   and not has_table_privilege('authenticated', 'public.saved_place_sources', 'DELETE')
  then 1 else 0 end as user_b_assertion;
rollback;
