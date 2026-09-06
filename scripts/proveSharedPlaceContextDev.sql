-- Transactional Nearr-Dev proof. Every fixture write is rolled back.
begin;

do $$
declare
  v_sender constant uuid := '10000000-0000-4000-8000-000000000051';
  v_recipient constant uuid := '10000000-0000-4000-8000-000000000052';
  v_existing_user constant uuid := '10000000-0000-4000-8000-000000000053';
  v_place constant uuid := '20000000-0000-4000-8000-000000000051';
  v_alias constant uuid := '20000000-0000-4000-8000-000000000052';
  v_private_place constant uuid := '20000000-0000-4000-8000-000000000053';
  v_sender_save uuid;
  v_sender_restored uuid;
  v_recipient_save uuid;
  v_existing_save uuid;
  v_private_sender_save uuid;
  v_private_recipient_save uuid;
  v_source uuid;
  v_job uuid;
  v_ref text;
  v_private_ref text;
  v_row record;
  v_count integer;
  v_text text;
  v_created boolean;
  v_note constant text := 'The secluded turquoise swimming hole looks perfect for a summer swim.';
  v_url constant text := 'https://www.instagram.com/reel/PublicDiscovery51/';
begin
  insert into auth.users (id, aud, role, email, is_sso_user, is_anonymous)
  values
    (v_sender, 'authenticated', 'authenticated', 'shared-context-sender@invalid.nearr', false, false),
    (v_recipient, 'authenticated', 'authenticated', 'shared-context-recipient@invalid.nearr', false, false),
    (v_existing_user, 'authenticated', 'authenticated', 'shared-context-existing@invalid.nearr', false, false);

  insert into public.places (id, google_place_id, name, formatted_address, latitude, longitude)
  values
    (v_place, 'shared-context-place-51', 'Shared Context Pool', 'Dev proof only', 34.01, -118.49),
    (v_alias, 'shared-context-alias-51', 'Old Shared Context Pool', 'Dev proof only', 34.01, -118.49),
    (v_private_place, 'shared-context-private-51', 'Private Context Place', 'Dev proof only', 34.02, -118.48);
  update public.places set merged_into_place_id = v_place where id = v_alias;

  insert into public.saved_places (user_id, place_id, source_type, source_url, notes, ai_note)
  values (v_sender, v_place, 'instagram', v_url,
          'Take Sarah here for her birthday.', v_note)
  returning id into v_sender_save;

  insert into public.share_jobs (
    user_id, source_url, canonical_url, source_platform, status, decision,
    saved_place_id, recognition_identity_key, recognition_identity_version,
    recognition_content_id, completed_at
  ) values (
    v_sender, v_url, v_url, 'instagram', 'completed', 'auto_save',
    v_sender_save, 'v1:instagram:PublicDiscovery51', 1,
    'PublicDiscovery51', now()
  ) returning id into v_job;

  insert into public.share_job_place_results (
    share_job_id, user_id, logical_result_id, google_place_id, place_id,
    saved_place_id, outcome, origin, confidence_score, rule_version, finalized_at
  ) values (
    v_job, v_sender, 'proof-result', 'shared-context-place-51', v_place,
    v_sender_save, 'auto_saved', 'automatic', 0.99, 'shared-context-proof-v1', now()
  );

  insert into public.saved_place_sources (
    saved_place_id, user_id, identity_key, identity_version, platform,
    content_id, canonical_url, original_url, ai_note, is_primary
  ) values (
    v_sender_save, v_sender, 'v1:instagram:PublicDiscovery51', 1, 'instagram',
    'PublicDiscovery51', v_url, v_url, v_note, true
  ) returning id into v_source;

  if not public.is_saved_place_source_public_shareable(v_source) then
    raise exception 'verified source was not shareable';
  end if;

  perform set_config('request.jwt.claim.sub', v_sender::text, true);
  select * into v_row from public.create_public_place_share(v_alias, 'place_detail');
  v_ref := v_row.referral_id;
  if v_row.public_place_id <> v_place or v_ref is null then
    raise exception 'share did not resolve canonical alias';
  end if;

  select source_context_status, source_canonical_url, source_ai_note
    into v_row from public.public_place_shares where referral_id = v_ref;
  if v_row.source_context_status <> 'public_verified'
     or v_row.source_canonical_url <> v_url
     or v_row.source_ai_note <> v_note then
    raise exception 'share snapshot missing verified discovery';
  end if;

  -- Exact founder flow: the parent delete cascades its private child source;
  -- the share snapshot survives and restores the discovery without a job.
  delete from public.saved_places where id = v_sender_save;
  if exists (select 1 from public.saved_place_sources where id = v_source) then
    raise exception 'sender source did not cascade on delete';
  end if;
  select * into v_row from public.save_shared_place(v_alias, v_ref);
  v_sender_restored := v_row.saved_place_id;
  if not v_row.created or v_row.public_place_id <> v_place then
    raise exception 'founder save was not recreated on canonical place';
  end if;
  select notes, ai_note, source_url into v_row
    from public.saved_places where id = v_sender_restored;
  if v_row.notes is not null or v_row.ai_note <> v_note or v_row.source_url <> v_url then
    raise exception 'founder context restore failed or private note leaked';
  end if;
  select count(*) into v_count from public.saved_place_sources
   where saved_place_id = v_sender_restored
     and identity_key = 'v1:instagram:PublicDiscovery51';
  if v_count <> 1 then raise exception 'founder source count expected 1, got %', v_count; end if;

  -- Repeated save is idempotent for place, source and referral conversion.
  select * into v_row from public.save_shared_place(v_place, v_ref);
  if v_row.created or v_row.saved_place_id <> v_sender_restored then
    raise exception 'repeat founder save was not idempotent';
  end if;
  select count(*) into v_count from public.public_place_share_saves
   where user_id = v_sender and public_place_share_id = (
     select id from public.public_place_shares where referral_id = v_ref
   );
  if v_count <> 1 then raise exception 'duplicate founder referral conversion'; end if;

  -- Cross-user save receives only source-derived context.
  perform set_config('request.jwt.claim.sub', v_recipient::text, true);
  select * into v_row from public.save_shared_place(v_alias, v_ref);
  v_recipient_save := v_row.saved_place_id;
  select notes, ai_note, source_url into v_row
    from public.saved_places where id = v_recipient_save;
  if v_row.notes is not null or v_row.ai_note <> v_note or v_row.source_url <> v_url then
    raise exception 'cross-user transfer failed or sender note leaked';
  end if;
  select count(*) into v_count from public.saved_place_sources
   where saved_place_id = v_recipient_save;
  if v_count <> 1 then raise exception 'cross-user source count expected 1'; end if;

  -- Existing save keeps its private note and existing AI note while adding a
  -- distinct source child. The parent row is never duplicated or overwritten.
  insert into public.saved_places (user_id, place_id, source_type, source_url, notes, ai_note)
  values (
    v_existing_user, v_place, 'tiktok',
    'https://www.tiktok.com/@nearr/video/5100000000000000001',
    'Recipient private note', 'Recipient existing AI note'
  ) returning id into v_existing_save;
  insert into public.saved_place_sources (
    saved_place_id, user_id, identity_key, identity_version, platform,
    content_id, canonical_url, original_url, ai_note, is_primary
  ) values (
    v_existing_save, v_existing_user, 'v1:tiktok:5100000000000000001', 1, 'tiktok',
    '5100000000000000001', 'https://www.tiktok.com/@nearr/video/5100000000000000001',
    'https://www.tiktok.com/@nearr/video/5100000000000000001',
    'Recipient existing AI note', true
  );
  perform set_config('request.jwt.claim.sub', v_existing_user::text, true);
  select * into v_row from public.save_shared_place(v_place, v_ref);
  if v_row.created or v_row.saved_place_id <> v_existing_save then
    raise exception 'existing place was duplicated';
  end if;
  select notes, ai_note into v_row from public.saved_places where id = v_existing_save;
  if v_row.notes <> 'Recipient private note' or v_row.ai_note <> 'Recipient existing AI note' then
    raise exception 'existing recipient context was overwritten';
  end if;
  select count(*) into v_count from public.saved_place_sources
   where saved_place_id = v_existing_save;
  if v_count <> 2 then raise exception 'different shared source was not preserved'; end if;
  perform public.save_shared_place(v_place, v_ref);
  select count(*) into v_count from public.saved_place_sources
   where saved_place_id = v_existing_save;
  if v_count <> 2 then raise exception 'repeat existing save duplicated a source'; end if;

  -- Client-created/unknown source: no completed recognition evidence means no
  -- share context, no cross-user source, and no source-linked AI note.
  insert into public.saved_places (user_id, place_id, source_type, source_url, notes, ai_note)
  values (
    v_sender, v_private_place, 'instagram',
    'https://www.instagram.com/reel/UnknownPrivate51/',
    'Sender secret', 'Unverified source note'
  ) returning id into v_private_sender_save;
  insert into public.saved_place_sources (
    saved_place_id, user_id, identity_key, identity_version, platform,
    content_id, canonical_url, original_url, ai_note, is_primary
  ) values (
    v_private_sender_save, v_sender, 'v1:instagram:UnknownPrivate51', 1, 'instagram',
    'UnknownPrivate51', 'https://www.instagram.com/reel/UnknownPrivate51/',
    'https://www.instagram.com/reel/UnknownPrivate51/', 'Unverified source note', true
  ) returning id into v_source;
  if public.is_saved_place_source_public_shareable(v_source) then
    raise exception 'unknown/client source crossed verification boundary';
  end if;
  perform set_config('request.jwt.claim.sub', v_sender::text, true);
  select * into v_row from public.create_public_place_share(v_private_place, 'place_detail');
  v_private_ref := v_row.referral_id;
  select source_context_status into v_text from public.public_place_shares
   where referral_id = v_private_ref;
  if v_text <> 'none' then raise exception 'unknown source was snapshotted'; end if;
  perform set_config('request.jwt.claim.sub', v_recipient::text, true);
  select * into v_row from public.save_shared_place(v_private_place, v_private_ref);
  v_private_recipient_save := v_row.saved_place_id;
  if exists (select 1 from public.saved_place_sources where saved_place_id = v_private_recipient_save)
     or exists (select 1 from public.saved_places where id = v_private_recipient_save and ai_note is not null) then
    raise exception 'unknown/private context propagated';
  end if;

  -- Revocation disables future propagation from an otherwise durable share.
  update public.public_place_shares set source_context_revoked_at = now()
   where referral_id = v_ref;
  delete from public.saved_places where id = v_recipient_save;
  select * into v_row from public.save_shared_place(v_place, v_ref);
  if exists (select 1 from public.saved_place_sources where saved_place_id = v_row.saved_place_id)
     or exists (select 1 from public.saved_places where id = v_row.saved_place_id and ai_note is not null) then
    raise exception 'revoked source context propagated';
  end if;

  -- No share table is readable by public roles; no sender identity is exposed.
  if has_table_privilege('anon', 'public.public_place_shares', 'select')
     or has_table_privilege('authenticated', 'public.public_place_shares', 'select')
     or has_table_privilege('authenticated', 'public.public_place_share_saves', 'select') then
    raise exception 'private share tables expose select privilege';
  end if;

  -- The authenticated save surface accepts no arbitrary source/note argument.
  select count(*) into v_count
    from information_schema.parameters
   where specific_schema = 'public'
     and specific_name like 'save_shared_place_%'
     and parameter_name in ('p_source_url', 'p_source_id', 'p_ai_note');
  if v_count <> 0 then raise exception 'client injection parameter exists'; end if;
end;
$$;

select 'PASS transactional founder restore, cross-user privacy, existing-save multi-source merge, alias resolution, referral idempotency, unknown-source omission, and revocation' as result;

rollback;
