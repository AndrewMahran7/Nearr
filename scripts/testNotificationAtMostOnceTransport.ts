import assert from 'node:assert/strict';
import { shareJobNotificationLogicalId } from '../lib/shareJobNotificationIdentity';
import {
  checkExpoReceipts,
  preparePushToUser,
  submitPreparedPush,
} from '../supabase/functions/process-share-jobs/push';

const job = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const saved = shareJobNotificationLogicalId(job, 'completed');
assert.equal(saved, shareJobNotificationLogicalId(job, 'completed'));
assert.notEqual(saved, shareJobNotificationLogicalId(job, 'needs_help'));
assert.notEqual(saved, shareJobNotificationLogicalId(other, 'completed'));
assert.ok(Buffer.byteLength(saved) <= 64);
assert.notEqual(saved, `nearby:${job}`);
const note = { title: 'Saved', body: 'Ready', data: { jobId: job, type: 'share_job_completed' } };
const tokens = [{ id: 'token-row-1', token: 'ExponentPushToken[test]' }];
const admin = {
  from: (_table: string) => ({
    select: (_fields: string) => ({ eq: (_column: string, _value: unknown) => ({
      eq: async () => ({ data: tokens, error: null }),
    }) }),
    update: (_patch: unknown) => ({ eq: async () => ({ error: null }) }),
  }),
};

async function main(): Promise<void> {
  const preSendQueryError = { from: () => ({ select: () => ({ eq: () => ({
    eq: async () => ({ data: null, error: { message: 'DB unavailable' } }),
  }) }) }) };
  assert.deepEqual(await preparePushToUser(preSendQueryError, 'user', note, saved), {
    status: 'retryable_pre_send', errorCode: 'token_query_failed',
  });
  assert.deepEqual(await preparePushToUser({ ...admin, from: () => ({
    select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }) }, 'user', note, saved), { status: 'permanently_failed', errorCode: 'no_enabled_tokens' });

  const preparation = await preparePushToUser(admin, 'user', note, saved);
  assert.equal(preparation.status, 'ready');
  if (preparation.status !== 'ready') throw new Error('preparation missing');
  assert.equal(preparation.prepared.messages[0]?.collapseId, saved);
  assert.equal(preparation.prepared.messages[0]?.tag, saved);

  let sendCalls = 0;
  const successFetch = async (_url: unknown, init: RequestInit) => {
    sendCalls += 1;
    assert.equal(JSON.parse(String(init.body))[0].collapseId, saved);
    return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 });
  };
  const sent = await submitPreparedPush(admin, preparation.prepared, 'attempt-1', successFetch as typeof fetch);
  assert.equal(sent.status, 'submitted');
  assert.equal(sent.ticketRefs[0]?.logicalId, saved);
  assert.equal(sent.ticketRefs[0]?.attemptId, 'attempt-1');
  assert.equal(sendCalls, 1);

  const lostResponse = async () => { throw new TypeError('Network request failed after acceptance'); };
  const unknown = await submitPreparedPush(admin, preparation.prepared, 'attempt-2', lostResponse as typeof fetch);
  assert.equal(unknown.status, 'delivery_unknown');
  assert.equal(unknown.ticketRefs.length, 0);
  const serviceFailure = await submitPreparedPush(admin, preparation.prepared, 'attempt-3',
    (async () => new Response('Unavailable', { status: 503 })) as typeof fetch);
  assert.equal(serviceFailure.status, 'delivery_unknown');
  const rejected = await submitPreparedPush(admin, preparation.prepared, 'attempt-4',
    (async () => new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'MessageTooBig' } }] }), { status: 200 })) as typeof fetch);
  assert.equal(rejected.status, 'permanently_failed');

  const receiptUrls: string[] = [];
  const receipt = await checkExpoReceipts(admin, sent.ticketRefs,
    (async (url: unknown) => {
      receiptUrls.push(String(url));
      return new Response(JSON.stringify({ data: { 'ticket-1': { status: 'ok' } } }), { status: 200 });
    }) as typeof fetch);
  assert.equal(receipt.hadAnySuccess, true);
  assert.equal(receipt.allPermanentFailures, false);
  assert.equal(receiptUrls.length, 1);
  assert.match(receiptUrls[0]!, /getReceipts$/);
  const mixed = await checkExpoReceipts(admin, [
    { ticketId: 'ticket-1', tokenId: 'token-row-1' },
    { ticketId: 'ticket-2', tokenId: 'token-row-2' },
  ], (async () => new Response(JSON.stringify({ data: {
    'ticket-1': { status: 'ok' },
  } }), { status: 200 })) as typeof fetch);
  assert.equal(mixed.errorCode, 'expo_receipts_partial_retryable');
  assert.equal(mixed.allPermanentFailures, false);
  console.log('PASS notification logical identity, collapse/tag, pre-send failure, ticket provenance, ambiguous send, explicit rejection, receipt-only read');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
