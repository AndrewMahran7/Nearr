/**
 * scripts/testMediaAdversarialEvidence.ts
 *
 * Adversarial tests for the media auto-save eligibility gate
 * (mediaEvidenceAutoSaveEligible) and the renderable-place selection. Proves
 * that NONE of the mission's adversarial inputs can make media evidence
 * eligible for a SILENT auto-save. The deterministic resolver + Google Places +
 * safeToAutoSave remain the ultimate authority; this gate only makes media
 * auto-save STRICTER (requires an explicit high-confidence street address).
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testMediaAdversarialEvidence.ts
 */

import {
  mediaEvidenceAutoSaveEligible,
  selectRenderablePlaces,
  renderMediaEvidenceCaption,
  type MediaPlaceEvidence,
  type PlaceCandidateEvidence,
  type PlaceEvidenceItem,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function ev(source: PlaceEvidenceItem['source'], value: string, ts: number | null = 1): PlaceEvidenceItem {
  return { timestampSeconds: ts, source, value };
}

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Some Place',
    category: null,
    address: null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return { places, multipleIntentionalPlaces: false, insufficientEvidence: false, warnings: [], ...over };
}

// A concrete, explicit, high-confidence street address — the ONLY thing that
// should be eligible for a silent media auto-save.
const strongAddressPlace = place({
  name: 'Capones Cucina',
  address: '19688 Beach Blvd',
  city: 'Huntington Beach',
  region: 'CA',
  confidence: 0.9,
  explicitEvidence: [ev('visible_text', '19688 BEACH BLVD'), ev('visible_text', 'CAPONES CUCINA')],
});

// ---- POSITIVE control ------------------------------------------------------
check('explicit high-confidence street address => eligible', mediaEvidenceAutoSaveEligible(evidence([strongAddressPlace])) === true);

// ---- Adversarial: none of these may be eligible ----------------------------

// inferred-only
check(
  'inferred-only place => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ address: '19688 Beach Blvd', inferredEvidence: [ev('frame', '19688 Beach Blvd')], explicitEvidence: [] })])),
);

// passing mention (even with an address)
check(
  'passing_mention => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ role: 'passing_mention', address: '19688 Beach Blvd', explicitEvidence: [ev('speech', '19688 Beach Blvd')] })])),
);

// creator username / handle (name only)
check(
  'creator handle name only => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: '@foodie_travels', explicitEvidence: [ev('caption', '@foodie_travels')] })])),
);

// dish / product name (no address)
check(
  'dish name => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Margherita Pizza', explicitEvidence: [ev('visible_text', 'Margherita Pizza')] })])),
);

// cuisine name
check(
  'cuisine name => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Neapolitan Pizza', explicitEvidence: [ev('speech', 'best neapolitan pizza') ] })])),
);

// neighborhood / city as travel context (city only, no street)
check(
  'city-as-context (no street) => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Brooklyn', city: 'Brooklyn', region: 'NY', explicitEvidence: [ev('speech', 'we flew into Brooklyn') ] })])),
);

// unrelated subtitle text
check(
  'unrelated subtitle => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Subscribe Now', explicitEvidence: [ev('visible_text', 'Subscribe Now for more') ] })])),
);

// platform UI text
check(
  'platform UI text => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Follow', explicitEvidence: [ev('visible_text', 'Follow  •  Share  •  Save') ] })])),
);

// low-confidence visible text (HAS an address but below threshold)
check(
  'low-confidence explicit address => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ ...strongAddressPlace, confidence: 0.4 })])),
);

// low-confidence speech
check(
  'low-confidence speech address => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'X', address: '123 Main St', confidence: 0.3, explicitEvidence: [ev('speech', '123 Main St') ] })])),
);

// multiple intentional places => confirmation, never silent save
check(
  'multiple intentional places => NOT eligible',
  !mediaEvidenceAutoSaveEligible(
    evidence(
      [strongAddressPlace, place({ name: 'Second Spot', address: '500 Second St', explicitEvidence: [ev('visible_text', '500 Second St')] })],
      { multipleIntentionalPlaces: true },
    ),
  ),
);

// conflicting names for the same location (two primaries) — the second is not
// eligible because multipleIntentionalPlaces is false so only the first counts;
// but if they conflict we still require the primary to hold an explicit address
check(
  'conflicting name without explicit address => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Maybe Diner or Cafe', explicitEvidence: [ev('speech', 'is it the diner or the cafe') ] })])),
);

// model-supplied coordinates must never influence eligibility
check(
  'model coordinates ignored (name-only + coords) => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([place({ name: 'Mystery Spot', coordinates: { lat: 36.9, lng: -122.0 }, explicitEvidence: [ev('speech', 'the mystery spot') ] })])),
);

// insufficientEvidence flag
check(
  'insufficientEvidence flag => NOT eligible',
  !mediaEvidenceAutoSaveEligible(evidence([strongAddressPlace], { insufficientEvidence: true })),
);

// empty
check('no places => NOT eligible', !mediaEvidenceAutoSaveEligible(evidence([])));

// ---- selectRenderablePlaces safety filtering -------------------------------
{
  const r = selectRenderablePlaces(evidence([
    place({ name: 'Primary', explicitEvidence: [ev('visible_text', 'Primary Sign')] }),
    place({ name: 'PassingMention', role: 'passing_mention', explicitEvidence: [ev('speech', 'passed by PassingMention')] }),
    place({ name: 'InferredOnly', inferredEvidence: [ev('frame', 'maybe a place')], explicitEvidence: [] }),
  ]));
  check('selectRenderablePlaces keeps only explicit non-passing primary', r.length === 1 && r[0]!.name === 'Primary');
}

// The rendered caption for an ineligible name-only place still produces a query
// (so the resolver can try + require confirmation) but is NOT auto-save eligible.
{
  const e = evidence([place({ name: 'Loaded Cafe', explicitEvidence: [ev('visible_text', 'Loaded Cafe')] })]);
  const rendered = renderMediaEvidenceCaption(e);
  check('name-only renders a query', rendered.renderedPlaces === 1 && /Loaded Cafe/.test(rendered.title));
  check('name-only NOT auto-save eligible', !mediaEvidenceAutoSaveEligible(e));
}

console.log(failures === 0 ? '\nALL MEDIA ADVERSARIAL EVIDENCE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
