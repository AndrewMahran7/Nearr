import assert from 'node:assert/strict';

import {
  decideQuickCheckCompletion,
  savedPlaceMatchesQuickCheckIntent,
  type QuickCheckCompletionIntent,
} from '../lib/quickCheckCompletion';
import type { ShareJob } from '../services/shareJobsService';
import type { SavedPlaceWithPlace } from '../types';

const intent: QuickCheckCompletionIntent = {
  jobId: 'job-1',
  savedPlaceId: 'saved-1',
  googlePlaceId: 'google-2nd-floor',
  sourceUrl: 'https://www.instagram.com/p/DYpcd2ZBTsZ/?utm_source=ig_web_copy_link',
};

function job(status: ShareJob['status'], savedPlaceId: string | null): ShareJob {
  return {
    id: 'job-1', user_id: 'user-1', source_url: intent.sourceUrl!, canonical_url: null,
    source_platform: 'instagram', status, progress_stage: 'completed', decision: 'candidate_confirmation',
    saved_place_id: savedPlaceId, candidate_payload: null, extraction_payload: null, suggested_query: null,
    needs_help_reason: null, failure_reason: null, failure_category: null, failure_code: null,
    analysis_attempted: true, notification_status: null, notification_attempts: 0,
    notification_last_attempt_at: null, notification_ticket_ids: null, notification_error_code: null,
    notification_submitted_at: null, created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z', completed_at: status === 'completed' ? '2026-10-18T00:00:01.000Z' : null,
  };
}

function saved(overrides: Partial<SavedPlaceWithPlace> = {}): SavedPlaceWithPlace {
  return {
    id: 'saved-1', user_id: 'user-1', place_id: 'place-1', radius_value: null, radius_unit: null,
    notes: null, source_type: 'instagram', source_url: null, notifications_enabled: false,
    last_notified_at: null, notification_count: 0, reminder_opportunity_count: 0, archived_at: null,
    visited_at: null, reminders_exhausted_at: null, created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
    place: {
      id: 'place-1', google_place_id: 'google-2nd-floor', name: '2nd Floor',
      formatted_address: '126 Main St, Huntington Beach, CA', latitude: 33.66, longitude: -118,
      category: 'restaurant', google_maps_url: null, created_at: '2026-10-18T00:00:00.000Z',
    },
    sources: [{
      id: 'source-1', saved_place_id: 'saved-1', user_id: 'user-1', identity_key: 'ig:dypc',
      identity_version: 1, platform: 'instagram', content_id: 'dypcd2zbtsz',
      canonical_url: 'https://www.instagram.com/p/DYpcd2ZBTsZ/', original_url: intent.sourceUrl,
      creator_handle: null, creator_name: null, caption_excerpt: null, ai_note: null, thumbnail_url: null,
      is_primary: true, first_attached_at: '2026-10-18T00:00:00.000Z', last_seen_at: '2026-10-18T00:00:00.000Z',
      created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z',
    }],
    ...overrides,
  };
}

assert.equal(savedPlaceMatchesQuickCheckIntent(saved(), intent), null, 'exact child-source relationship verifies');
assert.equal(
  decideQuickCheckCompletion({ job: job('completed', 'saved-1'), saved: saved(), intent }).kind,
  'verified_completed',
  'lost response reconciles only after exact job + saved-place + source verification',
);
assert.equal(
  decideQuickCheckCompletion({ job: job('needs_help', null), saved: saved(), intent }).kind,
  'retry_resolution',
  'persisted exact result retries only the resolution step',
);
assert.equal(
  decideQuickCheckCompletion({ job: job('cancelled', null), saved: saved(), intent }).kind,
  'cancelled_or_unavailable',
  'a cancelled job remains cancelled even when a save exists',
);
assert.equal(
  decideQuickCheckCompletion({ job: job('completed', 'saved-other'), saved: saved(), intent }).kind,
  'different_result',
  'a superseding completed result is not converted to success',
);
assert.equal(
  decideQuickCheckCompletion({ job: job('completed', 'saved-1'), saved: saved({ sources: [], source_url: null }), intent }).kind,
  'unverified_result',
  'place existence without the required source association is insufficient',
);
const wrongProvider = saved();
wrongProvider.place = { ...wrongProvider.place, google_place_id: 'similar-name-different-place' };
assert.equal(
  decideQuickCheckCompletion({ job: job('completed', 'saved-1'), saved: wrongProvider, intent }).kind,
  'unverified_result',
  'same saved id/name cannot mask a provider-identity mismatch',
);
assert.equal(
  decideQuickCheckCompletion({ job: null, saved: saved(), intent }).kind,
  'cancelled_or_unavailable',
  'an RLS-invisible or removed job is not claimed as completed',
);

console.log('PASS Oct 18 Quick Check authoritative completion and source-association reconciliation');

