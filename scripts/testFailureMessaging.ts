import assert from 'node:assert/strict';

import {
  SHARE_MEDIA_MAX_DURATION_SECONDS,
  presentShareFailure,
  type ShareFailureInput,
} from '../lib/shareFailurePresentation';

type Fixture = {
  id: string;
  input: ShareFailureInput & { durationSeconds?: number; limitSeconds?: number };
  category: string;
  title: string;
  body: string;
};

const fixtures: Fixture[] = [
  {
    id: 'A: TikTok sensitive post',
    input: { provider: 'tiktok', failureCode: 'authentication_required', analysisAttempted: false },
    category: 'media_access_required',
    title: "We couldn't access this video",
    body: "TikTok requires sign-in to view this post, so Nearr couldn't analyze it.",
  },
  {
    id: 'B: Facebook 270.228-second video',
    input: { provider: 'facebook', failureCode: 'duration_too_long', analysisAttempted: false, durationSeconds: 270.228, limitSeconds: 180 },
    category: 'media_too_long',
    title: 'This video is too long to analyze right now',
    body: 'Nearr currently supports videos up to 3 minutes.',
  },
  {
    id: 'C: Facebook 180.671-second video',
    input: { provider: 'facebook', failureCode: 'duration_too_long', analysisAttempted: false, durationSeconds: 180.671, limitSeconds: 180 },
    category: 'media_too_long',
    title: 'This video is too long to analyze right now',
    body: 'Nearr currently supports videos up to 3 minutes.',
  },
  {
    id: 'D: true visual insufficiency',
    input: { provider: 'facebook', failureCode: 'insufficient_evidence', analysisAttempted: true },
    category: 'analysis_insufficient',
    title: "We couldn't pin this one down",
    body: 'Open Nearr to search manually.',
  },
  {
    id: 'E: terminal download timeout',
    input: { provider: 'facebook', failureCode: 'download_timeout', analysisAttempted: false, status: 'failed' },
    category: 'technical_failure',
    title: 'Something went wrong',
    body: "We couldn't finish checking this post. Open Nearr to try again.",
  },
  {
    id: 'F: unknown-provider access failure',
    input: { provider: null, failureCode: 'authentication_required', analysisAttempted: false },
    category: 'media_access_required',
    title: "We couldn't access this post",
    body: "The source requires access Nearr doesn't currently have.",
  },
];

for (const fixture of fixtures) {
  const result = presentShareFailure(fixture.input);
  assert.equal(result.category, fixture.category, `${fixture.id}: category`);
  assert.equal(result.title, fixture.title, `${fixture.id}: title`);
  assert.equal(result.body, fixture.body, `${fixture.id}: body`);
  assert.doesNotMatch(`${result.title} ${result.body}`, /raw provider|https?:\/\/|Gemini|Sol|yt-dlp|Railway|Vayrin/i);
}

for (const fixture of fixtures.slice(0, 3)) {
  const copy = presentShareFailure(fixture.input);
  assert.doesNotMatch(`${copy.title} ${copy.body}`, /Couldn't find|couldn't pin this one down/i);
}

assert.equal(SHARE_MEDIA_MAX_DURATION_SECONDS, 180);
assert.equal(presentShareFailure({ failureCategory: 'analysis_insufficient', analysisAttempted: false }).category, 'technical_failure');
assert.equal(presentShareFailure({ failureCode: 'authentication_required', provider: 'facebook' }).title, "We couldn't access this post");
assert.deepEqual(presentShareFailure({ failureCode: 'duration_too_long' }).actions, ['back', 'manual_search']);
assert.deepEqual(presentShareFailure({ failureCode: 'download_timeout', status: 'failed' }).actions, ['back', 'retry']);

console.log(`PASS ${fixtures.length} honest failure messaging production fixtures`);
