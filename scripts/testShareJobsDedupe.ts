/**
 * scripts/testShareJobsDedupe.ts
 *
 * Unit tests for the PURE queue dedupe (lib/shareJobsDedupe.ts). Proves the
 * queue never renders the same job twice, tolerates malformed/duplicate/stale
 * realtime data, and keeps the freshest copy — without crashing.
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testShareJobsDedupe.ts
 */

import { dedupeJobsById, upsertJobById } from '../lib/shareJobsDedupe';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- collapses duplicate ids, keeps the freshest by updated_at -------------
{
  const jobs = [
    { id: 'a', updated_at: '2026-08-01T10:00:00Z', status: 'queued' },
    { id: 'b', updated_at: '2026-08-01T10:01:00Z', status: 'queued' },
    { id: 'a', updated_at: '2026-08-01T10:05:00Z', status: 'completed' }, // newer dup
  ];
  const out = dedupeJobsById(jobs);
  check('dedupe collapses duplicate id', out.length === 2);
  check('dedupe preserves first-seen order', out[0].id === 'a' && out[1].id === 'b');
  check('dedupe keeps freshest copy of a', (out[0] as any).status === 'completed');
}

// ---- older duplicate does not overwrite newer ------------------------------
{
  const out = dedupeJobsById([
    { id: 'a', updated_at: '2026-08-01T10:05:00Z', status: 'completed' },
    { id: 'a', updated_at: '2026-08-01T10:00:00Z', status: 'queued' }, // older
  ]);
  check('older dup does not overwrite newer', out.length === 1 && (out[0] as any).status === 'completed');
}

// ---- drops malformed / id-less rows ----------------------------------------
{
  const out = dedupeJobsById([
    { id: 'a', updated_at: '2026-08-01T10:00:00Z' },
    null as any,
    undefined as any,
    { updated_at: 'x' } as any, // no id
    { id: 42 } as any, // non-string id
    'nope' as any,
  ]);
  check('drops malformed rows, keeps valid', out.length === 1 && out[0].id === 'a');
}

// ---- repeated realtime event => one row ------------------------------------
{
  const evt = { id: 'z', updated_at: '2026-08-01T11:00:00Z' };
  check('duplicate realtime events dedupe to one', dedupeJobsById([evt, evt, evt]).length === 1);
}

// ---- empty / null / non-array inputs ---------------------------------------
{
  check('empty array => empty', dedupeJobsById([]).length === 0);
  check('null => empty', dedupeJobsById(null).length === 0);
  check('non-array => empty', dedupeJobsById('nope' as any).length === 0);
}

// ---- rows with missing updated_at still dedupe (latest-seen wins) ----------
{
  const out = dedupeJobsById([
    { id: 'a', status: 'queued' },
    { id: 'a', status: 'processing_metadata' },
  ] as any);
  check('missing updated_at: latest-seen wins', out.length === 1 && (out[0] as any).status === 'processing_metadata');
}

// ---- upsertJobById ---------------------------------------------------------
{
  const list = [
    { id: 'a', status: 'queued' },
    { id: 'b', status: 'queued' },
  ];
  const replaced = upsertJobById(list, { id: 'b', status: 'completed' } as any);
  check('upsert replaces in place', replaced.length === 2 && (replaced[1] as any).status === 'completed');
  check('upsert keeps position', replaced[0].id === 'a' && replaced[1].id === 'b');
  const appended = upsertJobById(list, { id: 'c', status: 'queued' } as any);
  check('upsert appends new id', appended.length === 3 && appended[2].id === 'c');
  const idless = upsertJobById(list, { status: 'queued' } as any);
  check('upsert ignores id-less incoming (no dup)', idless.length === 2);
  check('upsert does not mutate input', list.length === 2 && (list[1] as any).status === 'queued');
}

if (failures > 0) {
  console.error(`\n${failures} share-jobs-dedupe test(s) FAILED`);
  process.exit(1);
}
console.log('\nALL SHARE JOBS DEDUPE TESTS PASSED');
