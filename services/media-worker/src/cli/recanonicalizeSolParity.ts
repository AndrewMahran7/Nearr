import { appendFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { loadConfig } from '../config/env.js';
import { canonicalizeDestination } from '../solParity/canonicalize.js';
import { simulateDecision } from '../solParity/decision.js';
import type { PersistedModelAttempt } from '../solParity/types.js';

function jsonLines<T>(text: string): T[] { return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }

async function main(): Promise<void> {
  const { repoRoot } = loadEnvFiles();
  const base = path.join(repoRoot, 'artifacts', 'sol-parity');
  const sources: Array<{ run: string; predicate: (attempt: PersistedModelAttempt) => boolean }> = [
    { run: 'r03-m1-final', predicate: () => true },
    { run: 'priority-eight', predicate: () => true },
    { run: 'remaining-m1', predicate: () => true },
    { run: 'safety-multi-m2', predicate: () => true },
    { run: 'r03-web', predicate: (attempt) => attempt.frame_arm === 'F2' && attempt.model_arm === 'M2' },
  ];
  const attempts: PersistedModelAttempt[] = [];
  for (const source of sources) {
    const rows = jsonLines<PersistedModelAttempt>(await readFile(path.join(base, 'runs', source.run, 'model-attempts.jsonl'), 'utf8'));
    attempts.push(...rows.filter(source.predicate));
  }
  const out = path.join(base, 'canonicalization-recheck.jsonl');
  await rm(out, { force: true });
  const apiKey = loadConfig().googlePlacesServerApiKey || null;
  let calls = 0;
  for (const [index, attempt] of attempts.entries()) {
    const started = Date.now();
    const destinations = [];
    for (const destination of attempt.payload?.results ?? []) destinations.push(await canonicalizeDestination({ destination, apiKey }));
    const placesCalls = destinations.reduce((sum, item) => sum + item.places_calls, 0);
    calls += placesCalls;
    await appendFile(out, `${JSON.stringify({ attempt_id: attempt.attempt_id, canonicalization_ms: Date.now() - started, places_calls: placesCalls, destinations, simulated_decision: simulateDecision(attempt.payload, destinations), actual_save_performed: false })}\n`, 'utf8');
    console.log(`[sol-parity] canonicalize=${index + 1}/${attempts.length} case=${attempt.case_id} calls=${placesCalls}`);
  }
  console.log(`[sol-parity] canonicalization_recheck_complete attempts=${attempts.length} places_calls=${calls}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
