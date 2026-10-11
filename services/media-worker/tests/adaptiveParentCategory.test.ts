import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLegacyParentCategory } from '../../../supabase/functions/process-share-jobs/adaptiveLegacyIdentity.ts';
import { planAutomaticCompletion } from '../../../lib/automaticCompletion.ts';
import { loadConfig } from '../src/config/env.js';

const evidence = (category: string, extra: object = {}) => ({ places: [{ category, role: 'primary',
  explicitEvidence: [{ source: 'caption', value: 'Observed venue' }], ...extra }] }) as any;
const candidate = { googlePlaceId: 'fixture', name: 'Observed venue', latitude: 1, longitude: 1,
  types: ['shopping_mall'], exactIdentityStrength: 'candidate_bound' as const };

test('food-parent contradiction veto reaches existing authoritative completion gate', () => {
  assert.equal(planAutomaticCompletion([candidate]).action, 'save');
  const check = evaluateLegacyParentCategory(candidate, evidence('restaurant'));
  assert.equal(check.eligible, false);
  assert.equal(planAutomaticCompletion([{ ...candidate, upstreamSafetyDecision: 'REVIEW' }]).action, 'escalate');
});

test('parent category rule preserves legitimate parents, food tenants and unsupported mentions', () => {
  for (const [types, source] of [
    [['shopping_mall', 'restaurant'], evidence('restaurant')],
    [['park'], evidence('park')],
    [[], evidence('restaurant')],
    [['shopping_mall'], evidence('restaurant', { role: 'passing_mention' })],
    [['shopping_mall'], evidence('restaurant', { identityEvidenceKind: 'model_prior' })],
    [['shopping_mall'], evidence('restaurant', { explicitEvidence: [] })],
  ] as const) assert.equal(evaluateLegacyParentCategory({ ...candidate, types }, source).eligible, true);
});

test('adaptive worker policy remains disabled unless explicitly configured', () => {
  const prior = process.env.ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED;
  try {
    delete process.env.ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED;
    assert.equal(loadConfig().adaptiveEmptyEvidenceReviewEnabled, false);
    process.env.ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED = 'true';
    assert.equal(loadConfig().adaptiveEmptyEvidenceReviewEnabled, true);
  } finally {
    if (prior === undefined) delete process.env.ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED;
    else process.env.ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED = prior;
  }
});
