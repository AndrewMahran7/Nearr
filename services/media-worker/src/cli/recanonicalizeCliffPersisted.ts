/** Reclassify already-persisted cliff benchmark canonicalization records.
 * No model, acquisition, web, cache, or map-provider call is made. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyCanonicalizationRelation } from '../solParity/canonicalizationSpecificity.js';

const ARMS = ['simple-sol', 'simple-sol-b', 'accuracy-max-a', 'accuracy-max-b'] as const;

function lines(raw: string): any[] {
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const rawRoot = path.join(repoRoot, 'artifacts', 'cliff-jumping', 'raw');
  let attempts = 0;
  let parentOnlyMatches = 0;
  for (const arm of ARMS) {
    const directory = path.join(rawRoot, arm);
    const input = lines(await readFile(path.join(directory, 'canonicalization.jsonl'), 'utf8'));
    const output = input.map((record) => ({
      ...record,
      canonicalization_version: 'specificity-preserving.v1',
      destinations: (record.destinations ?? []).map((destination: any) => {
        const selected = destination?.selected;
        if (!selected?.name || !destination?.model_identity?.name) return destination;
        const relation = classifyCanonicalizationRelation({
          modelName: destination.model_identity.name,
          modelEntityType: destination.model_identity.entity_type ?? 'UNKNOWN',
          providerName: selected.name,
          providerTypes: selected.provider_types ?? [],
        });
        if (relation === 'PARENT_ONLY') {
          parentOnlyMatches += 1;
          return { ...destination, status: 'PARENT_ONLY_MATCH', selected: null, provider_parent: selected };
        }
        if (relation === 'INCOMPATIBLE') {
          return { ...destination, status: 'NAMED_LEAD', selected: null, provider_parent: null };
        }
        return { ...destination, status: relation === 'EXACT' ? 'CANONICAL_EXACT' : 'CANONICAL_ALIAS', provider_parent: destination.provider_parent ?? null };
      }),
    }));
    attempts += output.length;
    await writeFile(path.join(directory, 'canonicalization-specificity-v2.jsonl'), `${output.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    source: 'persisted canonicalization records',
    modelCalls: 0,
    acquisitionCalls: 0,
    webCalls: 0,
    mapProviderCalls: 0,
    records: attempts,
    parentOnlyMatches,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
