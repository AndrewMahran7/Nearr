import assert from 'node:assert/strict';

import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import {
  buildVayrinPresentation,
  mapShareJobToVayrinPresentation,
  mapSyncShareToVayrinPresentation,
  normalizeVayrinIdentityLeads,
} from '../lib/vayrinPresentation';

const candidate = (id: string, name: string) => ({
  googlePlaceId: id,
  name,
  formattedAddress: `${name}, Los Angeles, CA`,
  latitude: 34,
  longitude: -118,
  types: ['tourist_attraction'],
  matchScore: 0.8,
});

const job = (patch: Record<string, unknown>) => ({
  id: 'job-1', status: 'needs_help', decision: null, saved_place_id: null,
  candidate_payload: null, extraction_payload: null, suggested_query: null,
  needs_help_reason: null, failure_reason: null, created_at: '2026-08-19T12:00:00.000Z',
  ...patch,
});

const ART_VISIBLE = { hasVisibleVayrinArt: true } as const;
const FIRST_PERSON_OR_WE = /\b(?:I|I['’](?:m|ve|ll)|me|my|we|we['’]re|our|let['’]s)\b/i;

// Strong verified result.
{
  const row = job({ status: 'completed', decision: 'auto_save', saved_place_id: 's1', extraction_payload: { savedPlaceName: 'Griffith Observatory' } });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(row), row);
  assert.equal(result.kind, 'found');
  assert.equal(result.headline, 'Found it.');
}

// One uncertain candidate.
{
  const row = job({ decision: 'candidate_confirmation', candidate_payload: { candidates: [candidate('g1', 'Griffith Observatory')] } });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(row), row);
  assert.equal(result.kind, 'likely');
  assert.equal(result.headline, 'Vayrin thinks this is it.');
  assert.equal(result.secondaryAction, 'Not it');
}

// Same-scene ambiguity is leads, not multi-place.
{
  const row = job({ decision: 'candidate_picker', candidate_payload: { candidates: [candidate('g1', 'A'), candidate('g2', 'B')] } });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(row), row);
  assert.equal(result.kind, 'leads_candidates');
  assert.equal(result.headline, 'Vayrin found a few leads.');
}

// Non-Places named lead stays explicitly unverified.
const leadPayload = {
  candidates: [],
  mentionSlots: [{
    mentionId: 'm1', displayName: 'Hidden Falls', contextLabel: 'Example County', outcome: 'no_match', candidates: [],
    identityHypotheses: [{ name: 'Hidden Falls', contextLabel: 'Example County', confidence: 0.63, evidenceKind: 'observable', timestamps: [2, 8] }],
  }],
};
{
  const leads = normalizeVayrinIdentityLeads(leadPayload);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.suggestedQuery, 'Hidden Falls Example County');
  const row = job({ decision: 'manual_fallback', candidate_payload: leadPayload });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(row), row);
  assert.equal(result.kind, 'leads_unverified');
  assert.match(result.body, /not verified/i);
  assert.notEqual(result.headline, 'Found it.');
}

// Two distinct places and partial multi remain separate result classes.
{
  const fullPayload = { candidates: [candidate('g1', 'A'), candidate('g2', 'B')], mentionSlots: [
    { mentionId: 'm1', displayName: 'A', outcome: 'verified_single', candidates: [candidate('g1', 'A')] },
    { mentionId: 'm2', displayName: 'B', outcome: 'verified_single', candidates: [candidate('g2', 'B')] },
  ] };
  const full = job({ decision: 'multi_candidate_confirmation', candidate_payload: fullPayload });
  assert.equal(mapShareJobToVayrinPresentation(buildShareJobDetailState(full), full).kind, 'multi_found');

  const partialPayload = { candidates: [candidate('g1', 'A')], mentionSlots: [
    { mentionId: 'm1', displayName: 'A', outcome: 'verified_single', candidates: [candidate('g1', 'A')] },
    { mentionId: 'm2', displayName: 'Hidden Falls', outcome: 'no_match', candidates: [], identityHypotheses: leadPayload.mentionSlots[0]!.identityHypotheses },
  ] };
  const partial = job({ decision: 'multi_candidate_confirmation', candidate_payload: partialPayload });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(partial), partial);
  assert.equal(result.kind, 'multi_partial');
  assert.match(result.body, /ready to save/i);
}

// Honest no-evidence and genuine technical failure are not the same state.
{
  const empty = job({ decision: 'manual_fallback', candidate_payload: { candidates: [] } });
  assert.equal(mapShareJobToVayrinPresentation(buildShareJobDetailState(empty), empty).kind, 'no_evidence');
  const failed = job({ status: 'failed', decision: 'failed', candidate_payload: { candidates: [] } });
  assert.equal(mapShareJobToVayrinPresentation(buildShareJobDetailState(failed), failed).kind, 'technical_failure');
}

// Model-prior defense: even an inconsistent completed row cannot claim Found it.
{
  const priorPayload = { candidates: [], mentionSlots: [{
    mentionId: 'm1', displayName: 'Famous Zoo', outcome: 'no_match', candidates: [],
    identityHypotheses: [{ name: 'Famous Zoo', contextLabel: null, evidenceKind: 'model_prior', timestamps: [1] }],
  }] };
  const row = job({ status: 'completed', decision: 'auto_save', saved_place_id: 's1', candidate_payload: priorPayload });
  const result = mapShareJobToVayrinPresentation(buildShareJobDetailState(row), row);
  assert.notEqual(result.kind, 'found');
  assert.notEqual(result.headline, 'Found it.');
}

// Correction and saved handoff copy.
assert.equal(buildVayrinPresentation({ kind: 'correcting', source: 'async' }).secondaryAction, 'Search again');
assert.match(buildVayrinPresentation({ kind: 'saved', source: 'async' }).body, /Nearr has it/);

// Current production surfaces have no canonical character art. Every state
// therefore defaults to neutral or third-person language, including long
// processing and both partial-multi headline branches.
{
  const noArtStates = [
    buildVayrinPresentation({ kind: 'ready', source: 'sync' }),
    buildVayrinPresentation({ kind: 'looking', source: 'async' }),
    buildVayrinPresentation({ kind: 'looking', source: 'async', ageMs: 15_000 }),
    buildVayrinPresentation({ kind: 'found', source: 'async' }),
    buildVayrinPresentation({ kind: 'likely', source: 'async' }),
    buildVayrinPresentation({ kind: 'leads_candidates', source: 'async' }),
    buildVayrinPresentation({ kind: 'leads_unverified', source: 'async' }),
    buildVayrinPresentation({ kind: 'multi_found', source: 'async', placeCount: 3 }),
    buildVayrinPresentation({ kind: 'multi_partial', source: 'async', placeCount: 2 }),
    buildVayrinPresentation({ kind: 'multi_partial', source: 'async', placeCount: 0 }),
    buildVayrinPresentation({ kind: 'no_evidence', source: 'async' }),
    buildVayrinPresentation({ kind: 'technical_failure', source: 'async' }),
    buildVayrinPresentation({ kind: 'correcting', source: 'async' }),
    buildVayrinPresentation({ kind: 'saved', source: 'async' }),
  ];
  for (const presentation of noArtStates) {
    assert.equal(presentation.artVisible, false, `${presentation.kind} defaults to no art`);
    assert.doesNotMatch(
      `${presentation.headline} ${presentation.body}`,
      FIRST_PERSON_OR_WE,
      `${presentation.kind} no-art copy is not first person`,
    );
  }
  assert.equal(noArtStates[1]?.headline, 'Vayrin is looking…');
  assert.equal(noArtStates[3]?.headline, 'Found it.');
  assert.equal(noArtStates[4]?.headline, 'Vayrin thinks this is it.');
  assert.equal(noArtStates[5]?.headline, 'Vayrin found a few leads.');
  assert.equal(noArtStates[7]?.headline, 'Vayrin found 3 places.');
  assert.equal(noArtStates[8]?.headline, 'Vayrin found 2 places.');
}

// The future artwork ticket can enable first-person copy through one mapper
// context; current product code does not opt into it.
{
  const artStates = [
    buildVayrinPresentation({ kind: 'looking', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'found', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'likely', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'leads_candidates', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'multi_found', source: 'async', placeCount: 3 }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'multi_partial', source: 'async', placeCount: 2 }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'no_evidence', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'technical_failure', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'correcting', source: 'async' }, ART_VISIBLE),
    buildVayrinPresentation({ kind: 'saved', source: 'async' }, ART_VISIBLE),
  ];
  for (const presentation of artStates) {
    assert.equal(presentation.artVisible, true, `${presentation.kind} records visible art`);
    assert.match(
      `${presentation.headline} ${presentation.body}`,
      FIRST_PERSON_OR_WE,
      `${presentation.kind} art-visible copy may speak as Vayrin`,
    );
  }
  assert.equal(artStates[0]?.headline, "I'm looking…");
  assert.equal(artStates[2]?.headline, 'I think this is it.');
  assert.equal(artStates[3]?.headline, "I've got a few leads.");
  assert.equal(artStates[4]?.headline, 'I found 3 places.');
}

// Both route adapters preserve the same explicit artwork context.
{
  const sync = mapSyncShareToVayrinPresentation(
    { phase: 'choose', candidateCount: 1 },
    ART_VISIBLE,
  );
  assert.equal(sync.headline, 'I think this is it.');

  const row = job({ decision: 'candidate_confirmation', candidate_payload: { candidates: [candidate('g1', 'A')] } });
  const async = mapShareJobToVayrinPresentation(
    buildShareJobDetailState(row),
    row,
    Date.now(),
    ART_VISIBLE,
  );
  assert.equal(async.headline, 'I think this is it.');
}

// Equivalent domain data produces equivalent presentation regardless of route.
{
  const sync = mapSyncShareToVayrinPresentation({ phase: 'choose', candidateCount: 1 });
  const async = buildVayrinPresentation({ kind: 'likely', source: 'async' });
  assert.equal(sync?.kind, async.kind);
  assert.equal(sync?.headline, async.headline);
  assert.equal(sync?.primaryAction, async.primaryAction);
  assert.equal(sync?.secondaryAction, async.secondaryAction);
}

console.log('PASS Vayrin presentation states, safety, and sync/async equivalence');
