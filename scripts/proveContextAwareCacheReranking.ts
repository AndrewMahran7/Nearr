import assert from 'node:assert/strict';

import { RECOGNITION_VERSION, canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { submitShareJob } from './e2e/fixtures/shared';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';

type Row = Record<string, any>;

const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';
const URL = 'https://www.youtube.com/watch?v=CacheQA82426';
const identity = canonicalContentIdentity(URL)!;
const terminal = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

const place = (
  googlePlaceId: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
  retrievalRank: number,
) => ({
  googlePlaceId,
  name: 'In-N-Out Burger',
  formattedAddress,
  latitude,
  longitude,
  types: ['restaurant', 'food'],
  primaryType: 'restaurant',
  matchScore: 80,
  retrievalRank,
  contextReason: 'exact_source_evidence',
  contextLabel: 'Santa Paula, CA, USA',
});

const candidates = [
  place('cache-qa-tx-frisco', '2800 Preston Rd, Frisco, TX, USA', 33.10, -96.81, 1),
  place('cache-qa-tx-houston', '7611 Cypress Creek Pkwy, Houston, TX, USA', 29.98, -95.54, 2),
  place('cache-qa-ca-sacramento', '2001 Alta Arden Expy, Sacramento, CA, USA', 38.60, -121.42, 3),
  place('cache-qa-ca-ventura', '2070 Harbor Blvd, Ventura, CA, USA', 34.27, -119.27, 4),
  place('cache-qa-ca-oxnard', '381 W Esplanade Dr, Oxnard, CA, USA', 34.24, -119.18, 5),
];

const candidatePayload = {
  version: 2,
  selectionMode: 'single_identity',
  recognitionContext: {
    locality: 'Santa Paula',
    region: 'CA',
    country: 'USA',
    coordinates: { lat: 34.3542, lng: -119.0593 },
    confidence: 'exact',
    sourceKind: 'exact_source_evidence',
  },
  candidates,
  mentionSlots: [{
    mentionId: 'mention-in-n-out',
    displayName: 'In-N-Out',
    contextLabel: 'Santa Paula, CA, USA',
    primaryVenueName: 'In-N-Out',
    hostVenueName: null,
    relationshipType: null,
    outcome: 'ambiguous_candidates',
    candidates,
    sourceTimestamps: [18],
  }],
};

async function main(): Promise<void> {
  assert.ok(identity, 'fixture must have a canonical identity');
  const session = await openSession({ withIdentity: true });
  assert.equal(session.config.supabaseRef, TARGET_REF, 'proof may only run against Nearr-Dev');
  let ownsCacheRow = false;
  try {
    const { data: existing, error: existingError } = await session.admin
      .from('recognition_cache')
      .select('identity_key')
      .eq('identity_key', identity.key)
      .maybeSingle();
    if (existingError) throw existingError;
    assert.equal(existing, null, 'proof refuses to overwrite a pre-existing cache row');

    const { error: insertError } = await session.admin.from('recognition_cache').insert({
      identity_key: identity.key,
      platform: identity.platform,
      content_id: identity.contentId,
      canonical_url: identity.canonicalUrl,
      identity_version: identity.identityVersion,
      recognition_version: RECOGNITION_VERSION,
      result_type: 'candidate_set',
      trust_level: 'CANDIDATE_SET',
      canonical_place_id: null,
      candidate_payload: candidatePayload,
      evidence_summary: { fixture: 'context_aware_cache_reranking' },
    });
    if (insertError) throw insertError;
    ownsCacheRow = true;

    const startedAt = new Date().toISOString();
    const submitted = await submitShareJob(session, 'context-aware-cache-reranking', URL);
    if (!submitted.ok) throw new Error(submitted.detail);
    const polled = await pollUntil<Row>(
      async () => {
        const { data, error } = await session.admin
          .from('share_jobs')
          .select('id,status,decision,needs_help_reason,candidate_payload,extraction_payload,recognition_identity_key,last_error')
          .eq('id', submitted.jobId)
          .maybeSingle();
        if (error) throw error;
        return data as Row | null;
      },
      (row) => terminal.has(String(row.status)),
      { timeoutMs: 120_000, intervalMs: 1_000 },
    );
    if (!polled.ok) throw new Error(`cache proof job did not terminate: ${JSON.stringify(polled.last)}`);
    const job = polled.value;
    assert.equal(job.status, 'needs_help');
    assert.equal(job.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(job.extraction_payload?.recognitionCache?.trust, 'CANDIDATE_SET');
    assert.equal(job.extraction_payload?.recognitionCache?.contextualRerankApplied, true);
    assert.equal(job.extraction_payload?.recognitionCache?.placesCallCount, 0);
    const visible = Array.isArray(job.candidate_payload?.candidates)
      ? job.candidate_payload.candidates as Row[]
      : [];
    assert.deepEqual(visible.map((candidate) => candidate.googlePlaceId), [
      'cache-qa-ca-ventura',
      'cache-qa-ca-oxnard',
    ]);
    assert.ok(visible.length <= 3);
    assert.equal(visible.some((candidate) => /\bTX\b/.test(String(candidate.formattedAddress))), false);

    const [tasks, runs, events, retained] = await Promise.all([
      session.admin.from('share_media_tasks').select('id').eq('share_job_id', job.id),
      session.admin.from('share_agent_runs').select('id').eq('user_id', session.identity!.userId).gte('created_at', startedAt),
      session.admin.from('recognition_cache_events').select('*')
        .eq('identity_key', identity.key)
        .eq('event_name', 'recognition_cache_candidate_hit')
        .gte('created_at', startedAt),
      session.admin.from('recognition_cache').select('candidate_payload').eq('identity_key', identity.key).single(),
    ]);
    for (const result of [tasks, runs, events, retained]) {
      if (result.error) throw result.error;
    }
    assert.equal((tasks.data ?? []).length, 0, 'cache hit must create no primary/media work');
    assert.equal((runs.data ?? []).length, 0, 'cache hit must create no recognition agent/model work');
    assert.ok(retained.data, 'cache row must remain after presentation reranking');
    const retainedCandidateCount = retained.data.candidate_payload.candidates.length;
    assert.equal(retainedCandidateCount, 5,
      'top-three presentation must not truncate the canonical cache set');
    const event = (events.data ?? [])[0] as Row | undefined;
    assert.ok(event, 'candidate cache hit telemetry must exist');
    assert.equal(event.detail?.contextualRerankApplied, true);
    assert.equal(event.detail?.candidateCountBeforeRerank, 5);
    assert.equal(event.detail?.candidateCountAfterRerank, 2);
    assert.equal(event.detail?.placesCallCount, 0);

    console.log(`DEV_CACHE_RERANK_PROOF ${JSON.stringify({
      target: session.config.supabaseRef,
      jobId: job.id,
      identityKey: identity.key,
      cacheHit: true,
      cacheTrust: 'CANDIDATE_SET',
      contextualRerank: 1,
      topCandidates: visible.map((candidate) => candidate.googlePlaceId),
      texasTop: false,
      visibleCount: visible.length,
      primaryAcquisitionCalls: 0,
      scrapeCreatorsCalls: 0,
      geminiCalls: 0,
      solCalls: 0,
      transcriptionCalls: 0,
      frameExtractionCalls: 0,
      placesCalls: 0,
      cachedCandidateCountRetained: retainedCandidateCount,
    })}`);
  } finally {
    const cleanup = await session.cleanup();
    const errors = [...cleanup.errors];
    if (ownsCacheRow) {
      for (const table of ['recognition_cache_events', 'recognition_inflight', 'recognition_cache'] as const) {
        const { error } = await session.admin.from(table).delete().eq('identity_key', identity.key);
        if (error) errors.push(`${table}: ${error.message}`);
      }
    }
    console.log(`DEV_CACHE_RERANK_CLEANUP ${JSON.stringify({ userDeleted: cleanup.userDeleted, errors })}`);
    if (errors.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
