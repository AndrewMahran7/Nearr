import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { shouldPresentNotificationInForeground } from '../lib/notificationForegroundPolicy';
import { authoritativeShareJobNotification } from '../lib/shareJobNotificationAuthority';

const payload = {
  title: 'Saved Mad Yolks to your map',
  body: 'Open Nearr to view your new find.',
  data: { type: 'share_job_completed', jobId: 'job-1' },
};

assert.equal(shouldPresentNotificationInForeground({
  appState: 'active', pathname: '/share-jobs/job-1', data: payload.data,
}), false, 'the exact open result is the only suppressed foreground case');
assert.equal(shouldPresentNotificationInForeground({
  appState: 'active', pathname: '/share-jobs/job-2', data: payload.data,
}), true);
assert.equal(shouldPresentNotificationInForeground({
  appState: 'background', pathname: '/share-jobs/job-1', data: payload.data,
}), true);
assert.equal(shouldPresentNotificationInForeground({
  appState: 'active', pathname: '/(tabs)/map', data: { type: 'nearby_reminder' },
}), true, 'nearby reminders remain visible');

const authoritative = authoritativeShareJobNotification({
  id: 'job-1', user_id: 'user-1', status: 'completed',
  notification_status: 'sending', notification_payload: payload,
});
assert.equal(authoritative?.jobId, 'job-1');
assert.equal(authoritative?.payload.data.jobId, 'job-1');
assert.equal(authoritativeShareJobNotification({
  id: 'job-1', user_id: 'user-1', status: 'processing_metadata',
  notification_status: 'sending', notification_payload: payload,
}), null);
assert.equal(authoritativeShareJobNotification({
  id: 'job-1', user_id: 'user-1', status: 'completed',
  notification_status: 'submitted', notification_payload: payload,
}), null, 'submitted notifications cannot send twice');
assert.equal(authoritativeShareJobNotification({
  id: 'job-1', user_id: 'user-1', status: 'completed',
  notification_status: 'sending', notification_payload: { ...payload, data: { ...payload.data, jobId: 'job-2' } },
}), null, 'payload identity must match the authoritative row');

const worker = fs.readFileSync(
  path.resolve(__dirname, '../supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
assert.match(worker, /if \(response\.ok\) \{[\s\S]*?await processPendingNotifications\(admin, 25\);[\s\S]*?\}/);
assert.match(worker, /notification_dispatch_started/);
assert.match(worker, /notification_submitted/);

console.log('PASS event-driven notification dispatch, authoritative-state guard, idempotency, and foreground policy');
