// Exact-owner, Development-only revocation probe. No JWT/key/UUID is printed.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEARR_TEST_SUPABASE_URL;
const key = process.env.NEARR_TEST_PUBLIC_ANON_KEY;
if (url !== 'https://qnfxnmvxpjzfydgudtvs.supabase.co' || !key?.startsWith('sb_publishable_')) {
  throw new Error('explicit Nearr-Dev public client configuration required');
}
const cli = path.join(process.cwd(), '.tmp', 'supabase-cli-2102', 'node_modules', '.bin', 'supabase.cmd');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
let token = null;
const results = [];
try {
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user?.id || !data.session?.access_token) throw new Error('synthetic sign-in failed');
  token = data.session.access_token;
  const userId = data.user.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error('unexpected synthetic ID');
  const declared = await client.rpc('declare_age_eligibility_18_plus', { p_at_least_18: true });
  if (declared.error || declared.data !== 'adult_self_declared') throw new Error('adult declaration failed');
  results.push({ check: 'adult declaration', pass: true });

  const sql = `update public.account_age_eligibility set status='revoked' where user_id='${userId}'::uuid and status='adult_self_declared' returning status`;
  const command = `& '${cli}' db query --linked --output json \"${sql}\"`;
  const changed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  if (changed.status !== 0 || !/"status"\s*:\s*"revoked"/.test(changed.stdout ?? '')) throw new Error('exact synthetic Dev revocation failed');
  results.push({ check: 'exact-owner Dev revocation', pass: true });

  for (const route of ['process-share-link', 'create-share-job']) {
    const response = await fetch(`${url}/functions/v1/${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.instagram.com/reel/nearrrynthetic000000000/' }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => ({}));
    const pass = response.status === 403 && JSON.stringify(body).includes('age_eligibility_required');
    results.push({ check: `revoked ${route}`, status: response.status, pass });
    if (!pass) throw new Error(`revoked ${route} not denied`);
  }
} finally {
  if (token) {
    try {
      const response = await fetch(`${url}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, apikey: key, 'content-type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(30000),
      });
      const body = await response.json().catch(() => ({}));
      results.push({ check: 'synthetic cleanup', status: response.status, pass: response.ok && body.ok === true });
    } catch { results.push({ check: 'synthetic cleanup', pass: false }); }
  }
  console.log(JSON.stringify({ scope: 'Nearr-Dev synthetic only', results }, null, 2));
  if (results.some((item) => !item.pass)) process.exitCode = 1;
}
