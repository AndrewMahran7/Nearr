import assert from 'node:assert/strict';

import {
  createShareJob,
  DEFAULT_SHARE_JOB_TIMEOUT_MS,
} from '../lib/shareJobClient';
import { reconcileDurableShareAcceptance } from '../lib/shareHandoffAcceptance';

const originalFetch = globalThis.fetch;

async function runWithResponse(response: Response) {
  globalThis.fetch = async () => response;
  return createShareJob({
    endpoint: 'https://development.example/functions/v1/create-share-job',
    url: 'https://www.instagram.com/reel/regression/',
    accessToken: 'test-token',
    clientRequestId: 'share_regression_12345678',
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acceptedResponse(duplicate = false): Response {
  return new Response(
    JSON.stringify({ jobId: 'job-1', status: 'queued', duplicate }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function main() {
  try {
    assert.equal(DEFAULT_SHARE_JOB_TIMEOUT_MS, 10_000);

    const accepted = await runWithResponse(acceptedResponse());
    assert.deepEqual(accepted, {
      ok: true,
      jobId: 'job-1',
      status: 'queued',
      duplicate: false,
      requiresPurchase: false,
      availableUses: null,
    });

    const duplicate = await runWithResponse(acceptedResponse(true));
    assert.deepEqual(duplicate, {
      ok: true,
      jobId: 'job-1',
      status: 'queued',
      duplicate: true,
      requiresPurchase: false,
      availableUses: null,
    });

    // A slow response that arrives before the network deadline is accepted.
    globalThis.fetch = (async () => {
      await delay(20);
      return acceptedResponse();
    }) as typeof fetch;
    const slowAccepted = await createShareJob({
      endpoint: 'https://development.example/functions/v1/create-share-job',
      url: 'https://www.instagram.com/reel/slow-success/',
      accessToken: 'test-token',
      timeoutMs: 80,
    });
    assert.equal(slowAccepted.ok, true);

    // Once fetch has delivered the HTTP response, its old deadline must be
    // cancelled. Simulate slow local JSON parsing that crosses that deadline;
    // a stale abort must neither reject parsing nor overwrite success.
    const responseSignal: { current: AbortSignal | null } = { current: null };
    globalThis.fetch = (async (_input, init) => {
      responseSignal.current = init?.signal as AbortSignal;
      const signal = responseSignal.current;
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        json: () =>
          new Promise((resolve, reject) => {
            const bodyTimer = setTimeout(
              () => resolve({ jobId: 'job-after-parse', status: 'queued', duplicate: false }),
              25,
            );
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(bodyTimer);
                reject(new Error('response parsing aborted'));
              },
              { once: true },
            );
          }),
      } as Response;
    }) as typeof fetch;
    const acceptedAfterSlowParse = await createShareJob({
      endpoint: 'https://development.example/functions/v1/create-share-job',
      url: 'https://www.instagram.com/reel/stale-timeout/',
      accessToken: 'test-token',
      timeoutMs: 10,
    });
    await delay(15);
    assert.equal(acceptedAfterSlowParse.ok, true);
    assert.equal(responseSignal.current?.aborted, false);

    // A request for which no HTTP response arrives still terminates. React
    // Native may report the abort as TypeError("Network request failed"), so
    // the aborted signal—not the thrown error class—must classify the timeout.
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener(
          'abort',
          () => reject(new TypeError('Network request failed')),
          { once: true },
        );
      })) as typeof fetch;
    const trueTimeout = await createShareJob({
      endpoint: 'https://development.example/functions/v1/create-share-job',
      url: 'https://www.instagram.com/reel/true-timeout/',
      accessToken: 'test-token',
      timeoutMs: 10,
    });
    assert.deepEqual(trueTimeout, { ok: false, reason: 'timeout' });

    // The physical failure: the request times out locally after the server has
    // persisted the same clientRequestId. Durable presence is terminal success.
    let reconciledKey = '';
    const reconciledTimeout = await reconcileDurableShareAcceptance({
      result: trueTimeout,
      clientRequestId: 'u_laowvc',
      findByClientRequestId: async (key) => {
        reconciledKey = key;
        return { id: 'server-job-uuid', status: 'queued' };
      },
    });
    assert.equal(reconciledKey, 'u_laowvc');
    assert.deepEqual(reconciledTimeout, {
      ok: true,
      jobId: 'server-job-uuid',
      status: 'queued',
      duplicate: true,
      requiresPurchase: false,
      availableUses: null,
    });

    // A true pre-acceptance timeout remains a safe failure when no durable row
    // exists, and lookup errors do not create false success.
    const unreconciledTimeout = await reconcileDurableShareAcceptance({
      result: trueTimeout,
      clientRequestId: 'u_not_created',
      findByClientRequestId: async () => null,
    });
    assert.deepEqual(unreconciledTimeout, trueTimeout);
    const lookupFailure = await reconcileDurableShareAcceptance({
      result: trueTimeout,
      clientRequestId: 'u_lookup_failed',
      findByClientRequestId: async () => {
        throw new Error('offline');
      },
    });
    assert.deepEqual(lookupFailure, trueTimeout);

    const missingJobId = await runWithResponse(
      new Response(JSON.stringify({ status: 'queued' }), {
        status: 200,
        headers: { 'sb-request-id': 'request-regression-1234' },
      }),
    );
    assert.deepEqual(missingJobId, {
      ok: false,
      reason: 'invalid_response',
      httpStatus: 200,
      responseErrorCode: 'missing_job_id',
      requestId: 'request-regression-1234',
    });

    const serverFailure = await runWithResponse(
      new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'x-request-id': 'request-regression-5678' },
      }),
    );
    assert.deepEqual(serverFailure, {
      ok: false,
      reason: 'http_error',
      httpStatus: 500,
      responseErrorCode: 'create_failed',
      requestId: 'request-regression-5678',
    });

    const unauthorized = await runWithResponse(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    assert.deepEqual(unauthorized, {
      ok: false,
      reason: 'unauthorized',
      httpStatus: 401,
      responseErrorCode: 'unauthorized',
      requestId: undefined,
    });

    // Definite protocol failures must never be reclassified by a queue lookup.
    let definiteFailureLookups = 0;
    for (const result of [missingJobId, serverFailure, unauthorized]) {
      const preserved = await reconcileDurableShareAcceptance({
        result,
        clientRequestId: 'u_definite_failure',
        findByClientRequestId: async () => {
          definiteFailureLookups += 1;
          return { id: 'must-not-be-used' };
        },
      });
      assert.deepEqual(preserved, result);
    }
    assert.equal(definiteFailureLookups, 0);

    // A native network error after dispatch is indeterminate in the same way
    // as a deadline; a matching durable row proves acceptance.
    const reconciledNetwork = await reconcileDurableShareAcceptance({
      result: { ok: false, reason: 'network' },
      clientRequestId: 'u_network_ack_lost',
      findByClientRequestId: async () => ({ id: 'network-job', status: 'completed' }),
    });
    assert.deepEqual(reconciledNetwork, {
      ok: true,
      jobId: 'network-job',
      status: 'completed',
      duplicate: true,
      requiresPurchase: false,
      availableUses: null,
    });

    console.log('PASS create-share-job response contract, timer lifecycle, and sanitized diagnostics');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exit(1);
});
