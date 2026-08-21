/**
 * scripts/testShareJobDetailState.ts
 *
 * Covers the pure job -> detail-screen mapping (lib/shareJobDetailState.ts):
 * the compatibility boundary that decides what a tapped queue item shows.
 */
import assert from 'node:assert/strict';

import {
  SHARE_JOB_DETAIL_COPY,
  buildShareJobDetailState,
  type ShareJobDetailInput,
} from '../lib/shareJobDetailState';

const candidate = (googlePlaceId: string, name: string) => ({
  googlePlaceId,
  name,
  formattedAddress: `${name} Street, San Clemente, CA, USA`,
  latitude: 33.42,
  longitude: -117.61,
  types: ['restaurant'],
  matchScore: 0.8,
});

const job = (patch: Partial<ShareJobDetailInput>): ShareJobDetailInput => ({
  id: 'job-1',
  status: 'needs_help',
  decision: null,
  saved_place_id: null,
  candidate_payload: null,
  extraction_payload: null,
  suggested_query: null,
  needs_help_reason: null,
  ...patch,
});

// 1. Single candidate -> quick confirmation.
{
  const state = buildShareJobDetailState(
    job({
      decision: 'candidate_confirmation',
      candidate_payload: { candidates: [candidate('g1', 'Parlor')] },
    }),
  );
  assert.equal(state.kind, 'confirm');
  assert.equal(state.candidates.length, 1);
  assert.equal(state.copy.title, SHARE_JOB_DETAIL_COPY.confirm.title);
  assert.equal(state.reason, 'candidates_single');
}

// 2. Multiple candidates -> picker showing every persisted candidate.
{
  const state = buildShareJobDetailState(
    job({
      decision: 'candidate_picker',
      candidate_payload: {
        candidates: [candidate('g1', 'B+C Pizza'), candidate('g2', 'B+C Pizza')],
      },
    }),
  );
  assert.equal(state.kind, 'picker');
  assert.equal(state.candidates.length, 2);
  assert.equal(state.copy.title, 'We found 2 possible places');
  assert.equal(state.reason, 'candidates_multiple');
}

// 3. Zero candidates -> manual search.
{
  const state = buildShareJobDetailState(
    job({
      decision: 'manual_fallback',
      candidate_payload: { candidates: [] },
      suggested_query: 'pizza san clemente',
      failure_code: 'insufficient_evidence',
      failure_category: 'analysis_insufficient',
      analysis_attempted: true,
    }),
  );
  assert.equal(state.kind, 'manual');
  assert.equal(state.copy.title, SHARE_JOB_DETAIL_COPY.manual.title);
  assert.equal(state.suggestedQuery, 'pizza san clemente');
  assert.equal(state.reason, 'analysis_insufficient');
  assert.equal(state.canSearchManually, true);
  assert.equal(state.canRetry, false);
}

// 4. Completed + saved_place_id -> offer the existing saved place.
{
  const state = buildShareJobDetailState(
    job({
      status: 'completed',
      decision: 'auto_save',
      saved_place_id: 'saved-1',
      extraction_payload: { savedPlaceName: 'Parlor', alreadySaved: true },
      candidate_payload: { candidates: [candidate('g1', 'Parlor')], savedPlaceIds: ['saved-1'] },
    }),
  );
  assert.equal(state.kind, 'completed');
  assert.equal(state.savedPlaceId, 'saved-1');
  assert.deepEqual(state.savedPlaceIds, ['saved-1']);
  assert.equal(state.savedPlaceName, 'Parlor');
  assert.equal(state.alreadySaved, true);
  assert.equal(state.copy.title, SHARE_JOB_DETAIL_COPY.alreadySaved.title);
}

// 5. Processing -> lightweight status, never an error.
for (const status of ['queued', 'processing_metadata']) {
  const state = buildShareJobDetailState(job({ status }));
  assert.equal(state.kind, 'processing', `${status} is a processing state`);
  assert.equal(state.canRetry, false);
}

// 6. Optional payload fields missing -> still renders the candidate.
{
  const state = buildShareJobDetailState(
    job({
      candidate_payload: { candidates: [{ googlePlaceId: 'g1', name: 'Parlor' }] },
    }),
  );
  assert.equal(state.kind, 'confirm');
  assert.equal(state.candidates[0]?.formattedAddress, null);
  assert.equal(state.candidates[0]?.latitude, null);
  assert.equal(state.suggestedQuery, 'Parlor', 'falls back to the candidate name');
}

// 7. Current backend payload shape (v2: version + candidates + mentionSlots).
{
  const state = buildShareJobDetailState(
    job({
      decision: 'multi_candidate_confirmation',
      candidate_payload: {
        version: 2,
        savedPlaceIds: ['saved-1'],
        candidates: [candidate('g1', 'Parlor'), candidate('g2', 'Lunitas')],
        mentionSlots: [
          {
            mentionId: 'm1',
            displayName: 'Parlor',
            primaryVenueName: null,
            hostVenueName: null,
            relationshipType: null,
            outcome: 'verified_single',
            candidates: [candidate('g1', 'Parlor')],
          },
          {
            mentionId: 'm2',
            displayName: 'Lunitas',
            primaryVenueName: null,
            hostVenueName: null,
            relationshipType: null,
            outcome: 'ambiguous_candidates',
            candidates: [candidate('g2', 'Lunitas'), candidate('g3', 'Lunitas Pizza')],
          },
        ],
      },
    }),
  );
  assert.equal(state.kind, 'multi');
  assert.equal(state.mentionSlots.length, 2);
  assert.equal(state.copy.title, 'We found 2 places');
  assert.deepEqual(state.savedPlaceIds, ['saved-1']);
}

// 8. Malformed payloads fail safe instead of crashing.
{
  const malformed: unknown[] = [
    'not-an-object',
    42,
    [],
    { candidates: 'nope' },
    { candidates: [null, 7, {}, { name: 'no id' }, { googlePlaceId: 'g' }] },
    { mentionSlots: { not: 'an array' } },
    { version: 99, candidates: [{ googlePlaceId: 'g1', name: 'Parlor' }] },
  ];
  for (const candidate_payload of malformed) {
    const state = buildShareJobDetailState(job({ candidate_payload }));
    assert.ok(
      ['manual', 'confirm', 'picker'].includes(state.kind),
      `malformed payload degrades safely (got ${state.kind})`,
    );
  }
  assert.equal(buildShareJobDetailState(null).kind, 'missing');
  assert.equal(buildShareJobDetailState(undefined).reason, 'no_job');
  assert.equal(buildShareJobDetailState({ status: '' }).reason, 'invalid_status');
  // An unsupported payload version must not hide candidates that parse fine.
  assert.equal(
    buildShareJobDetailState(
      job({ candidate_payload: { version: 99, candidates: [{ googlePlaceId: 'g1', name: 'Parlor' }] } }),
    ).kind,
    'confirm',
  );
}

// Regression: media fallback failed AFTER metadata parked good candidates.
// The row says failed / manual_fallback, but the candidates are still there and
// must be shown rather than dropping the user into an empty manual search.
{
  const parked = { candidates: [candidate('g1', 'B+C Pizza'), candidate('g2', 'B+C Pizza')] };

  const failedWithCandidates = buildShareJobDetailState(
    job({ status: 'failed', decision: 'manual_fallback', candidate_payload: parked }),
  );
  assert.equal(failedWithCandidates.kind, 'picker', 'failed job keeps its persisted candidates');
  assert.equal(failedWithCandidates.candidates.length, 2);
  assert.equal(failedWithCandidates.canRetry, true);

  const failedNoCandidates = buildShareJobDetailState(
    job({ status: 'failed', decision: 'manual_fallback', candidate_payload: { candidates: [] } }),
  );
  assert.equal(failedNoCandidates.kind, 'manual');
  assert.equal(failedNoCandidates.canRetry, true);

  // A failure that already saved something must never offer an automatic retry.
  assert.equal(
    buildShareJobDetailState(job({ status: 'failed', saved_place_id: 'saved-1' })).canRetry,
    false,
  );
}

// Regression: candidates that only exist inside mention slots are still offered.
{
  const state = buildShareJobDetailState(
    job({
      decision: 'manual_fallback',
      candidate_payload: {
        candidates: [],
        mentionSlots: [
          {
            mentionId: 'm1',
            displayName: 'Parlor',
            primaryVenueName: null,
            hostVenueName: null,
            relationshipType: null,
            outcome: 'ambiguous_candidates',
            candidates: [candidate('g1', 'Parlor'), candidate('g2', 'Parlor Woodfire')],
          },
        ],
      },
    }),
  );
  assert.equal(state.kind, 'picker', 'slot candidates are not discarded');
  assert.equal(state.candidates.length, 2);
}

// Legacy payload shapes still open (bare array, {options}, snake_case keys).
{
  assert.equal(
    buildShareJobDetailState(job({ candidate_payload: [{ googlePlaceId: 'g1', name: 'Parlor' }] })).kind,
    'confirm',
  );
  assert.equal(
    buildShareJobDetailState(
      job({ candidate_payload: { options: [{ google_place_id: 'g1', displayName: 'Parlor' }] } }),
    ).kind,
    'confirm',
  );
  assert.equal(
    buildShareJobDetailState(job({ status: 'cancelled' })).kind,
    'dismissed',
  );
  assert.equal(
    buildShareJobDetailState(job({ status: 'some_future_status' })).kind,
    'dismissed',
    'unknown status never becomes an error screen',
  );
}

// Copy must stay consumer-facing — no internal vocabulary may leak.
{
  const forbidden = /needs_help|candidate_confirmation|candidate_picker|resolver|unresolved|weak candidate|manual_fallback/i;
  const samples: ShareJobDetailInput[] = [
    job({ candidate_payload: { candidates: [candidate('g1', 'A')] } }),
    job({ candidate_payload: { candidates: [candidate('g1', 'A'), candidate('g2', 'B')] } }),
    job({ candidate_payload: { candidates: [] } }),
    job({ status: 'completed', saved_place_id: 's1' }),
    job({ status: 'queued' }),
    job({ status: 'cancelled' }),
    job({ needs_help_reason: 'metadata_provider_permanently_closed', candidate_payload: { candidates: [candidate('g1', 'A')] } }),
  ];
  for (const sample of samples) {
    const { copy } = buildShareJobDetailState(sample);
    assert.doesNotMatch(copy.title, forbidden, `title stays consumer-facing: ${copy.title}`);
    assert.doesNotMatch(copy.body, forbidden, `body stays consumer-facing: ${copy.body}`);
  }
}

console.log('PASS share job detail state mapping');
