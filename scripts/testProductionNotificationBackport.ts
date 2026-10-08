import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authoritativeShareJobNotification } from '../lib/shareJobNotificationAuthority';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';

const cases = [
  composeShareCompletionNotification({ jobId: 'job-1', status: 'completed', placeName: 'A place', savedPlaceId: 'save-1' }),
  composeShareCompletionNotification({ jobId: 'job-1', status: 'needs_help', candidateCount: 2 }),
];

for (const composed of cases) {
  const payload = { title: composed.title, body: composed.body, data: composed.data };
  assert.deepEqual(routeShareJobNotification(payload.data), { kind: 'queue_item', jobId: 'job-1' });
  const status = composed.data.type === 'share_job_completed' ? 'completed' : 'needs_help';
  const accepted = authoritativeShareJobNotification({
    id: 'job-1', user_id: 'user-1', status,
    notification_status: 'sending', notification_payload: payload,
  });
  assert.deepEqual(accepted?.payload, payload);
  assert.equal(authoritativeShareJobNotification({
    id: 'job-1', user_id: 'user-1', status,
    notification_status: 'submitted', notification_payload: payload,
  }), null);
  assert.equal(authoritativeShareJobNotification({
    id: 'job-1', user_id: 'user-1', status,
    notification_status: 'sending',
    notification_payload: { ...payload, data: { ...payload.data, jobId: 'foreign-job' } },
  }), null);
  assert.equal(authoritativeShareJobNotification({
    id: 'job-1', user_id: 'user-1', status: 'processing_metadata',
    notification_status: 'sending', notification_payload: payload,
  }), null);
}

const worker = fs.readFileSync(path.resolve(__dirname, '../supabase/functions/process-share-jobs/index.ts'), 'utf8');
assert.match(worker, /if \(response\.ok\) \{[\s\S]*?await processPendingNotifications\(admin, 25\);/);
assert.match(worker, /notification_authority_read_failed/);
assert.match(worker, /notification_dispatch_started/);
assert.match(worker, /await processPendingNotifications\(admin, limit\);/);

console.log('PASS Production notification backport: old payload/deep link, authoritative row, immediate and cron drains');
