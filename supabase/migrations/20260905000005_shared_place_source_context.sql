-- Preserve the public discovery behind a Nearr place share.
--
-- A saved_place_source belongs to one user and is deleted with that user's
-- save. A public share therefore keeps a small immutable snapshot of one
-- server-verified provider source. Private notes and sender identity never
-- enter the snapshot. Saving remains authoritative on the opaque referral.

set check_function_bodies = off;

alter table public.public_place_shares
  add column if not exists source_id uuid
    references public.saved_place_sources(id) on delete set null,
  add column if not exists source_identity_key text,
  add column if not exists source_identity_version integer,
  add column if not exists source_platform text,
  add column if not exists source_content_id text,
  add column if not exists source_canonical_url text,
  add column if not exists source_ai_note text,
  add column if not exists source_context_status text not null default 'none',
  add column if not exists source_context_verified_at timestamptz,
  add column if not exists source_context_revoked_at timestamptz;

alter table public.public_place_shares
  drop constraint if exists public_place_shares_source_context_shape,
  add constraint public_place_shares_source_context_shape check (
    (
      source_context_status = 'none'
      and source_identity_key is null
      and source_identity_version is null
      and source_platform is null
      and source_content_id is null
      and source_canonical_url is null
      and source_ai_note is null
      and source_context_verified_at is null
    ) or (
      source_context_status = 'public_verified'
      and source_identity_key is not null
      and source_identity_version is not null
      and source_platform in ('instagram', 'tiktok', 'facebook')
      and source_content_id is not null
      and source_canonical_url is not null
      and source_context_verified_at is not null
      and char_length(source_identity_key) between 8 and 2048
      and char_length(source_content_id) between 1 and 512
      and char_length(source_canonical_url) between 12 and 2048
      and char_length(coalesce(source_ai_note, '')) <= 1000
    )
  );

comment on column public.public_place_shares.source_id is
  'Best-effort provenance pointer. Snapshot fields survive sender save deletion.';
comment on column public.public_place_shares.source_context_status is
  'none or public_verified. Unknown/client-only sources are never propagated.';
comment on column public.public_place_shares.source_ai_note is
  'Bounded source-derived memory cue only. Never a saved_places.notes value.';

-- A source is cross-user eligible only when it has a strict provider identity
-- and a completed, server-authored recognition result for the same owner/save.
-- This prevents an authenticated client from injecting an arbitrary URL/note
-- into its own source row and laundering it through a public Nearr share.
create or replace function public.is_saved_place_source_public_shareable(
  p_source_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.saved_place_sources src
      join public.share_job_place_results result
        on result.saved_place_id = src.saved_place_id
       and result.user_id = src.user_id
       and result.outcome in ('auto_saved', 'already_saved')
      join public.share_jobs job
        on job.id = result.share_job_id
       and job.user_id = src.user_id
       and job.status = 'completed'
     where src.id = p_source_id
       and src.platform in ('instagram', 'tiktok', 'facebook')
       and src.identity_version > 0
       and src.identity_key = job.recognition_identity_key
       and src.identity_key like 'v' || src.identity_version::text || ':' || src.platform || ':%'
       and src.canonical_url ~ '^https://'
       and (
         (src.platform = 'instagram'
           and src.canonical_url ~* '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$')
         or (src.platform = 'tiktok'
           and src.canonical_url ~* '^https://(www\.)?tiktok\.com/@[^/?#]+/video/[0-9]+/?$')
         or (src.platform = 'facebook'
           and src.canonical_url ~* '^https://(www\.)?facebook\.com/reel/[0-9]+/?$')
       )
       and lower(src.canonical_url) !~ '(localhost|127\.0\.0\.1|benchmark|fixture|example\.(com|org|net))'
  );
$$;

revoke all on function public.is_saved_place_source_public_shareable(uuid)
  from public, anon, authenticated;
grant execute on function public.is_saved_place_source_public_shareable(uuid)
  to service_role;

-- Durable, private referral attribution. It is also the conversion-event
-- idempotency key, including when the recipient already owned the place.
create table if not exists public.public_place_share_saves (
  id uuid primary key default gen_random_uuid(),
  public_place_share_id uuid not null
    references public.public_place_shares(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_place_id uuid references public.saved_places(id) on delete set null,
  source_present boolean not null default false,
  ai_note_present boolean not null default false,
  created_at timestamptz not null default now(),
  unique (public_place_share_id, user_id)
);

create index if not exists public_place_share_saves_user_created_idx
  on public.public_place_share_saves (user_id, created_at desc);

alter table public.public_place_share_saves enable row level security;
revoke all on public.public_place_share_saves from public, anon, authenticated;
grant all on public.public_place_share_saves to service_role;

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
  v_saved public.saved_places%rowtype;
  v_source public.saved_place_sources%rowtype;
  v_source_note text;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if v_surface !~ '^[a-z0-9_]{1,64}$' then v_surface := 'place_detail'; end if;

  v_canonical := public.resolve_public_place_id(p_place_id);
  if v_canonical is null then raise exception 'public_place_not_found'; end if;

  select sp.* into v_saved
    from public.saved_places sp
   where sp.user_id = v_uid and sp.place_id in (p_place_id, v_canonical)
   order by (sp.place_id = p_place_id) desc, sp.created_at
   limit 1;
  if v_saved.id is null then raise exception 'place_not_saved_by_sender'; end if;

  select src.* into v_source
    from public.saved_place_sources src
   where src.saved_place_id = v_saved.id
     and src.user_id = v_uid
     and public.is_saved_place_source_public_shareable(src.id)
   order by
     (src.canonical_url = nullif(trim(v_saved.source_url), '')) desc,
     src.is_primary desc,
     src.first_attached_at,
     src.id
   limit 1;

  if v_source.id is not null then
    v_source_note := left(coalesce(
      nullif(trim(v_source.ai_note), ''),
      case when v_source.is_primary then nullif(trim(v_saved.ai_note), '') end
    ), 1000);
  end if;

  insert into public.public_place_shares (
    created_by, original_place_id, canonical_place_id, source_surface,
    source_id, source_identity_key, source_identity_version, source_platform,
    source_content_id, source_canonical_url, source_ai_note,
    source_context_status, source_context_verified_at
  ) values (
    v_uid, p_place_id, v_canonical, v_surface,
    v_source.id, v_source.identity_key, v_source.identity_version, v_source.platform,
    v_source.content_id, v_source.canonical_url, v_source_note,
    case when v_source.id is null then 'none' else 'public_verified' end,
    case when v_source.id is null then null else now() end
  )
  returning public_place_shares.referral_id into v_ref;

  begin
    insert into public.analytics_events (user_id, event_name, properties, platform)
    values (
      v_uid,
      'place_link_created',
      jsonb_build_object(
        'public_place_id', v_canonical::text,
        'referral_id', v_ref,
        'source_surface', v_surface,
        'shared_source_included', v_source.id is not null,
        'shared_ai_note_included', v_source_note is not null
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
  v_share public.public_place_shares%rowtype;
  v_source_id uuid;
  v_source_inserted boolean := false;
  v_ai_note_present boolean := false;
  v_conversion_id uuid;
  v_primary boolean := false;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  v_canonical := public.resolve_public_place_id(p_public_id);
  if v_canonical is null then raise exception 'public_place_not_found'; end if;

  if v_ref is not null then
    select share.* into v_share
      from public.public_place_shares share
     where share.referral_id = v_ref
       and public.resolve_public_place_id(share.canonical_place_id) = v_canonical
     limit 1;
  end if;

  insert into public.saved_places (user_id, place_id, source_type, source_url, ai_note)
  values (
    v_uid,
    v_canonical,
    case when v_share.source_context_status = 'public_verified'
      and v_share.source_context_revoked_at is null then v_share.source_platform else 'link' end,
    case when v_share.source_context_status = 'public_verified'
      and v_share.source_context_revoked_at is null then v_share.source_canonical_url else null end,
    case when v_share.source_context_status = 'public_verified'
      and v_share.source_context_revoked_at is null then v_share.source_ai_note else null end
  )
  on conflict (user_id, place_id) do nothing
  returning id into v_saved_id;

  if v_saved_id is not null then
    v_created := true;
  else
    select id into v_saved_id
      from public.saved_places
     where user_id = v_uid and place_id = v_canonical
     for update;
  end if;

  if v_saved_id is null then raise exception 'shared_place_save_failed'; end if;

  if v_share.id is not null
     and v_share.source_context_status = 'public_verified'
     and v_share.source_context_revoked_at is null
     and v_share.source_identity_key is not null
     and v_share.source_canonical_url is not null then
    v_primary := not exists (
      select 1 from public.saved_place_sources source_row
       where source_row.saved_place_id = v_saved_id
    );

    begin
      insert into public.saved_place_sources (
        saved_place_id, user_id, identity_key, identity_version, platform,
        content_id, canonical_url, original_url, ai_note, is_primary
      ) values (
        v_saved_id, v_uid, v_share.source_identity_key,
        v_share.source_identity_version, v_share.source_platform,
        v_share.source_content_id, v_share.source_canonical_url,
        v_share.source_canonical_url, v_share.source_ai_note, v_primary
      )
      on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do nothing
      returning id into v_source_id;
    exception when unique_violation then
      insert into public.saved_place_sources (
        saved_place_id, user_id, identity_key, identity_version, platform,
        content_id, canonical_url, original_url, ai_note, is_primary
      ) values (
        v_saved_id, v_uid, v_share.source_identity_key,
        v_share.source_identity_version, v_share.source_platform,
        v_share.source_content_id, v_share.source_canonical_url,
        v_share.source_canonical_url, v_share.source_ai_note, false
      )
      on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do nothing
      returning id into v_source_id;
    end;

    if v_source_id is not null then
      v_source_inserted := true;
    else
      update public.saved_place_sources src set
        last_seen_at = now(),
        ai_note = coalesce(src.ai_note, v_share.source_ai_note)
       where src.saved_place_id = v_saved_id
         and src.identity_key = v_share.source_identity_key
      returning src.id into v_source_id;
    end if;

    update public.saved_places sp set
      source_type = case when coalesce(trim(sp.source_url), '') = ''
        then v_share.source_platform else sp.source_type end,
      source_url = coalesce(nullif(trim(sp.source_url), ''), v_share.source_canonical_url),
      ai_note = coalesce(nullif(trim(sp.ai_note), ''), v_share.source_ai_note),
      updated_at = now()
     where sp.id = v_saved_id;

    select coalesce(trim(sp.ai_note), '') <> '' into v_ai_note_present
      from public.saved_places sp where sp.id = v_saved_id;
  end if;

  if v_share.id is not null then
    insert into public.public_place_share_saves (
      public_place_share_id, user_id, saved_place_id,
      source_present, ai_note_present
    ) values (
      v_share.id, v_uid, v_saved_id,
      v_source_id is not null, v_ai_note_present
    )
    on conflict (public_place_share_id, user_id) do nothing
    returning id into v_conversion_id;

    if v_conversion_id is not null then
      begin
        insert into public.analytics_events (user_id, event_name, properties, platform)
        values (
          v_uid,
          'place_saved_from_shared_link',
          jsonb_build_object(
            'public_place_id', v_canonical::text,
            'referral_id', v_ref,
            'referral_valid', true,
            'saved_place_created', v_created,
            'shared_source_present', v_source_id is not null,
            'shared_source_attached', v_source_inserted,
            'shared_ai_note_present', v_ai_note_present
          ),
          'app'
        );
      exception when others then
        null;
      end;
    end if;
  end if;

  return query select v_saved_id, v_canonical, v_created;
end;
$$;

revoke all on function public.save_shared_place(uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_shared_place(uuid, text)
  to authenticated;
