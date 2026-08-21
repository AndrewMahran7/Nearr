/**
 * scripts/testMediaRunDiagnostics.ts
 *
 * The persisted RECOGNITION FUNNEL
 * (supabase/functions/process-share-jobs/mediaRunDiagnostics.ts). Pure module.
 *
 * Why it exists: during the Rio audit (job 1e234bae) the model emitted six
 * places and `share_media_runs.model_output` stores only the first 500
 * characters, so places #4-#6 could not be enumerated from persisted data. The
 * parser counts existed in worker memory AND were already on the wire — they
 * were simply never written. These tests pin the funnel that fixes that.
 *
 * OBSERVABILITY ONLY. Nothing here may change recognition; the guard's own
 * behavior is pinned separately by testGeographicContextSource.ts, and this file
 * additionally asserts that the reason-returning helper agrees with the boolean
 * predicate on every case.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMediaRunDiagnostics.ts
 */

import { buildRecognitionFunnel } from '../supabase/functions/process-share-jobs/mediaRunDiagnostics';
import {
  isGeographicContextOnlySource,
  sourceGeographicContextReasonOf,
  summarizeSourceGeographicContext,
  selectRenderablePlaces,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceItem,
  PlaceEvidenceSource,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function ev(source: PlaceEvidenceSource, value: string, ts: number | null = null): PlaceEvidenceItem {
  return { source, value, timestampSeconds: ts };
}

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Test Venue',
    category: null,
    address: null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [ev('visible_text', 'Test Venue')],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return {
    places,
    multipleIntentionalPlaces: places.length > 1,
    insufficientEvidence: false,
    warnings: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. All valid — emitted 4 / valid 4 / rejected 0.
// ---------------------------------------------------------------------------

const fourPlaces = evidence([
  place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro' }),
  place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro' }),
  place({ name: 'Ipanema Beach', category: 'beach', city: 'Rio de Janeiro' }),
  place({ name: 'Maya Bay', category: 'beach', city: 'Krabi' }),
]);

const allValid = buildRecognitionFunnel(
  { analysisAttempted: true, modelPlacesEmitted: 4, modelPlacesValid: 4, modelPlacesRejected: 0 },
  fourPlaces,
  selectRenderablePlaces(fourPlaces).length,
);
check('all valid: emitted persists', allValid.modelPlacesEmitted === 4);
check('all valid: valid persists', allValid.modelPlacesValid === 4);
check('all valid: rejected persists as 0', allValid.modelPlacesRejected === 0);
check('all valid: analysis-attempted persists', allValid.analysisAttempted === true);
check('all valid: no rejection labels emitted', allValid.evidenceRejectionPaths === undefined);
check('all valid: no geographic context dropped', allValid.sourceGeographicContextDropped === 0);
check('all valid: no context labels emitted', allValid.sourceGeographicContextLabels === undefined);
check('all valid: four destination places', allValid.destinationPlaces === 4);

// ---------------------------------------------------------------------------
// 2. Partial schema rejection — emitted 4 / valid 3 / rejected 1, with a
//    bounded structural label.
// ---------------------------------------------------------------------------

const threeSurvivors = evidence([
  place({ name: 'Copacabana Beach', category: 'beach' }),
  place({ name: 'Christ the Redeemer', category: 'attraction' }),
  place({ name: 'Ipanema Beach', category: 'beach' }),
]);
const partial = buildRecognitionFunnel(
  {
    modelPlacesEmitted: 4,
    modelPlacesValid: 3,
    modelPlacesRejected: 1,
    evidenceRejectionPaths: ['places.2.inferredEvidence.0:invalid_type'],
  },
  threeSurvivors,
  selectRenderablePlaces(threeSurvivors).length,
);
check('partial: emitted 4', partial.modelPlacesEmitted === 4);
check('partial: valid 3', partial.modelPlacesValid === 3);
check('partial: rejected 1', partial.modelPlacesRejected === 1);
check(
  'partial: rejection label is the structural path+code only',
  JSON.stringify(partial.evidenceRejectionPaths) === '["places.2.inferredEvidence.0:invalid_type"]',
  JSON.stringify(partial.evidenceRejectionPaths),
);
check('partial: three destination places', partial.destinationPlaces === 3);

// ---------------------------------------------------------------------------
// 3. All rejected — counts persist, and the safe insufficient outcome the
//    parser produced is untouched by diagnostics.
// ---------------------------------------------------------------------------

const nothingSurvived = evidence([], { insufficientEvidence: true, multipleIntentionalPlaces: false });
const allRejected = buildRecognitionFunnel(
  {
    modelPlacesEmitted: 3,
    modelPlacesValid: 0,
    modelPlacesRejected: 3,
    evidenceRejectionPaths: ['places.0.name:too_small', 'places.1.confidence:too_big', 'places.2.role:invalid_enum_value'],
  },
  nothingSurvived,
  selectRenderablePlaces(nothingSurvived).length,
);
check('all rejected: emitted 3', allRejected.modelPlacesEmitted === 3);
check('all rejected: valid 0 is persisted, not omitted', allRejected.modelPlacesValid === 0);
check('all rejected: rejected 3', allRejected.modelPlacesRejected === 3);
check('all rejected: three labels', (allRejected.evidenceRejectionPaths ?? []).length === 3);
check('all rejected: zero destination places', allRejected.destinationPlaces === 0);
check(
  'all rejected: the evidence itself is untouched (still insufficient, still empty)',
  nothingSurvived.insufficientEvidence === true && nothingSurvived.places.length === 0,
);

// ---------------------------------------------------------------------------
// 4. Geographic context — the production Rio shape.
// ---------------------------------------------------------------------------

const rioReel = evidence([
  place({
    name: 'Rio de Janeiro',
    category: 'scenic_spot',
    city: 'Rio de Janeiro',
    region: 'Rio de Janeiro',
    country: 'Brazil',
    confidence: 1,
    explicitEvidence: [ev('visible_text', 'Rio de Janeiro', 1)],
  }),
  place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
]);

const rioFunnel = buildRecognitionFunnel(
  { modelPlacesEmitted: 3, modelPlacesValid: 3, modelPlacesRejected: 0 },
  rioReel,
  selectRenderablePlaces(rioReel).length,
);
check('rio: emitted 3', rioFunnel.modelPlacesEmitted === 3);
check('rio: schema rejected none', rioFunnel.modelPlacesRejected === 0);
check('rio: exactly one suppressed as source geographic context', rioFunnel.sourceGeographicContextDropped === 1);
check(
  'rio: the label names the index, the model category, and the reason',
  JSON.stringify(rioFunnel.sourceGeographicContextLabels) === '["0:scenic_spot:name_matches_city:redundant_container"]',
  JSON.stringify(rioFunnel.sourceGeographicContextLabels),
);
check('rio: two legitimate destinations still reach the resolver', rioFunnel.destinationPlaces === 2);
check(
  'rio: the funnel reconstructs without the raw preview',
  rioFunnel.modelPlacesEmitted! - rioFunnel.sourceGeographicContextDropped! === rioFunnel.destinationPlaces,
);

// ---------------------------------------------------------------------------
// 5. Backward compatibility — an older worker sends no new diagnostics.
// ---------------------------------------------------------------------------

for (const [label, bag] of [
  ['no diagnostics key at all', undefined],
  ['empty diagnostics object', {}],
  ['old-style bag with only the pre-existing fields', { resolverName: 'instagram/yt-dlp', frameCount: 10, durationMs: 33025 }],
  ['null', null],
  ['a non-object', 'nope'],
] as Array<[string, unknown]>) {
  const f = buildRecognitionFunnel(bag, rioReel, 2);
  check(`back-compat: ${label} does not throw and omits model counts`, f.modelPlacesEmitted === undefined && f.modelPlacesValid === undefined && f.modelPlacesRejected === undefined);
  check(`back-compat: ${label} still yields the edge-computed half`, f.sourceGeographicContextDropped === 1 && f.destinationPlaces === 2);
}

// Hostile / malformed values must be dropped, never persisted as-is.
const hostile = buildRecognitionFunnel(
  {
    modelPlacesEmitted: -1,
    modelPlacesValid: 1.5,
    modelPlacesRejected: 'three',
    evidenceRejectionPaths: 'not-an-array',
  },
  null,
  0,
);
check('hostile: negative count rejected', hostile.modelPlacesEmitted === undefined);
check('hostile: non-integer count rejected', hostile.modelPlacesValid === undefined);
check('hostile: non-numeric count rejected', hostile.modelPlacesRejected === undefined);
check('hostile: non-array rejection paths ignored', hostile.evidenceRejectionPaths === undefined);
check('hostile: null evidence omits the edge half entirely', hostile.sourceGeographicContextDropped === undefined && hostile.destinationPlaces === undefined);

// ---------------------------------------------------------------------------
// 6. Bounds — an oversized rejection list is truncated, not persisted whole.
// ---------------------------------------------------------------------------

const oversized = buildRecognitionFunnel(
  {
    modelPlacesEmitted: 12,
    modelPlacesValid: 0,
    modelPlacesRejected: 12,
    evidenceRejectionPaths: Array.from({ length: 200 }, (_, i) => `places.${i}.name:too_small`),
  },
  null,
  0,
);
check('bounds: rejection labels capped at 8', (oversized.evidenceRejectionPaths ?? []).length === 8);

const longLabel = buildRecognitionFunnel(
  { evidenceRejectionPaths: [`places.0.${'x'.repeat(500)}:invalid_type`, ''] },
  null,
  0,
);
check('bounds: an over-long label is truncated to 120 chars', (longLabel.evidenceRejectionPaths ?? [])[0]!.length === 120);
check('bounds: empty labels are dropped', (longLabel.evidenceRejectionPaths ?? []).length === 1);

// Context labels are bounded by the max places a payload can carry.
const manyContext = evidence(
  Array.from({ length: 12 }, (_, i) => place({ name: `City ${i}`, city: `City ${i}`, category: 'other' })),
);
const manyFunnel = buildRecognitionFunnel({}, manyContext, 0);
check('bounds: every geographic place is counted (as peers here - none contains another)', manyFunnel.peerGeographicDestinations === 12 && manyFunnel.sourceGeographicContextDropped === 0);
check('bounds: context labels capped at 12', (manyFunnel.sourceGeographicContextLabels ?? []).length === 12);

// ---------------------------------------------------------------------------
// 7. Vayrin invocation observability — counts, timestamps, selector reasons,
//    model inputs and usage survive without any raw frames or source text.
// ---------------------------------------------------------------------------

const invocation = buildRecognitionFunnel(
  {
    framesExtracted: 12,
    framesConsidered: 9,
    vayrin: {
      invoked: true,
      frameBudget: 6,
      selectedFrameCount: 6,
      selectedTimestampsSeconds: [0, 2, 4, 6, 8, 10.167],
      frameStrategy: 'diverse',
      selectionDecisions: [
        { timestampSeconds: 0, reason: 'boundary_first' },
        { timestampSeconds: 2, reason: 'temporal_stratum_farthest_hash' },
        { timestampSeconds: 10.167, reason: 'boundary_last' },
      ],
      baselineModel: 'gemini-2.5-flash',
      baselineResultClass: 'insufficient',
      baselineFrameCount: 9,
      baselineTimestampsSeconds: [0, 1, 2, 3, 4, 5, 6, 8, 10.167],
      baselineTextContextCategories: ['platform', 'caption', 'transcript'],
      model: 'gpt-5.6-sol',
      sentFrameCount: 6,
      sentTimestampsSeconds: [0, 2, 4, 6, 8, 10.167],
      latencyMs: 18420,
      usage: {
        inputTokens: 2100,
        cachedInputTokens: 500,
        outputTokens: 420,
        reasoningTokens: 180,
        totalTokens: 2520,
      },
      estimatedCostUsd: 0.02135,
    },
  },
  null,
  0,
).vayrinInvocation;
check('vayrin telemetry: invocation persisted', invocation?.invoked === true);
check('vayrin telemetry: extracted and considered remain distinct', invocation?.framesExtracted === 12 && invocation.framesConsidered === 9);
check('vayrin telemetry: selected timestamps persisted', invocation?.selectedTimestampsSeconds?.length === 6);
check('vayrin telemetry: actual transmitted frames persisted', invocation?.sentFrameCount === 6 && invocation.sentTimestampsSeconds?.length === 6);
check('vayrin telemetry: baseline model inputs persisted', invocation?.baselineFrameCount === 9 && invocation.baselineTextContextCategories?.includes('caption') === true);
check('vayrin telemetry: usage and cost persisted', invocation?.usage?.inputTokens === 2100 && invocation.estimatedCostUsd === 0.02135);
check('vayrin telemetry: selector rationale persisted', invocation?.selectionDecisions?.[1]?.reason === 'temporal_stratum_farthest_hash');

// ---------------------------------------------------------------------------
// 8. Privacy — no free-form source content may appear in any persisted value.
// ---------------------------------------------------------------------------

const secretish = evidence([
  place({
    name: 'Rio de Janeiro',
    category: 'scenic_spot',
    city: 'Rio de Janeiro',
    region: 'Rio de Janeiro',
    country: 'Brazil',
    explicitEvidence: [ev('speech', 'my phone number is 555-0100 and this is Rio de Janeiro')],
  }),
]);
const privacy = JSON.stringify(buildRecognitionFunnel({ modelPlacesEmitted: 1, modelPlacesValid: 1, modelPlacesRejected: 0 }, secretish, 0));
check('privacy: no place name in the funnel', !/Rio de Janeiro/i.test(privacy), privacy);
check('privacy: no transcript text in the funnel', !/555-0100|phone number/i.test(privacy), privacy);
check('privacy: no country/region strings in the funnel', !/Brazil/i.test(privacy), privacy);
check(
  'privacy: only closed-vocabulary labels survive',
  /"0:scenic_spot:name_matches_city:(redundant_container|peer_geographic_destination)"/.test(privacy),
  privacy,
);

// ---------------------------------------------------------------------------
// 9. The reason helper must agree with the boolean guard on every case — the
//    guard is DEFINED in terms of it, and this pins that they cannot drift.
// ---------------------------------------------------------------------------

const agreementCases: PlaceCandidateEvidence[] = [
  place({ name: 'Rio de Janeiro', city: 'Rio de Janeiro' }),
  place({ name: 'California', region: 'California' }),
  place({ name: 'Brazil', country: 'Brazil' }),
  place({ name: 'Los Angeles, California', city: 'Los Angeles', region: 'California' }),
  place({ name: 'California Pizza Kitchen', region: 'California' }),
  place({ name: 'Copacabana Beach', city: 'Rio de Janeiro' }),
  place({ name: 'Brooklyn', city: 'Brooklyn', address: '123 Bedford Ave' }),
  place({ name: 'Granada', city: null, country: null }),
  place({ name: '   ', city: 'Rio de Janeiro' }),
];
for (const p of agreementCases) {
  const reason = sourceGeographicContextReasonOf(p);
  check(
    `agreement: "${p.name.trim() || '(blank)'}" -> ${reason ?? 'destination'}`,
    isGeographicContextOnlySource(p) === (reason !== null),
  );
}

check('reason: city match reports name_matches_city', sourceGeographicContextReasonOf(place({ name: 'Rio de Janeiro', city: 'Rio de Janeiro' })) === 'name_matches_city');
check('reason: region match reports name_matches_region', sourceGeographicContextReasonOf(place({ name: 'Orange County', region: 'Orange County' })) === 'name_matches_region');
check('reason: country match reports name_matches_country', sourceGeographicContextReasonOf(place({ name: 'Brazil', country: 'Brazil' })) === 'name_matches_country');
check(
  'reason: compound match reports name_matches_compound_admin_context',
  sourceGeographicContextReasonOf(place({ name: 'Los Angeles, California', city: 'Los Angeles', region: 'California' })) === 'name_matches_compound_admin_context',
);
check(
  'reason: the narrowest field wins precedence over a compound',
  sourceGeographicContextReasonOf(place({ name: 'Rio de Janeiro', city: 'Rio de Janeiro', region: 'Rio de Janeiro' })) === 'name_matches_city',
);

check(
  'summary: a clean multi-place reel reports zero dropped and no labels',
  summarizeSourceGeographicContext(fourPlaces).dropped === 0 &&
    summarizeSourceGeographicContext(fourPlaces).labels.length === 0,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
