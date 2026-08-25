import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

import { rankContextAwareCandidates } from '../lib/contextAwarePlacesResolution';
import { RECOGNITION_VERSION, canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';

type Row = Record<string, any>;

const TARGET_REF = 'rlqvxdwtetxsqxhqztkw';
const TARGET_URL = `https://${TARGET_REF}.supabase.co`;
const RAILWAY = {
  project: '4037a3b5-d66f-409e-b734-56c22c244e3e',
  environment: '49650a9c-4744-4649-8cd1-4ff38473d22f',
  service: '59234570-e2ec-4a7e-86de-22826da86c66',
} as const;
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

function runJson(command: string, args: string[]): any {
  const result = spawnSync(command, args, {
    encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed: ${(result.stderr || '').trim().slice(0, 300)}`);
  }
  return JSON.parse((result.stdout || '').replace(/^\uFEFF/, ''));
}

function productionConfig() {
  assert.equal(
    process.env.NEARR_PRODUCTION_QA_CONFIRM,
    TARGET_REF,
    `refusing production writes without NEARR_PRODUCTION_QA_CONFIRM=${TARGET_REF}`,
  );
  const railway = runJson('railway', [
    'variables', '--json', '--project', RAILWAY.project,
    '--environment', RAILWAY.environment, '--service', RAILWAY.service,
  ]);
  assert.equal(String(railway.SUPABASE_URL || '').replace(/\/+$/, ''), TARGET_URL);
  assert.ok(railway.SUPABASE_SERVICE_ROLE_KEY, 'production service role key is absent');
  assert.ok(railway.GOOGLE_PLACES_KEY, 'production Places key is absent');
  const apiKeys = runJson('npx', [
    'supabase', 'projects', 'api-keys', '--project-ref', TARGET_REF, '--output', 'json',
  ]);
  const functions = runJson('npx', [
    'supabase', 'functions', 'list', '--project-ref', TARGET_REF, '--output', 'json',
  ]) as Row[];
  const worker = functions.find((fn) => fn.slug === 'process-share-jobs' && fn.status === 'ACTIVE');
  assert.ok(worker, 'production process-share-jobs deployment is not active');
  const anonKey = (apiKeys as Row[]).find((key) => key.name === 'anon')?.api_key
    ?? (apiKeys as Row[]).find((key) => key.type === 'publishable')?.api_key;
  assert.ok(anonKey, 'production publishable/anon key is absent');
  return {
    anonKey: String(anonKey).trim(),
    serviceRoleKey: String(railway.SUPABASE_SERVICE_ROLE_KEY).trim(),
    placesKey: String(railway.GOOGLE_PLACES_KEY).trim(),
    workerVersion: Number(worker.version),
    workerSha256: String(worker.ezbr_sha256),
  };
}

function videoFixture(label: string) {
  const contentId = randomBytes(9).toString('base64url').slice(0, 11);
  const url = `https://www.youtube.com/watch?v=${contentId}`;
  const identity = canonicalContentIdentity(url);
  assert.ok(identity, `${label} must have a canonical identity`);
  return { label, url, identity };
}

function candidate(googlePlaceId: string, formattedAddress: string, latitude: number, longitude: number, retrievalRank: number) {
  return {
    googlePlaceId, name: 'In-N-Out Burger', formattedAddress, latitude, longitude,
    types: ['restaurant', 'food'], primaryType: 'restaurant', retrievalRank,
    contextReason: 'exact_source_evidence', contextLabel: 'Santa Paula, CA, USA',
  };
}

async function pollJob(admin: any, jobId: string): Promise<Row> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('share_jobs')
      .select('id,status,decision,saved_place_id,candidate_payload,extraction_payload,recognition_identity_key,last_error')
      .eq('id', jobId).maybeSingle();
    if (error) throw error;
    if (data && TERMINAL.has(String(data.status))) return data as Row;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`production QA job ${jobId} did not reach terminal state`);
}

async function submit(url: string, anonKey: string, accessToken: string, label: string): Promise<string> {
  const response = await fetch(`${TARGET_URL}/functions/v1/create-share-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, clientRequestId: `nearr-production-qa:${label}:${randomUUID()}` }),
  });
  const body = await response.json().catch(() => ({})) as Row;
  assert.equal(response.status, 200, `create-share-job failed (${response.status})`);
  assert.ok(body.jobId, 'create-share-job returned no job id');
  return String(body.jobId);
}

async function manualChipotleProof(placesKey: string) {
  const ventura = { lat: 34.2805, lng: -119.2945 };
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': placesKey,
      'X-Goog-FieldMask': [
        'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
        'places.types', 'places.primaryType', 'places.businessStatus',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: 'Chipotle',
      maxResultCount: 12,
      locationBias: { circle: { center: { latitude: ventura.lat, longitude: ventura.lng }, radius: 50_000 } },
    }),
  });
  assert.equal(response.status, 200, 'production Places Text Search HTTP failure');
  const json = await response.json() as Row;
  const candidates = ((json.places ?? []) as Row[]).slice(0, 12).map((place) => ({
    googlePlaceId: String(place.id), name: String(place.displayName?.text || ''),
    formattedAddress: String(place.formattedAddress || ''),
    latitude: Number(place.location?.latitude), longitude: Number(place.location?.longitude),
    types: Array.isArray(place.types) ? place.types.map(String) : [],
    primaryType: typeof place.primaryType === 'string' ? place.primaryType : null,
    businessStatus: typeof place.businessStatus === 'string' ? place.businessStatus : null,
  }));
  const ranked = rankContextAwareCandidates({
    query: 'Chipotle', candidates,
    context: { mode: 'manual', userLocation: ventura, regionConfidence: 'none' },
    placesCallCount: 1,
  });
  assert.ok(ranked.visible.length > 0, 'manual Chipotle search returned no visible candidates');
  const top = ranked.visible[0];
  assert.equal(top.metadata.contextReason, 'user_proximity');
  assert.ok((top.metadata.distanceKm ?? Infinity) < 25, 'manual Chipotle top result is not near Ventura');
  return {
    topGooglePlaceId: top.candidate.googlePlaceId, topAddress: top.candidate.formattedAddress,
    distanceKm: top.metadata.distanceKm, placesCalls: 1,
  };
}

async function main() {
  const config = productionConfig();
  const admin = createClient(TARGET_URL, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(TARGET_URL, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const correlation = `nearr-production-qa-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
  const email = `${correlation}@nearr.invalid`;
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const fixtures = [videoFixture('candidate-rerank'), videoFixture('user-confirmed')];
  const keys = fixtures.map((fixture) => fixture.identity.key);
  let userId = '';
  const jobIds: string[] = [];
  const cleanupErrors: string[] = [];

  try {
    const { data: preexisting, error: preexistingError } = await admin.from('recognition_cache').select('identity_key').in('identity_key', keys);
    if (preexistingError) throw preexistingError;
    assert.deepEqual(preexisting, [], 'production QA refuses to overwrite existing recognition cache rows');

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { purpose: 'context_aware_cache_reranking_production_qa', correlation },
    });
    if (createError || !created.user) throw createError ?? new Error('ephemeral user creation failed');
    userId = created.user.id;
    const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError ?? new Error('ephemeral sign-in failed');

    const places = [
      candidate('prod-qa-tx-frisco', '2800 Preston Rd, Frisco, TX, USA', 33.10, -96.81, 1),
      candidate('prod-qa-tx-houston', '7611 Cypress Creek Pkwy, Houston, TX, USA', 29.98, -95.54, 2),
      candidate('prod-qa-ca-sacramento', '2001 Alta Arden Expy, Sacramento, CA, USA', 38.60, -121.42, 3),
      candidate('prod-qa-ca-ventura', '2070 Harbor Blvd, Ventura, CA, USA', 34.27, -119.27, 4),
      candidate('prod-qa-ca-oxnard', '381 W Esplanade Dr, Oxnard, CA, USA', 34.24, -119.18, 5),
    ];
    const candidatePayload = {
      version: 2, selectionMode: 'single_identity',
      recognitionContext: {
        locality: 'Santa Paula', region: 'CA', country: 'USA', coordinates: { lat: 34.3542, lng: -119.0593 },
        confidence: 'exact', sourceKind: 'exact_source_evidence',
      },
      candidates: places,
      mentionSlots: [{
        mentionId: 'mention-in-n-out', displayName: 'In-N-Out', contextLabel: 'Santa Paula, CA, USA',
        outcome: 'ambiguous_candidates', candidates: places, sourceTimestamps: [18],
      }],
    };
    const candidateFixture = fixtures[0];
    const { error: candidateInsertError } = await admin.from('recognition_cache').insert({
      identity_key: candidateFixture.identity.key, platform: candidateFixture.identity.platform,
      content_id: candidateFixture.identity.contentId, canonical_url: candidateFixture.identity.canonicalUrl,
      identity_version: candidateFixture.identity.identityVersion, recognition_version: RECOGNITION_VERSION,
      result_type: 'candidate_set', trust_level: 'CANDIDATE_SET', canonical_place_id: null,
      candidate_payload: candidatePayload, evidence_summary: { fixture: correlation },
    });
    if (candidateInsertError) throw candidateInsertError;

    const { data: trustedPlace, error: trustedPlaceError } = await admin.from('places')
      .select('id,google_place_id,name,formatted_address,latitude,longitude')
      .not('google_place_id', 'is', null).not('formatted_address', 'is', null).limit(1).single();
    if (trustedPlaceError || !trustedPlace) throw trustedPlaceError ?? new Error('no trusted place fixture exists');
    const trustedFixture = fixtures[1];
    const { error: trustedInsertError } = await admin.from('recognition_cache').insert({
      identity_key: trustedFixture.identity.key, platform: trustedFixture.identity.platform,
      content_id: trustedFixture.identity.contentId, canonical_url: trustedFixture.identity.canonicalUrl,
      identity_version: trustedFixture.identity.identityVersion, recognition_version: 'production-qa-intentionally-stale',
      result_type: 'verified_place', trust_level: 'USER_CONFIRMED', canonical_place_id: trustedPlace.id,
      candidate_payload: null, evidence_summary: { fixture: correlation },
    });
    if (trustedInsertError) throw trustedInsertError;

    const startedAt = new Date().toISOString();
    const candidateJobId = await submit(candidateFixture.url, config.anonKey, signedIn.session.access_token, candidateFixture.label);
    jobIds.push(candidateJobId);
    const candidateJob = await pollJob(admin, candidateJobId);
    assert.equal(candidateJob.status, 'needs_help');
    assert.equal(candidateJob.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(candidateJob.extraction_payload?.recognitionCache?.trust, 'CANDIDATE_SET');
    assert.equal(candidateJob.extraction_payload?.recognitionCache?.contextualRerankApplied, true);
    assert.equal(candidateJob.extraction_payload?.recognitionCache?.placesCallCount, 0);
    const visible = candidateJob.candidate_payload?.candidates as Row[];
    assert.deepEqual(visible.map((item) => item.googlePlaceId), ['prod-qa-ca-ventura', 'prod-qa-ca-oxnard']);

    const trustedJobId = await submit(trustedFixture.url, config.anonKey, signedIn.session.access_token, trustedFixture.label);
    jobIds.push(trustedJobId);
    const trustedJob = await pollJob(admin, trustedJobId);
    assert.equal(trustedJob.status, 'completed');
    assert.equal(trustedJob.decision, 'auto_save');
    assert.equal(trustedJob.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(trustedJob.extraction_payload?.recognitionCache?.trust, 'USER_CONFIRMED');
    assert.ok(trustedJob.saved_place_id);

    const [tasks, runs, retained, events] = await Promise.all([
      admin.from('share_media_tasks').select('id').in('share_job_id', jobIds),
      admin.from('share_agent_runs').select('id').eq('user_id', userId).gte('created_at', startedAt),
      admin.from('recognition_cache').select('candidate_payload').eq('identity_key', candidateFixture.identity.key).single(),
      admin.from('recognition_cache_events').select('event_name,detail').in('identity_key', keys).gte('created_at', startedAt),
    ]);
    for (const result of [tasks, runs, retained, events]) if (result.error) throw result.error;
    assert.equal((tasks.data ?? []).length, 0);
    assert.equal((runs.data ?? []).length, 0);
    assert.ok(retained.data, 'candidate cache row must remain after presentation reranking');
    assert.equal(retained.data.candidate_payload.candidates.length, 5);
    const candidateEvent = (events.data as Row[]).find((event) => event.event_name === 'recognition_cache_candidate_hit');
    assert.equal(candidateEvent?.detail?.candidateCountBeforeRerank, 5);
    assert.equal(candidateEvent?.detail?.candidateCountAfterRerank, 2);
    assert.equal(candidateEvent?.detail?.placesCallCount, 0);

    const chipotle = await manualChipotleProof(config.placesKey);
    console.log(`PRODUCTION_CACHE_RERANK_PROOF ${JSON.stringify({
      target: TARGET_REF, workerVersion: config.workerVersion, workerSha256: config.workerSha256,
      candidateJobId, trustedJobId, staleOrderChanged: true,
      topCandidates: visible.map((item) => item.googlePlaceId), texasTop: false,
      cachedCandidateCountRetained: 5, candidateCacheTrust: 'CANDIDATE_SET', trustedCacheTrust: 'USER_CONFIRMED',
      trustedRecognitionVersionCurrentRequired: false,
      cacheHitProviderCalls: { primary: 0, scrapeCreators: 0, gemini: 0, sol: 0, transcription: 0, frames: 0, places: 0 },
      manualChipotle: chipotle,
    })}`);
  } finally {
    for (const table of ['share_media_runs', 'share_agent_runs', 'share_extraction_failures'] as const) {
      if (!jobIds.length) break;
      const { error } = await admin.from(table).delete().in('share_job_id', jobIds);
      if (error && !/column .* does not exist/i.test(error.message)) cleanupErrors.push(`${table}: ${error.message}`);
    }
    for (const table of ['recognition_cache_events', 'recognition_inflight', 'recognition_cache'] as const) {
      const { error } = await admin.from(table).delete().in('identity_key', keys);
      if (error) cleanupErrors.push(`${table}: ${error.message}`);
    }
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupErrors.push(`auth user: ${error.message}`);
    }
    console.log(`PRODUCTION_CACHE_RERANK_CLEANUP ${JSON.stringify({
      userDeleted: !!userId && !cleanupErrors.some((error) => error.startsWith('auth user:')), errors: cleanupErrors,
    })}`);
    if (cleanupErrors.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
