import assert from 'node:assert/strict';

import { openSession } from './e2e/session';

async function run(): Promise<void> {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  assert.ok(session.identity);
  const observed: Array<Record<string, unknown>> = [];
  try {
    for (const preferredPlatform of ['instagram', 'youtube', 'tiktok'] as const) {
      const response: Response = await fetch(`${session.config.supabaseUrl}/functions/v1/get-onboarding-tutorial`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.identity.accessToken}`,
          apikey: session.config.anonKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ preferredPlatform }),
      });
      const fixture = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200, `${preferredPlatform} fixture request failed`);
      assert.equal(typeof fixture.thumbnailUrl, 'string', `${preferredPlatform} selection returned no source preview`);
      const previewUrl = new URL(String(fixture.thumbnailUrl));
      const previewResponse = await fetch(previewUrl, { headers: { accept: 'image/*' } });
      const contentType = previewResponse.headers.get('content-type') ?? '';
      const bytes = (await previewResponse.arrayBuffer()).byteLength;
      assert.equal(previewResponse.ok, true, `${preferredPlatform} preview request failed`);
      assert.match(contentType, /^image\//, `${preferredPlatform} preview is not an image`);
      assert.ok(bytes > 1_000, `${preferredPlatform} preview image is unexpectedly empty`);
      observed.push({
        requestedPlatform: preferredPlatform,
        selectedPlatform: fixture.platform,
        exactPlatform: fixture.platform === preferredPlatform,
        previewHost: previewUrl.hostname,
        contentType,
        bytes,
      });
    }

    const [{ count: jobCount, error: jobError }, { count: saveCount, error: saveError }] = await Promise.all([
      session.admin.from('share_jobs').select('*', { count: 'exact', head: true }).eq('user_id', session.identity.userId),
      session.admin.from('saved_places').select('*', { count: 'exact', head: true }).eq('user_id', session.identity.userId),
    ]);
    if (jobError || saveError) throw jobError ?? saveError;
    assert.deepEqual([jobCount, saveCount], [0, 0], 'preview proof must not create a share job or save');
    console.log(JSON.stringify({ result: 'PASS', target: session.config.supabaseRef, observed, shareJobs: jobCount, savedPlaces: saveCount }, null, 2));
  } finally {
    const cleanup = await session.cleanup();
    if (cleanup.errors.length > 0) throw new Error(`preview_proof_cleanup_failed:${cleanup.errors.join('|')}`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
