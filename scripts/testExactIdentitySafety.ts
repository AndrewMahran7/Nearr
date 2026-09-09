import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXACT_IDENTITY_SAFETY_RULE_VERSION,
  evaluateExactIdentitySafety,
} from '../lib/exactIdentitySafety';

const decide = (over: Partial<Parameters<typeof evaluateExactIdentitySafety>[0]> = {}) =>
  evaluateExactIdentitySafety({
    support: {},
    plausibleCandidateCount: 1,
    ...over,
  });

assert.equal(decide().allowed, false, 'a plausible parent complex is not exact identity');
assert.equal(decide().reason, 'exact_identity_unproven');

const sibling = decide({
  support: { exactSourceNameSources: ['caption'] },
  plausibleCandidateCount: 2,
});
assert.equal(sibling.allowed, false, 'an exact attraction name cannot choose between sibling provider rows');
assert.equal(sibling.reason, 'related_place_not_distinguished');

assert.equal(decide({ plausibleCandidateCount: 2 }).allowed, false,
  'nearby same-category natural features require confirmation');
assert.equal(decide({
  support: { providerGeographyCorroborated: true, visualConfidence: 0.99 },
}).allowed, false, 'same visual class and region are retrieval evidence, not identity');

const business = decide({ support: { exactSourceNameSources: ['caption'] } });
assert.equal(business.allowed, true, 'an exact first-party business name with one candidate remains saveable');
assert.equal(business.strength, 'source_named');

const landmark = decide({ support: {
  visualNameObservationCount: 2,
  visualNameTimestampCount: 2,
  visualConfidence: 0.96,
  providerGeographyCorroborated: true,
} });
assert.equal(landmark.allowed, true, 'repeated discriminating visual identity plus provider geography remains saveable');
assert.equal(landmark.strength, 'distinctive_visual');

const natural = decide({ support: {
  visualNameObservationCount: 3,
  visualNameTimestampCount: 3,
  visualConfidence: 0.94,
  providerGeographyCorroborated: true,
} });
assert.equal(natural.allowed, true, 'genuinely discriminating natural-feature evidence remains saveable');

assert.equal(decide({
  support: { exactSourceNameSources: ['speech'] },
  plausibleCandidateCount: 3,
}).allowed, false, 'multiple plausible candidates without a candidate-bound identity require review');

assert.equal(decide({
  support: { exactAddress: true },
  plausibleCandidateCount: 3,
}).allowed, true, 'an exact address binds the selected provider despite retrieval alternatives');

assert.equal(decide({
  support: { exactAddress: true },
  upstreamSafetyDecision: 'REVIEW',
}).allowed, false, 'an upstream review-only model decision can never be upgraded downstream');

assert.equal(business.ruleVersion, EXACT_IDENTITY_SAFETY_RULE_VERSION);

const root = path.resolve(__dirname, '..');
const finalizer = fs.readFileSync(path.join(root, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
const qualificationHarness = fs.readFileSync(path.join(root, 'scripts/qualifyTutorialRecognition.ts'), 'utf8');
assert.match(finalizer, /job\.recognition_run_mode === 'qualification_fresh'/,
  'fresh qualification outcomes cannot populate reusable recognition cache rows');
assert.match(finalizer, /upstreamSafetyDecision: ranked\.safetyDecision/,
  'Automatic Deep carries its worker safety decision into Automatic Completion');
assert.match(qualificationHarness, /safety_replay_requires_explicit_fixture_id/,
  'an ineligible regression fixture can only be replayed by explicit id');

console.log('PASS exact-identity safety doctrine (parent, sibling, nearby, visual, source, cache, deep)');
