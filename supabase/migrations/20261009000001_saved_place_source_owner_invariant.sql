-- A source association belongs to exactly the current owner of its saved place.
-- A child-only trigger cannot protect a concurrent or legacy parent owner move.
-- The referenced composite key makes that owner change a key update: PostgreSQL
-- either cascades every committed child owner or rejects a stale child insert.
-- Existing single-column FKs and the child owner guard remain in place.

do $$
begin
  if exists (
    select 1 from public.saved_place_sources s
    join public.saved_places p on p.id = s.saved_place_id
    where s.user_id is distinct from p.user_id
  ) then
    raise exception 'saved_place_source_owner_mismatch_prevents_migration';
  end if;
end;
$$;

alter table public.saved_places
  add constraint saved_places_id_user_id_key unique (id, user_id);

alter table public.saved_place_sources
  add constraint saved_place_sources_owner_fk
  foreign key (saved_place_id, user_id)
  references public.saved_places (id, user_id)
  on update cascade on delete cascade;
