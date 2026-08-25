import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  bestEvidenceFrameForSavedResult,
  placeSourcePreviewCandidates,
  selectPlaceSourceEvidenceFrames,
  type PlaceSourceEvidenceResult,
} from '../lib/placeSourcePreviews';

const REEL_A = 'https://www.instagram.com/reel/SourceA/';
const REEL_B = 'https://www.instagram.com/reel/SourceB/';

function result(
  sourceUrl: string,
  savedPlaceId: string,
  mentionId: string,
  timestamp: number,
  storagePath: string,
): PlaceSourceEvidenceResult {
  return {
    sourceUrl,
    logicalResultId: mentionId,
    savedPlaceId,
    finalizedAt: '2026-08-24T12:00:00.000Z',
    candidatePayload: {
      evidenceFrames: [
        {
          id: `${mentionId}-unrelated`,
          storagePath: storagePath.replace('.jpg', '-unrelated.jpg'),
          timestampSeconds: 2,
          relevance: 'vayrin_selected',
        },
        {
          id: `${mentionId}-place`,
          storagePath,
          timestampSeconds: timestamp,
          relevance: 'candidate_evidence',
        },
      ],
      mentionSlots: [{
        mentionId,
        displayName: 'Test place',
        outcome: 'verified_single',
        candidates: [],
        savedPlaceId,
        sourceTimestamps: [timestamp - 0.25],
      }],
    },
  };
}

// The place-scoped retained moment beats a stronger but unrelated frame from
// another scene in the same post.
{
  const selected = bestEvidenceFrameForSavedResult(
    result(REEL_A, 'saved-1', 'mention-a', 18, 'user/job/task/a.jpg'),
  );
  assert.equal(selected?.storagePath, 'user/job/task/a.jpg');
}

// Multi-source places keep exact post identity: Reel A never borrows Reel B's
// preview, even though both resolve to the same saved place.
{
  const sources = [
    { key: 'instagram:SourceA', url: `${REEL_A}?igsh=tracking` },
    { key: 'instagram:SourceB', url: REEL_B },
  ];
  const frames = selectPlaceSourceEvidenceFrames(sources, [
    result(REEL_B, 'saved-1', 'mention-b', 31, 'user/job-b/task/b.jpg'),
    result(REEL_A, 'saved-1', 'mention-a', 18, 'user/job-a/task/a.jpg'),
  ]);
  assert.equal(frames['instagram:SourceA']?.storagePath, 'user/job-a/task/a.jpg');
  assert.equal(frames['instagram:SourceB']?.storagePath, 'user/job-b/task/b.jpg');
}

// Renderer preference and recovery order: retained frame, stored source
// thumbnail, then an empty list that deliberately activates the platform tile.
{
  assert.deepEqual(
    placeSourcePreviewCandidates(' https://signed.test/evidence.jpg ', 'https://cdn.test/thumb.jpg'),
    ['https://signed.test/evidence.jpg', 'https://cdn.test/thumb.jpg'],
  );
  assert.deepEqual(
    placeSourcePreviewCandidates(null, 'https://cdn.test/thumb.jpg'),
    ['https://cdn.test/thumb.jpg'],
  );
  assert.deepEqual(
    placeSourcePreviewCandidates('https://cdn.test/thumb.jpg', 'https://cdn.test/thumb.jpg'),
    ['https://cdn.test/thumb.jpg'],
  );
  assert.deepEqual(placeSourcePreviewCandidates(null, '  '), []);
}

// Guard the production ownership and graceful-fallback wiring.
{
  const detail = readFileSync(resolve(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const service = readFileSync(resolve(process.cwd(), 'services/placeSourcePreviewsService.ts'), 'utf8');
  assert.match(detail, /loadPlaceSourceEvidencePreviewUrls\(saved\.id, sourceCards\)/);
  assert.match(detail, /placeSourcePreviewCandidates\([\s\S]*sourceEvidencePreviewUrls\[item\.key\][\s\S]*item\.thumbnailUrl/);
  assert.match(detail, /onError=\{\(\) => \{[\s\S]*setFailedSourcePreviewUrls/);
  assert.match(detail, /sourceCardPlatformBadge/);
  assert.match(detail, /item\.primary \? \([\s\S]*Original/);
  assert.match(detail, /openSourceCard\(item\.url, attribution\.platformName\)/);
  assert.match(service, /from\('share_job_place_results'\)/);
  assert.match(service, /resolveShareEvidenceFramePreviews/);
  assert.doesNotMatch(service, /insert|update|delete|rpc\(/i);
}

console.log('PASS source-specific evidence preview selection, thumbnail fallback, and source-card behavior');
