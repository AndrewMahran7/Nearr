import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_NOTICE_VERSION, allowAiSharing, consentRpc, revokeAiSharing } from '../lib/aiSharingConsent';

const prompt = readFileSync('components/AiSharePermissionPrompt.tsx', 'utf8');
const settings = readFileSync('components/ProcessingPermissionsSettings.tsx', 'utf8');
const privacy = readFileSync('app/legal/privacy.tsx', 'utf8');
const hostShare = readFileSync('app/share.tsx', 'utf8');

assert.match(prompt, /decodeJwtClaims\(value\.accessToken\)\?\.sub/);
assert.match(prompt, /decodeJwtClaims\(value\.accessToken\)\?\.sub !== owner\.current/);
assert.match(prompt, /generation\.current/);
assert.match(prompt, /onAuthStateChange/);
assert.match(prompt, /AppState\.addEventListener/);
assert.match(prompt, /await currentBoundTransport\(epoch\)/);
assert.match(prompt, /await allowAiSharing\(current\)/);
assert.match(settings, /currentSettingsTransport/);
assert.match(settings, /latest\.subject !== current\.subject/);
assert.match(settings, /consentRpc\(current\.transport, 'set_ai_sharing_permission'/);
assert.match(settings, /generation\.current/);
assert.match(hostShare, /get_my_global_access/);
assert.match(hostShare, /afterAccess\?\.user\.id !== beforeAccess\.user\.id/);
assert.match(privacy, /record_global_privacy_notice/);
assert.doesNotMatch(prompt, /record_global_privacy_notice/);
assert.doesNotMatch(settings, /record_global_privacy_notice/);

const calls: Array<{ url: string; authorization: string; body: unknown }> = [];
const originalFetch = global.fetch;
global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(input), authorization: String((init?.headers as Record<string, string>)?.authorization), body: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(JSON.stringify({ aiAllowed: true }), { status: 200 });
}) as typeof fetch;

async function main() {
  const first = { supabaseUrl: 'https://abc123.supabase.co', publicKey: 'public', accessToken: 'fresh-owner-a' };
  await consentRpc(first, 'get_my_global_access');
  await allowAiSharing(first);
  await revokeAiSharing({ ...first, accessToken: 'fresh-owner-a-rotated' });
  assert.deepEqual(calls.map(call => call.authorization), ['Bearer fresh-owner-a', 'Bearer fresh-owner-a', 'Bearer fresh-owner-a-rotated']);
  assert.deepEqual(calls[1].body, { p_allowed: true, p_notice_version: AI_NOTICE_VERSION });
  assert.deepEqual(calls[2].body, { p_allowed: false, p_notice_version: AI_NOTICE_VERSION });
  assert.equal(calls.some(call => call.url.includes('record_global_privacy_notice')), false);
  await assert.rejects(() => consentRpc({ supabaseUrl: 'http://invalid', publicKey: 'public', accessToken: 'token' }, 'get_my_global_access'), /consent_auth_required/);
  console.log('PASS consent identity: fresh bearer RPCs, host and extension account-change guards, stale async generations, withdrawal ownership, no invented privacy acknowledgment');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
