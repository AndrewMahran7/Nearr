import assert from 'node:assert/strict';

import { createShareJob } from '../lib/shareJobClient';

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

async function main() {
  try {
    const accepted = await runWithResponse(
      new Response(JSON.stringify({ jobId: 'job-1', status: 'queued', duplicate: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    assert.deepEqual(accepted, {
      ok: true,
      jobId: 'job-1',
      status: 'queued',
      duplicate: false,
    });

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

    console.log('PASS create-share-job response contract and sanitized diagnostics');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exit(1);
});
