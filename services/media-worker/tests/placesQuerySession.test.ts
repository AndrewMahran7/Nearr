import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlacesQuerySession, mapPlacesInOrder } from '../src/premium/placesQuerySession.js';
import type { PremiumCanonicalCandidate, PremiumPlacesSearch } from '../src/premium/premiumRecognitionTypes.js';

const candidate = (name: string): PremiumCanonicalCandidate => ({ googlePlaceId: name, name, formattedAddress: 'Paris, France', latitude: 48, longitude: 2, types: ['restaurant'] });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('coalesces concurrent identical requests, memoizes success and isolates returned objects', async () => {
  let calls = 0;
  const session = createPlacesQuerySession({ mode: 'bounded', search: async (query) => { calls++; await tick(); return { ok: true, results: [candidate(query)] }; } });
  const [a, b] = await Promise.all([session.search('Café, Paris, France', 'private-key'), session.search('Café, Paris, France', 'private-key')]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  if (a.ok) a.results[0]!.name = 'mutated';
  assert.deepEqual(await session.search('Café, Paris, France', 'private-key'), b);
  assert.equal(session.telemetry().avoidedRequests, 2);
  assert.ok(!JSON.stringify(session.telemetry()).includes('private-key'));
  assert.ok(!JSON.stringify(session.telemetry()).includes('Café'));
});

test('different country, region, accents, casing, credentials and cancellation owners never coalesce', async () => {
  let calls = 0;
  const session = createPlacesQuerySession({ mode: 'bounded', search: async (q) => { calls++; return { ok: true, results: [candidate(q)] }; } });
  const one = new AbortController(); const two = new AbortController();
  await Promise.all([
    session.search('Café, Paris, France', 'k'), session.search('Café, Paris, Texas', 'k'),
    session.search('Cafe, Paris, France', 'k'), session.search('CAFÉ, Paris, France', 'k'),
    session.search('Café, Paris, France', 'other'), session.search('Café, Paris, France', 'k', one.signal),
    session.search('Café, Paris, France', 'k', two.signal),
  ]);
  assert.equal(calls, 7);
});

test('failed calls and rejected transports are not cached; empty successful responses are', async () => {
  let calls = 0;
  const session = createPlacesQuerySession({ mode: 'memoized', search: async () => {
    calls++; if (calls === 1) throw new Error('secret-provider-error');
    if (calls === 2) return { ok: false, reason: 'places_http_429' };
    return { ok: true, results: [] };
  } });
  for (let i = 0; i < 4; i++) await session.search('q', 'k');
  assert.equal(calls, 3); assert.equal(session.telemetry().actualRequests, 3);
});

test('strict bound applies across different groups and output order remains deterministic', async () => {
  let active = 0; let peak = 0;
  const search: PremiumPlacesSearch = async (q) => { active++; peak = Math.max(peak, active); await tick(); active--; return { ok: true, results: [candidate(q)] }; };
  const session = createPlacesQuerySession({ mode: 'bounded', concurrency: 3, search });
  const values = Array.from({ length: 17 }, (_, i) => String(i));
  const result = await mapPlacesInOrder(values, 7, (q) => session.search(q, 'k'));
  assert.equal(peak, 3); assert.equal(session.telemetry().peakActive, 3);
  assert.deepEqual(result.map((r) => r.ok && r.results[0]!.name), values);
});

test('queued work is suppressed on cancellation and late successful responses do not escape', async () => {
  const controller = new AbortController(); let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const session = createPlacesQuerySession({ mode: 'bounded', concurrency: 1, search: async () => { calls++; await pending; return { ok: true, results: [candidate('old')] }; } });
  const promises = ['one', 'two', 'three'].map((q) => session.search(q, 'k', controller.signal));
  await tick(); controller.abort(); release();
  const result = await Promise.all(promises);
  assert.equal(calls, 1); assert.equal(session.telemetry().actualRequests, 1);
  assert.deepEqual(result, Array.from({ length: 3 }, () => ({ ok: false, reason: 'aborted' })));
});

test('baseline mode performs every request serially with no memoization', async () => {
  let calls = 0; let active = 0;
  const session = createPlacesQuerySession({ mode: 'serial', search: async () => { calls++; assert.equal(++active, 1); await tick(); active--; return { ok: true, results: [] }; } });
  await Promise.all(Array.from({ length: 5 }, () => session.search('same', 'key')));
  assert.equal(calls, 5); assert.equal(session.telemetry().avoidedRequests, 0);
});
