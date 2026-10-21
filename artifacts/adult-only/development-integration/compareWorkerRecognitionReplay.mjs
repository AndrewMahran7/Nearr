#!/usr/bin/env node
// Read-only, frozen-fixture replay against two source worktrees. This calls no
// providers and prints hashes/counts, not source URLs or model payloads.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [baselineRoot, ageRoot] = process.argv.slice(2);
if (!baselineRoot || !ageRoot || !path.isAbsolute(baselineRoot) || !path.isAbsolute(ageRoot)) {
  throw new Error('expected two absolute repository worktree paths');
}

async function replay(repoRoot) {
  const worker = path.join(repoRoot, 'services', 'media-worker', 'src', 'recognitionRegression');
  const { loadRegressionCorpus } = await import(pathToFileURL(path.join(worker, 'fixtures.ts')).href);
  const { replayCurrentRuntime } = await import(pathToFileURL(path.join(worker, 'replay.ts')).href);
  const corpus = await loadRegressionCorpus(repoRoot);
  const attempts = await replayCurrentRuntime(repoRoot, corpus, 'fixed-age-parity-replay');
  const rows = attempts.map(({ persistedAt: _time, ...result }) => result)
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  return { rows, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

const before = await replay(baselineRoot);
const after = await replay(ageRoot);
const prior = new Map(before.rows.map((row) => [row.caseId, JSON.stringify(row)]));
const changed = after.rows.filter((row) => prior.get(row.caseId) !== JSON.stringify(row)).map((row) => row.caseId);
const missing = before.rows.filter((row) => !after.rows.some((other) => other.caseId === row.caseId)).map((row) => row.caseId);
console.log(JSON.stringify({ baselineCases: before.rows.length, ageCases: after.rows.length,
  baselineSha256: before.hash, ageSha256: after.hash, changedCaseIds: changed, missingCaseIds: missing }));
if (before.rows.length !== after.rows.length || changed.length || missing.length || before.hash !== after.hash) process.exitCode = 1;
