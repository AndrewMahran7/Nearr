// Fault-isolating evidence validation.
//
// The production failure this pins (frozen 20-share cohort, jobs d4e64093 /
// e7dde60b / 1a5c9273): validation was all-or-nothing, so ONE malformed field
// anywhere collapsed the whole response to
// emptyEvidence(['evidence_schema_invalid']). Gemini had named real places
// ("Christ the Redeemer", Rio de Janeiro, confidence 1.0, explicit frame
// evidence) and the parser erased every one of them, producing a manual
// fallback from a good extraction.
//
// The rule is salvage, NOT permissiveness: each surviving place must still pass
// the complete strict schema. Malformed units are rejected, never coerced into
// looking valid. Half of this file is therefore negative cases.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEvidenceWithDiagnostics,
  safeParseEvidence,
} from '../src/types/evidence.js';

/** A minimal place that passes the full strict schema. */
function validPlace(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    category: 'attraction',
    categoryConfidence: 0.9,
    categoryEvidenceTags: ['frame_statue'],
    address: null,
    city: 'Rio de Janeiro',
    region: 'Rio de Janeiro',
    country: 'Brazil',
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [{ timestampSeconds: 1, source: 'frame', value: `${name} visible in frame` }],
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
    ...extra,
  };
}

const envelope = (places: unknown[], extra: Record<string, unknown> = {}) => ({
  places,
  multipleIntentionalPlaces: places.length > 1,
  insufficientEvidence: false,
  warnings: [],
  ...extra,
});

test('salvage: a fully valid response is unchanged', () => {
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics(envelope([validPlace('Christ the Redeemer')]));
  assert.equal(evidence.places.length, 1);
  assert.equal(evidence.insufficientEvidence, false);
  assert.deepEqual(
    { emitted: diagnostics.emitted, accepted: diagnostics.accepted, rejected: diagnostics.rejected },
    { emitted: 1, accepted: 1, rejected: 0 },
  );
});

test('salvage: one malformed place does NOT erase its valid siblings', () => {
  // The exact production shape: valid places alongside one bad unit.
  const raw = envelope([
    validPlace('Christ the Redeemer'),
    validPlace('Broken', { confidence: 4.2 }), // out of 0..1 range
    validPlace('Copacabana Beach'),
  ]);
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics(raw);
  assert.deepEqual(evidence.places.map((p) => p.name), ['Christ the Redeemer', 'Copacabana Beach']);
  assert.equal(evidence.insufficientEvidence, false);
  assert.equal(diagnostics.emitted, 3);
  assert.equal(diagnostics.accepted, 2);
  assert.equal(diagnostics.rejected, 1);
  assert.ok(evidence.warnings.includes('evidence_place_schema_invalid'), evidence.warnings.join(','));
  // Diagnostics must name the offending path/code, never the value.
  assert.ok(diagnostics.rejectionPaths.some((p) => p.startsWith('places.1.confidence:')), diagnostics.rejectionPaths.join(','));
  assert.ok(!diagnostics.rejectionPaths.some((p) => p.includes('4.2')));
});

test('salvage: invalid + valid + invalid keeps only the valid survivor', () => {
  const raw = envelope([
    validPlace('Bad One', { name: '' }),
    validPlace('Good One'),
    validPlace('Bad Two', { role: 'not_a_role' }),
  ]);
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics(raw);
  assert.deepEqual(evidence.places.map((p) => p.name), ['Good One']);
  assert.equal(diagnostics.rejected, 2);
});

test('salvage: multi-place multiplicity is preserved, never collapsed to first', () => {
  const raw = envelope([
    validPlace('Maya Bay'),
    validPlace('Phi Phi Islands'),
    validPlace('Broken', { category: 'not_a_category' }),
  ]);
  const { evidence } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 2);
  assert.deepEqual(evidence.places.map((p) => p.name), ['Maya Bay', 'Phi Phi Islands']);
  assert.equal(evidence.multipleIntentionalPlaces, true);
});

test('safety: every emitted place malformed -> no survivors, insufficient', () => {
  const raw = envelope([validPlace('A', { confidence: 9 }), validPlace('B', { name: '' })]);
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 0);
  assert.equal(evidence.insufficientEvidence, true);
  assert.equal(diagnostics.accepted, 0);
  assert.equal(diagnostics.rejected, 2);
});

test('safety: structurally unintelligible payloads still hard-fail', () => {
  // Keeps the pre-existing `evidence_schema_invalid` contract for this case.
  for (const bad of [null, 'nope', 42, { places: 'not-an-array' }]) {
    const { evidence, diagnostics } = parseEvidenceWithDiagnostics(bad);
    assert.equal(evidence.places.length, 0, `places for ${JSON.stringify(bad)}`);
    assert.equal(evidence.insufficientEvidence, true, `insufficient for ${JSON.stringify(bad)}`);
    assert.ok(diagnostics.topLevelInvalid, `topLevelInvalid for ${JSON.stringify(bad)}`);
    assert.ok(evidence.warnings.includes('evidence_schema_invalid'));
  }
});

test('an empty object is a valid empty envelope, not a hard failure', () => {
  // `places` defaults to [], so this parses cleanly. It carries no places, and
  // groundClaimedEvidence marks it insufficient downstream.
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics({});
  assert.equal(evidence.places.length, 0);
  assert.equal(diagnostics.topLevelInvalid, false);
  assert.ok(!evidence.warnings.includes('evidence_schema_invalid'));
});

test('safety: garbage objects never become places through coercion', () => {
  const raw = envelope([{ foo: 'bar' }, 'a bare string', 12345, null]);
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 0);
  assert.equal(evidence.insufficientEvidence, true);
  assert.equal(diagnostics.rejected, 4);
});

test('safety: genuine zero-evidence response is untouched', () => {
  const { evidence, diagnostics } = parseEvidenceWithDiagnostics({
    places: [], multipleIntentionalPlaces: false, insufficientEvidence: true, warnings: [],
  });
  assert.equal(evidence.places.length, 0);
  assert.equal(evidence.insufficientEvidence, true);
  assert.equal(diagnostics.rejected, 0);
  assert.ok(!evidence.warnings.includes('evidence_place_schema_invalid'));
});

test('insufficientEvidence is not flipped true by a malformed sibling', () => {
  const raw = envelope([validPlace('Real Place'), validPlace('Bad', { confidence: -1 })]);
  const { evidence } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 1);
  assert.equal(evidence.insufficientEvidence, false);
});

test('a model claiming insufficientEvidence while emitting a valid place is respected as-is', () => {
  // Contradiction handling is NOT invented here: the model's flag is preserved
  // and the downstream resolver keeps its own gates. We only ensure salvage
  // does not silently overwrite it in either direction.
  const raw = envelope([validPlace('Somewhere')], { insufficientEvidence: true });
  const { evidence } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 1);
  assert.equal(evidence.insufficientEvidence, true);
});

// --- The real production shape, as a regression fixture ---------------------
//
// Verified live 2026-08-16 by replaying Instagram DcBz1dhSoax through Gemini
// with production frame settings: the model emits `inferredEvidence` as an
// array of BARE STRINGS rather than {source,value} objects, which is what
// tripped whole-payload validation. Four independently valid places rode along
// with it.
test('regression: bare-string inferredEvidence must not cost us the places', () => {
  const raw = envelope([
    validPlace('Christ the Redeemer', { inferredEvidence: ['iconic statue on a mountain'] }),
    validPlace('Sugarloaf Cable Car', { inferredEvidence: ['cable car over the bay'] }),
    validPlace('Copacabana Beach', { inferredEvidence: ['wide crescent beach'] }),
    validPlace('Ipanema Beach', { inferredEvidence: ['beach with mountains behind'] }),
  ]);
  const { evidence } = parseEvidenceWithDiagnostics(raw);
  assert.equal(evidence.places.length, 4);
  assert.equal(evidence.insufficientEvidence, false);
  // The malformed provenance itself is discarded, never smuggled through.
  for (const p of evidence.places) assert.equal(p.inferredEvidence.length, 0);
});

test('safeParseEvidence wrapper keeps its old signature', () => {
  const out = safeParseEvidence(envelope([validPlace('X'), validPlace('Y', { confidence: 3 })]));
  assert.equal(out.places.length, 1);
  assert.equal(out.insufficientEvidence, false);
});
