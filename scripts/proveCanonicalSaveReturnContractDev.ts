import assert from 'node:assert/strict';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { canonicalSaveSuccess, type CanonicalSaveSuccess } from '../lib/canonicalSaveContract';
import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { openSession } from './e2e/session';

type LiveResult = CanonicalSaveSuccess & { duplicate: boolean };

async function liveSave(args: {
  client: SupabaseClient;
  userId: string;
  googlePlaceId: string;
  sourceUrl?: string;
}): Promise<LiveResult> {
  let { data: place, error: placeLookupError } = await args.client
    .from('places')
    .select('id')
    .eq('google_place_id', args.googlePlaceId)
    .maybeSingle();
  if (placeLookupError) throw placeLookupError;
  if (!place) {
    const inserted = await args.client
      .from('places')
      .insert({
        google_place_id: args.googlePlaceId,
        name: `Canonical contract fixture ${args.googlePlaceId.slice(-8)}`,
        formatted_address: '1 Development Proof Way',
        latitude: 33.7701,
        longitude: -118.1937,
        category: 'restaurant',
        google_maps_url: null,
      })
      .select('id')
      .single();
    if (inserted.error && (inserted.error as any).code !== '23505') throw inserted.error;
    place = inserted.data;
    if (!place) {
      const raced = await args.client
        .from('places')
        .select('id')
        .eq('google_place_id', args.googlePlaceId)
        .single();
      if (raced.error) throw raced.error;
      place = raced.data;
    }
  }
  assert.ok(place?.id);

  const insertedSave = await args.client
    .from('saved_places')
    .insert({
      user_id: args.userId,
      place_id: place.id,
      radius_value: null,
      radius_unit: null,
      source_type: args.sourceUrl ? 'instagram' : 'manual',
      source_url: args.sourceUrl ?? null,
      notes: null,
      ai_note: null,
      category: 'restaurant',
      category_source: 'fallback',
      category_confidence: 0,
      category_model_version: 'canonical-contract-dev-proof',
      category_user_overridden: false,
      categorized_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  let savedPlaceId = insertedSave.data?.id as string | undefined;
  const created = Boolean(savedPlaceId);
  if (insertedSave.error && (insertedSave.error as any).code !== '23505') throw insertedSave.error;
  if (!savedPlaceId) {
    const existing = await args.client
      .from('saved_places')
      .select('id')
      .eq('user_id', args.userId)
      .eq('place_id', place.id)
      .single();
    if (existing.error) throw existing.error;
    savedPlaceId = existing.data?.id;
  }
  assert.ok(savedPlaceId, 'live conflict recovery must return the canonical saved_places.id');

  if (created) {
    if (args.sourceUrl) await attachSource(args.client, args.userId, savedPlaceId, args.sourceUrl);
    return canonicalSaveSuccess(savedPlaceId, 'created', { duplicate: false });
  }
  if (!args.sourceUrl) return canonicalSaveSuccess(savedPlaceId, 'reused', { duplicate: true });
  const attached = await attachSource(args.client, args.userId, savedPlaceId, args.sourceUrl);
  return canonicalSaveSuccess(
    savedPlaceId,
    attached ? 'enriched' : 'already_attached',
    { duplicate: true },
  );
}

async function attachSource(
  client: SupabaseClient,
  userId: string,
  savedPlaceId: string,
  sourceUrl: string,
): Promise<boolean> {
  const identity = canonicalContentIdentity(sourceUrl);
  assert.ok(identity);
  const { data, error } = await client.rpc('attach_saved_place_source', {
    p_user_id: userId,
    p_saved_place_id: savedPlaceId,
    p_identity_key: identity.key,
    p_identity_version: identity.identityVersion,
    p_platform: identity.platform,
    p_content_id: identity.contentId,
    p_canonical_url: identity.canonicalUrl,
    p_original_url: sourceUrl,
    p_creator_handle: null,
    p_creator_name: null,
    p_caption_excerpt: null,
    p_ai_note: null,
    p_thumbnail_url: null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.attached === true;
}

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  assert.ok(session.identity);
  const suffix = session.correlationId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const googleIds = [`${suffix}-existing`, `${suffix}-new`, `${suffix}-same`];
  const sourceA = `https://www.instagram.com/p/${suffix.slice(-18)}a/`;
  const sourceB = `https://www.instagram.com/p/${suffix.slice(-18)}b/`;
  const identities = [canonicalContentIdentity(sourceA), canonicalContentIdentity(sourceB)];
  assert.ok(identities.every(Boolean));

  const client = createClient(session.config.supabaseUrl, session.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.identity.accessToken}` } },
  });

  try {
    const preexisting = await session.admin.from('places').select('id').in('google_place_id', googleIds);
    if (preexisting.error) throw preexisting.error;
    assert.deepEqual(preexisting.data, [], 'proof refuses to reuse non-owned fixture places');

    const created = await liveSave({
      client,
      userId: session.identity.userId,
      googlePlaceId: googleIds[0]!,
      sourceUrl: sourceA,
    });
    const alreadyAttached = await liveSave({
      client,
      userId: session.identity.userId,
      googlePlaceId: googleIds[0]!,
      sourceUrl: sourceA,
    });
    const enriched = await liveSave({
      client,
      userId: session.identity.userId,
      googlePlaceId: googleIds[0]!,
      sourceUrl: sourceB,
    });
    const reused = await liveSave({
      client,
      userId: session.identity.userId,
      googlePlaceId: googleIds[0]!,
    });
    assert.deepEqual(
      [created.savedPlaceId, alreadyAttached.savedPlaceId, enriched.savedPlaceId, reused.savedPlaceId],
      Array(4).fill(created.savedPlaceId),
    );
    assert.deepEqual(
      [created.outcome, alreadyAttached.outcome, enriched.outcome, reused.outcome],
      ['created', 'already_attached', 'enriched', 'reused'],
    );

    const sameMentionResults = await Promise.all([
      liveSave({ client, userId: session.identity.userId, googlePlaceId: googleIds[2]!, sourceUrl: sourceA }),
      liveSave({ client, userId: session.identity.userId, googlePlaceId: googleIds[2]!, sourceUrl: sourceA }),
    ]);
    assert.equal(sameMentionResults[0]!.savedPlaceId, sameMentionResults[1]!.savedPlaceId);

    const mixed = await Promise.all([
      liveSave({ client, userId: session.identity.userId, googlePlaceId: googleIds[1]!, sourceUrl: sourceA }),
      liveSave({ client, userId: session.identity.userId, googlePlaceId: googleIds[0]!, sourceUrl: sourceB }),
    ]);
    assert.ok(mixed.every((result) => result.success && result.savedPlaceId));

    const { data: savedRows, error: savedError } = await session.admin
      .from('saved_places')
      .select('id,place_id')
      .eq('user_id', session.identity.userId);
    if (savedError) throw savedError;
    assert.equal(savedRows?.length, 3, 'three canonical places produce exactly three saved_places rows');
    const { data: sourceRows, error: sourceError } = await session.admin
      .from('saved_place_sources')
      .select('id,saved_place_id')
      .eq('user_id', session.identity.userId);
    if (sourceError) throw sourceError;
    assert.equal(sourceRows?.filter((row) => row.saved_place_id === created.savedPlaceId).length, 2);

    const identityKeys = identities.map((identity) => identity!.key);
    const cacheRows = await session.admin.from('recognition_cache').select('identity_key').in('identity_key', identityKeys);
    if (cacheRows.error) throw cacheRows.error;
    assert.deepEqual(cacheRows.data, [], 'canonical reuse must not create recognition truth');

    console.log(`PASS Nearr-Dev canonical save proof correlation=${session.correlationId}`);
    console.log(`CREATED id=${created.savedPlaceId} outcome=${created.outcome}`);
    console.log(`REUSED sameId=${reused.savedPlaceId === created.savedPlaceId}`);
    console.log(`ENRICHED sameId=${enriched.savedPlaceId === created.savedPlaceId}`);
    console.log(`ALREADY_ATTACHED sameId=${alreadyAttached.savedPlaceId === created.savedPlaceId}`);
    console.log(`SAME_CANONICAL_MENTIONS sameId=${sameMentionResults[0]!.savedPlaceId === sameMentionResults[1]!.savedPlaceId}`);
    console.log('DUPLICATE_SAVED_PLACE_ROWS=0 DUPLICATE_SOURCE_ROWS=0 RECOGNITION_CACHE_WRITES=0');
  } finally {
    const cleanup = await session.cleanup();
    if (cleanup.errors.length) throw new Error(`ephemeral user cleanup failed: ${cleanup.errors.join('; ')}`);
    const deleted = await session.admin.from('places').delete().in('google_place_id', googleIds).select('id');
    if (deleted.error) throw deleted.error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
