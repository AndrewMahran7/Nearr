-- The duplicate-transfer path intentionally retains A's historical graph.
-- A direct/stale source writer must not add a new A association *after* that
-- graph has been copied to B, or B would miss a source even though ownership
-- equality remains valid. Serialize association creation against the parent
-- lock used by V1/V2, then reject a converted anonymous source account.

create or replace function public.saved_place_sources_enforce_owner()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  select p.user_id into v_owner
    from public.saved_places p where p.id = new.saved_place_id for update;
  if v_owner is null or v_owner is distinct from new.user_id then
    raise exception 'saved_place_source_owner_mismatch';
  end if;

  if exists (
    select 1 from public.onboarding_v2_sessions s
    where s.anonymous_user_id = new.user_id
      and s.lifecycle = 'permanent_account'
      and s.permanent_user_id is not null
      and s.permanent_user_id <> s.anonymous_user_id
  ) then
    raise exception 'converted_source_account_read_only';
  end if;
  return new;
end;
$$;

drop trigger if exists saved_place_sources_owner_guard on public.saved_place_sources;
create trigger saved_place_sources_owner_guard
  before insert or update of saved_place_id, user_id, identity_key
  on public.saved_place_sources
  for each row execute function public.saved_place_sources_enforce_owner();
