// Development-only live contract probe. Creates and deletes synthetic anonymous
// accounts; never prints JWTs, user IDs, public keys, or response bodies.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEARR_TEST_SUPABASE_URL;
const key = process.env.NEARR_TEST_PUBLIC_ANON_KEY;
if (!url?.includes('qnfxnmvxpjzfydgudtvs') || !key) throw new Error('explicit Dev URL/public key required');

const statuses = [];
async function test(name, token, route, body, expectedStatus, expectedCode) {
  const response = await fetch(`${url}/functions/v1/${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  const actualCode = data.error ?? data.reason ?? data.diagnostics?.reason ?? null;
  const pass = response.status === expectedStatus && (expectedCode === null || JSON.stringify(data).includes(expectedCode));
  statuses.push({ name, status: response.status, code: actualCode, pass });
  if (!pass) throw new Error(`${name}: status=${response.status} code=${actualCode ?? 'none'}`);
}

const clients = [];
const syntheticUrl = 'https://www.instagram.com/reel/nearrrynthetic000000000/';
try {
  const api = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await test('legacy unauthenticated', key, 'process-share-link', { url: syntheticUrl }, 401, null);
  await test('job unauthenticated', key, 'create-share-job', { url: syntheticUrl }, 401, null);

  for (const state of ['undeclared', 'under18', 'adult']) {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.session?.access_token) throw new Error(`anonymous sign-in failed for ${state}: ${error?.message ?? 'missing session'}`);
    const token = data.session.access_token;
    clients.push({ token, state });
    if (state !== 'undeclared') {
      const { data: decision, error: decisionError } = await client.rpc('declare_age_eligibility_18_plus', { p_at_least_18: state === 'adult' });
      if (decisionError || decision !== (state === 'adult' ? 'adult_self_declared' : 'under_18')) throw new Error(`age declaration failed for ${state}: ${decisionError?.code ?? decision ?? 'unknown'}`);
    }
    if (state !== 'adult') {
      await test(`${state} legacy`, token, 'process-share-link', { url: syntheticUrl }, 403, 'age_eligibility_required');
      await test(`${state} queued`, token, 'create-share-job', { url: syntheticUrl }, 403, 'age_eligibility_required');
    } else {
      // Invalid URL proves age check passed but cannot enqueue or invoke a provider.
      await test('adult queued passes age gate', token, 'create-share-job', { url: 'invalid-url' }, 400, 'invalid_url');
      // The old 1.4-style synchronous shape still authenticates and passes age,
      // then fails at metadata for a reserved nonresolving domain, before AI.
      await test('adult legacy passes age gate', token, 'process-share-link', {
        url: 'https://nearr-age-qualification.invalid/reel/test',
        mode: 'save',
      }, 200, 'metadata_failed');
      const { error: changed } = await client.rpc('declare_age_eligibility_18_plus', { p_at_least_18: false });
      if (!changed || !String(changed.message).includes('age_decision_locked')) throw new Error('adult decision changed after declaration');
      statuses.push({ name: 'adult decision immutable', pass: true });
    }
  }
} finally {
  for (const { token, state } of clients) {
    try {
      const response = await fetch(`${url}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, apikey: key, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      statuses.push({ name: `cleanup ${state}`, status: response.status, pass: response.ok && data.ok === true });
    } catch {
      statuses.push({ name: `cleanup ${state}`, pass: false });
    }
  }
  console.log(JSON.stringify({ scope: 'Nearr-Dev synthetic only', results: statuses }, null, 2));
  if (statuses.some((r) => !r.pass)) process.exitCode = 1;
}
