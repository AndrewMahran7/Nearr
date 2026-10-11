/** Label-free ablation using the unchanged, frozen cheap-pass prefix. Provider
 * costs are retained counterfactual costs; no latency saving is credited. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { emptyEvidenceReplayObservation } from '../../services/media-worker/src/evaluation/emptyEvidenceReplay.ts';
import { verifyFrozenRun, freezeInferenceRun } from './experimentsCli.mjs';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');


export function replayEmptyEvidence(source: string, out: string, frozenOut: string) {
  const verified = verifyFrozenRun(source);
  const parent = JSON.parse(fs.readFileSync(path.join(source, 'run.json'), 'utf8'));
  const replay = verified.observations.map(emptyEvidenceReplayObservation);
  const rows = replay.map((result: any) => result.observation);
  const configuration = { experiment: 'empty-evidence-review-v1', emptyEvidenceReview: true,
    decisionContext: parent.configuration.decisionContext,
    parent_receipt_sha256: verified.receipt_sha256,
    policy_sha256: hash(fs.readFileSync(new URL('../../services/media-worker/src/automaticDeep/emptyEvidencePolicy.ts', import.meta.url))),
    replay_sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    accounting_module_sha256: hash(fs.readFileSync(new URL('../../services/media-worker/src/evaluation/emptyEvidenceReplay.ts', import.meta.url))) };
  fs.mkdirSync(out);
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('run.json', { ...parent, configuration, configuration_sha256: hash(JSON.stringify(configuration)),
    measured_fresh_inference: false, new_paid_requests: 0 });
  fs.writeFileSync(path.join(out, 'observations.jsonl'), rows.map((row: any) => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'provider-ledger.jsonl'), rows.flatMap((row: any) => row.entries.map((entry: any) =>
    JSON.stringify({ ...entry, input_id: row.input_id, replayed: true }))).join('\n') + '\n', { flag: 'wx' });
  write('completion.json', { inputs: rows.length, failures: rows.filter((row: any) => row.status === 'failed').length,
    provider_requests_dispatched: 0, stopped: replay.filter((row: any) => row.stopped).length,
    counterfactual_avoided_usd: replay.reduce((sum: number, row: any) => sum + row.savedUsd, 0) });
  const frozen = freezeInferenceRun(out, frozenOut);
  return { stopped: replay.filter((row: any) => row.stopped).length,
    avoided_usd: replay.reduce((sum: number, row: any) => sum + row.savedUsd, 0), receipt_sha256: frozen.receipt_sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('usage_source_out_frozen_out');
  console.log(JSON.stringify(replayEmptyEvidence(process.argv[2]!, process.argv[3]!, process.argv[4]!)));
}
