import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import {
  composeShareCompletionNotification,
  type ShareCompletionNotificationContext,
} from '../supabase/functions/process-share-jobs/shareCompletionNotification';

function note(overrides: Partial<ShareCompletionNotificationContext> = {}) {
  return composeShareCompletionNotification({ jobId: 'job-1', status: 'needs_help', ...overrides });
}

const strong = note({ status: 'completed', placeName: 'Es Pontas', savedPlaceId: 'saved-1', googlePlaceId: 'google-1' });
assert.equal(strong.title, 'Found it');
assert.equal(strong.body, 'Es Pontas is saved to your map.');
assert.equal(strong.resultClass, 'strong_exact');
assert.deepEqual(routeShareJobNotification(strong.data), { kind: 'saved_place', savedPlaceId: 'saved-1', googlePlaceId: 'google-1' });

const likely = note({ candidateCount: 1, strongestCandidateName: 'Es Pontas' });
assert.equal(likely.title, 'Possible place found');
assert.equal(likely.body, 'Open Nearr to check Es Pontas.');
assert.equal(likely.resultClass, 'single_likely_candidate');
assert.doesNotMatch(`${likely.title} ${likely.body}`, /Found it/);

const two = note({ candidateCount: 2 });
assert.equal(two.title, 'We found 2 possible spots');
assert.equal(two.body, 'Which one looks right?');
assert.deepEqual(routeShareJobNotification(two.data), { kind: 'queue_item', jobId: 'job-1' });

const many = note({ candidateCount: 10 });
assert.equal(many.title, 'We found several possible spots');
assert.doesNotMatch(many.title, /10/);

const coarse = note({ notificationLocality: { label: 'San Diego', basis: 'observable_corroborated' } });
assert.equal(coarse.title, 'We narrowed it down');
assert.match(coarse.body, /near San Diego/);

for (const basis of ['model_prior', 'weak_context'] as const) {
  const unsafe = note({ notificationLocality: { label: 'San Diego', basis } });
  assert.equal(unsafe.resultClass, 'no_evidence');
  assert.doesNotMatch(`${unsafe.title} ${unsafe.body}`, /San Diego/);
}

const lead = note({ strongestLead: { name: 'Hidden Falls', evidenceKind: 'observable' }, observableLeadCount: 1 });
assert.equal(lead.title, 'Place clue found');
assert.doesNotMatch(`${lead.title} ${lead.body}`, /Hidden Falls/);
assert.equal(lead.resultClass, 'named_lead');
assert.doesNotMatch(lead.title, /Found it/);

const priorLead = note({ strongestLead: { name: 'Private Guess', evidenceKind: 'model_prior' } });
assert.equal(priorLead.resultClass, 'no_evidence');
assert.doesNotMatch(`${priorLead.title} ${priorLead.body}`, /Private Guess/);

const allMulti = note({
  status: 'completed',
  multiPlace: { totalCount: 3, savedCount: 3 },
  savedPlaceId: 's1',
  savedPlaceIds: ['s1', 's2', 's3'],
  createdSavedPlaceIds: ['s1', 's2', 's3'],
});
assert.equal(allMulti.title, 'We found all 3 places');
assert.equal(allMulti.resultClass, 'multi_place_complete');
assert.deepEqual(routeShareJobNotification(allMulti.data), { kind: 'saved_group', savedPlaceIds: ['s1', 's2', 's3'] });

const partialMulti = note({
  multiPlace: { totalCount: 3, savedCount: 2, unresolvedCandidateGroupCount: 1 },
  savedPlaceId: 's1',
  savedPlaceIds: ['s1', 's2'],
  createdSavedPlaceIds: ['s1', 's2'],
  reviewCount: 1,
});
assert.equal(partialMulti.title, 'We found 2 of 3 places');
assert.match(partialMulti.body, /possible matches/);
assert.equal(partialMulti.data.outcome, 'mixed');
assert.deepEqual(routeShareJobNotification(partialMulti.data), { kind: 'queue_item', jobId: 'job-1' });

const sameScene = note({ candidateCount: 3 });
assert.equal(sameScene.resultClass, 'multiple_candidates');
assert.doesNotMatch(sameScene.title, /3 places in this video|all 3 places/);

const weak = note({ hasWeakClues: true });
assert.equal(weak.title, 'We found a few clues');
assert.equal(weak.resultClass, 'weak_clues');

const none = note();
assert.equal(none.title, 'We couldn’t pin this one down');
assert.equal(none.resultClass, 'no_evidence');
assert.doesNotMatch(`${none.title} ${none.body}`, /clues/);

const technical = note({ status: 'failed', technicalFailure: true });
assert.equal(technical.title, 'Something went wrong');
assert.equal(technical.resultClass, 'technical_failure');
assert.doesNotMatch(`${technical.title} ${technical.body}`, /clues|possible|found/i);
assert.deepEqual(routeShareJobNotification(technical.data), { kind: 'queue_item', jobId: 'job-1' });

const alreadySaved = note({ status: 'completed', alreadySaved: true, placeName: 'NOVA Kitchen', savedPlaceId: 'saved-existing' });
assert.equal(alreadySaved.title, 'Already saved');
assert.equal(alreadySaved.body, 'NOVA Kitchen is already in Nearr.');
assert.equal(alreadySaved.data.outcome, 'already_saved');

const privacy = composeShareCompletionNotification({
  jobId: 'privacy',
  status: 'needs_help',
  candidateCount: 1,
  strongestCandidateName: 'A very long\nplace name that should be normalized and safely truncated before it reaches a lock screen',
  caption: 'PRIVATE CAPTION: meet me at 123 Secret Street',
  transcript: 'RAW TRANSCRIPT: my private account is @secret',
  coordinates: { lat: 1, lng: 2 },
  confidence: 0.91234,
} as ShareCompletionNotificationContext & Record<string, unknown>);
const privacyCopy = `${privacy.title} ${privacy.body}`;
assert.doesNotMatch(privacyCopy, /PRIVATE CAPTION|RAW TRANSCRIPT|Secret Street|@secret|0\.91234|lat|lng/);
assert.doesNotMatch(privacyCopy, /\n/);
assert.ok(privacy.title.length < 100);

const allCopy = [strong, likely, two, many, coarse, lead, allMulti, partialMulti, weak, none, technical, alreadySaved, privacy]
  .map((value) => `${value.title} ${value.body}`).join('\n');
assert.doesNotMatch(allCopy, /Detective|\bAI\b|\bmodel\b|GPT|Gemini/i);
assert.doesNotMatch(allCopy, /We need your help|Need your help|Help us/i);

const failureClaimMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260821000002_share_job_failed_notifications.sql'),
  'utf8',
);
const failedStatusFilters = failureClaimMigration.match(/status in \('completed', 'needs_help', 'failed'\)/g) ?? [];
assert.equal(failedStatusFilters.length, 2, 'failed notifications and receipts use the existing durable claim lifecycle');
assert.match(failureClaimMigration, /for update skip locked/);
assert.match(failureClaimMigration, /notification_attempts.*notification_max_attempts/s);

console.log('PASS result-aware share completion notification matrix, evidence safety, privacy, branding, and routing');
