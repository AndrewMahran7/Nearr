/**
 * scripts/testProcessShareLink.ts
 *
 * Smoke-test the `process-share-link` Edge Function end-to-end.
 *
 * Usage:
 *   ts-node --project scripts/tsconfig.json scripts/testProcessShareLink.ts \
 *     --url "https://www.tiktok.com/@user/video/12345" \
 *     [--token "<supabase-access-token>"]
 *
 * Env (either set or pass --endpoint):
 *   PROCESS_SHARE_LINK_URL=https://<ref>.functions.supabase.co/process-share-link
 *
 * Notes:
 *   - Without a valid --token the function will return
 *     { status: 'open_app', reason: 'missing_auth' } (or 'invalid_auth').
 *   - To get a token quickly: sign in via the Expo app, then in the JS
 *     console run `supabase.auth.getSession()` and copy `access_token`.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg('url');
  const token = arg('token');
  const endpoint =
    arg('endpoint') ??
    process.env.PROCESS_SHARE_LINK_URL ??
    process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL;

  if (!url) {
    console.error('Missing --url');
    process.exit(2);
  }
  if (!endpoint) {
    console.error('Missing --endpoint or PROCESS_SHARE_LINK_URL env');
    process.exit(2);
  }

  console.log('[test] POST', endpoint);
  console.log('[test] url:', url);
  console.log('[test] token:', token ? '<provided>' : '<none>');

  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url, accessToken: token }),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  console.log(`[test] HTTP ${res.status} in ${ms}ms`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((err) => {
  console.error('[test] failed', err);
  process.exit(1);
});
