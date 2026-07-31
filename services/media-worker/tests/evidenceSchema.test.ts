import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MediaPlaceEvidence,
  safeParseEvidence,
  emptyEvidence,
  hasExplicitEvidence,
} from '../src/types/evidence.js';

test('safeParseEvidence: garbage → insufficient, no places', () => {
  const r = safeParseEvidence(42);
  assert.equal(r.insufficientEvidence, true);
  assert.deepEqual(r.places, []);
  assert.ok(r.warnings.includes('evidence_schema_invalid'));
});

test('schema applies defaults (role, confidence, timestamp)', () => {
  const parsed = MediaPlaceEvidence.parse({
    places: [{ name: 'Capones', explicitEvidence: [{ source: 'speech', value: 'we are at capones' }] }],
  });
  const p = parsed.places[0]!;
  assert.equal(p.role, 'primary');
  assert.equal(p.confidence, 0);
  assert.equal(p.explicitEvidence[0]!.timestampSeconds, null);
  assert.equal(parsed.multipleIntentionalPlaces, false);
  assert.equal(parsed.insufficientEvidence, false);
});

test('schema rejects invalid source enum', () => {
  const res = MediaPlaceEvidence.safeParse({
    places: [{ name: 'X', explicitEvidence: [{ source: 'nope', value: 'x' }] }],
  });
  assert.equal(res.success, false);
});

test('hasExplicitEvidence distinguishes explicit vs inferred-only', () => {
  const explicit = MediaPlaceEvidence.parse({
    places: [{ name: 'X', explicitEvidence: [{ source: 'visible_text', value: 'SIGN' }] }],
  }).places[0]!;
  const inferredOnly = MediaPlaceEvidence.parse({
    places: [{ name: 'X', inferredEvidence: [{ source: 'frame', value: 'guess' }] }],
  }).places[0]!;
  assert.equal(hasExplicitEvidence(explicit), true);
  assert.equal(hasExplicitEvidence(inferredOnly), false);
});

test('emptyEvidence is insufficient with provided warnings', () => {
  const e = emptyEvidence(['because']);
  assert.equal(e.insufficientEvidence, true);
  assert.equal(e.places.length, 0);
  assert.deepEqual(e.warnings, ['because']);
});

test('schema caps oversized arrays via max()', () => {
  const tooMany = Array.from({ length: 50 }, (_, i) => ({
    name: `P${i}`,
    explicitEvidence: [{ source: 'speech', value: 'x' }],
  }));
  const res = MediaPlaceEvidence.safeParse({ places: tooMany });
  assert.equal(res.success, false); // >12 places rejected
});
