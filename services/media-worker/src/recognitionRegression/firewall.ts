import type { RegressionCorpusCase } from './types.js';

const FORBIDDEN = /ground.?truth|canonical.?answer|accepted.?alias|expected.?answer|truth.?coordinate|prior.?hypothesis|recognition.?answer|candidate.?set/i;

export type LiveInferenceEnvelope = {
  caseId: string;
  category: string;
  sourceUrl: string;
  evidenceFixture: string | null;
  controls: {
    groundTruthAccessible: false;
    recognitionAnswerCacheRead: false;
    productionTarget: false;
    userTokenAccounting: false;
  };
};

export function buildInferenceEnvelope(item: RegressionCorpusCase): LiveInferenceEnvelope {
  return {
    caseId: item.caseId,
    category: item.category,
    sourceUrl: item.sourceUrl,
    evidenceFixture: item.evidenceFixture,
    controls: { groundTruthAccessible: false, recognitionAnswerCacheRead: false, productionTarget: false, userTokenAccounting: false },
  };
}

export function assertInferenceEnvelope(value: LiveInferenceEnvelope): void {
  if (value.controls.groundTruthAccessible) throw new Error('ground_truth_access_forbidden');
  if (value.controls.recognitionAnswerCacheRead) throw new Error('recognition_answer_cache_forbidden');
  if (value.controls.productionTarget) throw new Error('production_target_forbidden');
  if (value.controls.userTokenAccounting) throw new Error('user_token_accounting_forbidden');
  scan(value);
}

function scan(value: unknown, path = ''): void {
  if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (!['groundTruthAccessible', 'recognitionAnswerCacheRead'].includes(key) && FORBIDDEN.test(key)) throw new Error(`ground_truth_leak:${next}`);
    scan(child, next);
  }
}

export class BenchmarkLifecycle {
  private state: 'CREATED' | 'INFERENCE_STARTED' | 'RESULTS_PERSISTED' | 'RANKED' | 'TRUTH_LOADED' | 'SCORED' = 'CREATED';

  inferenceStarted(): void { if (this.state !== 'CREATED') throw new Error('bad_lifecycle'); this.state = 'INFERENCE_STARTED'; }
  resultsPersisted(): void { if (this.state !== 'INFERENCE_STARTED') throw new Error('persist_before_inference'); this.state = 'RESULTS_PERSISTED'; }
  ranked(): void { if (this.state !== 'RESULTS_PERSISTED') throw new Error('rank_before_persist'); this.state = 'RANKED'; }
  truthLoaded(): void { if (this.state !== 'RANKED') throw new Error('truth_before_ranking'); this.state = 'TRUTH_LOADED'; }
  scored(): void { if (this.state !== 'TRUTH_LOADED') throw new Error('score_before_truth'); this.state = 'SCORED'; }
  current(): string { return this.state; }
}
