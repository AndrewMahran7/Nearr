/**
 * scripts/testMediaEvidenceAdapter.ts
 *
 * Unit tests for the Phase 2 evidence adapter
 * (supabase/functions/process-share-jobs/mediaEvidence.ts). Pure module.
 *
 * Proves: schema validation + normalization; the fabrication guard (inferred-
 * only + passing-mention places are never rendered); primary/secondary/passing
 * role handling; multi-place rendering; coordinates never forwarded; malformed
 * payloads degrade safely to "insufficient".
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMediaEvidenceAdapter.ts
 */

import {
  parseMediaEvidence,
  renderMediaEvidenceCaption,
  hasExplicitEvidence,
  type MediaPlaceEvidence,
  type PlaceCandidateEvidence,
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

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Capones Cucina',
    category: 'restaurant',
    address: '19688 Beach Blvd',
    city: 'Huntington Beach',
    region: 'CA',
    country: 'USA',
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [{ timestampSeconds: 3.2, source: 'visible_text', value: '19688 BEACH BLVD' }],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return {
    places: [place()],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
    ...over,
  };
}

// ---- parseMediaEvidence ----------------------------------------------------

{
  const r = parseMediaEvidence(null);
  check('parse null => not ok', !r.ok && r.error === 'evidence_not_object');
}
{
  const r = parseMediaEvidence('nope' as unknown);
  check('parse string => not ok', !r.ok);
}
{
  const r = parseMediaEvidence({});
  check('parse empty object => ok, empty places, insufficient false', r.ok && r.value.places.length === 0);
}
{
  const r = parseMediaEvidence({
    places: [{ name: 'X', role: 'primary', explicitEvidence: [{ source: 'speech', value: 'we are at X', timestampSeconds: 1 }] }],
    multipleIntentionalPlaces: true,
    insufficientEvidence: false,
    warnings: ['low_light'],
  });
  check('parse valid => places=1, multiple=true', r.ok && r.value.places.length === 1 && r.value.multipleIntentionalPlaces);
  check('parse warnings preserved', r.ok && r.value.warnings[0] === 'low_light');
}
{
  // Malformed entries are dropped, not fatal.
  const r = parseMediaEvidence({
    places: [
      { name: '', explicitEvidence: [] }, // no name -> dropped
      { name: 'Valid', explicitEvidence: [{ source: 'bogus', value: 'x' }] }, // bad source dropped -> 0 explicit
      { name: 'Valid2', explicitEvidence: [{ source: 'frame', value: 'Sign' }] },
      123, // not an object -> dropped
    ],
  });
  check('parse drops malformed places (name required)', r.ok && r.value.places.length === 2);
  check('parse drops evidence with invalid source', r.ok && r.value.places[0].explicitEvidence.length === 0);
}
{
  // Confidence is clamped to 0..1.
  const r = parseMediaEvidence({ places: [{ name: 'X', confidence: 9, explicitEvidence: [{ source: 'speech', value: 'x' }] }] });
  check('confidence clamped to <= 1', r.ok && r.value.places[0].confidence === 1);
  const r2 = parseMediaEvidence({ places: [{ name: 'X', confidence: -4, explicitEvidence: [{ source: 'speech', value: 'x' }] }] });
  check('confidence clamped to >= 0', r2.ok && r2.value.places[0].confidence === 0);
}
{
  // Coordinates are never trusted from the payload.
  const r = parseMediaEvidence({ places: [{ name: 'X', coordinates: { lat: 1, lng: 2 }, explicitEvidence: [{ source: 'speech', value: 'x' }] }] });
  check('coordinates never forwarded from model', r.ok && r.value.places[0].coordinates === null);
}

// ---- hasExplicitEvidence ---------------------------------------------------

{
  check('hasExplicitEvidence true when explicit present', hasExplicitEvidence(place()));
  check('hasExplicitEvidence false when only inferred', !hasExplicitEvidence(place({ explicitEvidence: [], inferredEvidence: [{ source: 'frame', value: 'guess', timestampSeconds: null }] })));
}

// ---- renderMediaEvidenceCaption --------------------------------------------

{
  const r = renderMediaEvidenceCaption(evidence());
  check('render single explicit place => 1 place', r.renderedPlaces === 1);
  check('render title = primary name', r.title === 'Capones Cucina');
  check('render description contains address + city', /19688 Beach Blvd/.test(r.description) && /Huntington Beach/.test(r.description));
}
{
  // Fabrication guard: inferred-only place is NOT rendered.
  const r = renderMediaEvidenceCaption(evidence({
    places: [place({ explicitEvidence: [], inferredEvidence: [{ source: 'frame', value: 'maybe a diner', timestampSeconds: null }] })],
  }));
  check('inferred-only place => rendered 0 (no fabrication)', r.renderedPlaces === 0 && r.title === '' && r.description === '');
}
{
  // insufficientEvidence short-circuits.
  const r = renderMediaEvidenceCaption(evidence({ insufficientEvidence: true }));
  check('insufficientEvidence => rendered 0', r.renderedPlaces === 0);
}
{
  // Passing mentions never rendered.
  const r = renderMediaEvidenceCaption(evidence({
    places: [
      place({ name: 'Main Spot', role: 'primary' }),
      place({ name: 'Just Passing', role: 'passing_mention' }),
    ],
  }));
  check('passing_mention excluded', r.renderedPlaces === 1 && r.title === 'Main Spot');
}
{
  // Secondary place only rendered when multipleIntentionalPlaces = true.
  const twoPlaces = [
    place({ name: 'First Place', role: 'primary', address: '1 A St' }),
    place({ name: 'Second Place', role: 'secondary', address: '2 B St' }),
  ];
  const single = renderMediaEvidenceCaption(evidence({ places: twoPlaces, multipleIntentionalPlaces: false }));
  check('secondary dropped when not multi-intent', single.renderedPlaces === 1 && single.title === 'First Place');
  const multi = renderMediaEvidenceCaption(evidence({ places: twoPlaces, multipleIntentionalPlaces: true }));
  check('secondary kept when multi-intent', multi.renderedPlaces === 2);
  check('multi description has both places on separate lines', multi.description.split('\n').length === 2);
}
{
  // Primary is ordered first even if listed later.
  const r = renderMediaEvidenceCaption(evidence({
    multipleIntentionalPlaces: true,
    places: [
      place({ name: 'Secondary One', role: 'secondary' }),
      place({ name: 'The Primary', role: 'primary' }),
    ],
  }));
  check('primary ordered first', r.title === 'The Primary');
}
{
  // Empty evidence => nothing rendered (safe manual fallback signal).
  const r = renderMediaEvidenceCaption(evidence({ places: [] }));
  check('no places => rendered 0', r.renderedPlaces === 0);
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\nALL MEDIA EVIDENCE ADAPTER TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
