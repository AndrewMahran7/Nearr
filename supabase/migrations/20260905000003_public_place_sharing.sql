-- Canonical Nearr place links, merge-safe public identity, and private
-- per-share attribution. `places.id` is already a random UUID shared by all
-- users, so it is the public place id; saved_places.id is never exposed.

set check_function_bodies = off;

alter table public.places
  add column if not exists merged_into_place_id uuid
    references public.places(id) on delete restrict;

alter table public.places
  drop constraint if exists places_not_merged_into_self,
  add constraint places_not_merged_into_self
    check (merged_into_place_id is null or merged_into_place_id <> id);

create index if not exists places_merged_into_idx
  on public.places (merged_into_place_id)
  where merged_into_place_id is not null;

comment on column public.places.merged_into_place_id is
  'Surviving canonical place. Merged rows remain as durable public-link aliases.';

create or replace function public.resolve_public_place_id(p_public_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_current uuid := p_public_id;
  v_next uuid;
  v_seen uuid[] := array[]::uuid[];
begin
  if v_current is null then return null; end if;

  for v_depth in 1..16 loop
    if v_current = any(v_seen) then return null; end if;
    v_seen := array_append(v_seen, v_current);

    select merged_into_place_id
      into v_next
      from public.places
     where id = v_current;
    if not found then return null; end if;
    if v_next is null then return v_current; end if;
    v_current := v_next;
  end loop;

  return null;
end;
$$;

revoke all on function public.resolve_public_place_id(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_public_place_id(uuid)
  to service_role;

create or replace function public.new_public_place_ref()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select 'r_' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
$$;

revoke all on function public.new_public_place_ref()
  from public, anon, authenticated;

create table if not exists public.public_place_shares (
  id uuid primary key default gen_random_uuid(),
  referral_id text not null unique default public.new_public_place_ref(),
  created_by uuid references auth.users(id) on delete set null,
  original_place_id uuid not null references public.places(id) on delete restrict,
  canonical_place_id uuid not null references public.places(id) on delete restrict,
  source_surface text not null default 'place_detail'
    check (source_surface ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  check (referral_id ~ '^r_[A-Za-z0-9_-]{20,64}$')
);

create index if not exists public_place_shares_creator_created_idx
  on public.public_place_shares (created_by, created_at desc);
create index if not exists public_place_shares_place_created_idx
  on public.public_place_shares (canonical_place_id, created_at desc);

alter table public.public_place_shares enable row level security;
revoke all on public.public_place_shares from public, anon, authenticated;
grant all on public.public_place_shares to service_role;

create or replace function public.create_public_place_share(
  p_place_id uuid,
  p_source_surface text default 'place_detail'
)
returns table(public_place_id uuid, referral_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_canonical uuid;
  v_ref text;
  v_surface text := lower(coalesce(nullif(trim(p_source_surface), ''), 'place_detail'));
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if v_surface !~ '^[a-z0-9_]{1,64}$' then v_surface := 'place_detail'; end if;

  v_canonical := public.resolve_public_place_id(p_place_id);
  if v_canonical is null then raise exception 'public_place_not_found'; end if;

  if not exists (
    select 1 from public.saved_places
     where user_id = v_uid and place_id in (p_place_id, v_canonical)
  ) then
    raise exception 'place_not_saved_by_sender';
  end if;

  insert into public.public_place_shares (
    created_by, original_place_id, canonical_place_id, source_surface
  ) values (v_uid, p_place_id, v_canonical, v_surface)
  returning public_place_shares.referral_id into v_ref;

  begin
    insert into public.analytics_events (
      user_id, event_name, properties, platform
    ) values (
      v_uid,
      'place_link_created',
      jsonb_build_object(
        'public_place_id', v_canonical::text,
        'referral_id', v_ref,
        'source_surface', v_surface
      ),
      'app'
    );
  exception when others then
    null;
  end;

  return query select v_canonical, v_ref;
end;
$$;

revoke all on function public.create_public_place_share(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_public_place_share(uuid, text)
  to authenticated;

create or replace function public.save_shared_place(
  p_public_id uuid,
  p_referral_id text default null
)
returns table(saved_place_id uuid, public_place_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_canonical uuid;
  v_saved_id uuid;
  v_created boolean := false;
  v_ref text := case
    when p_referral_id ~ '^r_[A-Za-z0-9_-]{20,64}$' then p_referral_id
    else null
  end;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  v_canonical := public.resolve_public_place_id(p_public_id);
  if v_canonical is null then raise exception 'public_place_not_found'; end if;

  insert into public.saved_places (
    user_id, place_id, source_type, source_url
  ) values (
    v_uid, v_canonical, 'link', null
  )
  on conflict (user_id, place_id) do nothing
  returning id into v_saved_id;

  if v_saved_id is not null then
    v_created := true;
  else
    select id into v_saved_id
      from public.saved_places
     where user_id = v_uid and place_id = v_canonical;
  end if;

  if v_saved_id is null then raise exception 'shared_place_save_failed'; end if;

  if v_created then
    begin
      insert into public.analytics_events (
        user_id, event_name, properties, platform
      ) values (
        v_uid,
        'place_saved_from_shared_link',
        jsonb_build_object(
          'public_place_id', v_canonical::text,
          'referral_id', v_ref,
          'referral_valid', exists (
            select 1 from public.public_place_shares s
             where s.referral_id = v_ref
               and public.resolve_public_place_id(s.canonical_place_id) = v_canonical
          )
        ),
        'app'
      );
    exception when others then
      null;
    end;
  end if;

  return query select v_saved_id, v_canonical, v_created;
end;
$$;

revoke all on function public.save_shared_place(uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_shared_place(uuid, text)
  to authenticated;

