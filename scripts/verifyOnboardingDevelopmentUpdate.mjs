// Read the actual served manifest for the verified iOS native runtime. Never
// dump app config wholesale: it includes client API keys that do not belong in QA logs.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const expectedUpdate = process.argv[2];
assert.match(expectedUpdate || '', /^[0-9a-f-]{36}$/);
const response = await fetch('https://u.expo.dev/2ec7a08a-2078-4232-a244-c9d16fb75ffe', {
  headers: { 'expo-platform': 'ios', 'expo-runtime-version': '1.7-onboarding-date-v1',
    'expo-channel-name': 'development', 'expo-protocol-version': '1', accept: 'application/expo+json,application/json,multipart/mixed' },
});
assert.equal(response.status, 200);
const raw = await response.text();
let manifest;
if (response.headers.get('content-type')?.includes('multipart')) {
  const boundary = response.headers.get('content-type').match(/boundary="?([^";]+)/)?.[1];
  const part = raw.split('--' + boundary).find(part => /name="manifest"/.test(part));
  assert.ok(part, 'manifest part present');
  manifest = JSON.parse(part.slice(part.indexOf('\r\n\r\n') + 4).trim());
} else manifest = JSON.parse(raw);
const extra = manifest.extra.expoClient.extra;
assert.equal(manifest.id, expectedUpdate);
assert.equal(manifest.runtimeVersion, '1.7-onboarding-date-v1');
assert.equal(extra.appEnv, 'development');
assert.equal(extra.backendEnv, 'development');
assert.equal(extra.supabaseUrl, 'https://qnfxnmvxpjzfydgudtvs.supabase.co');
const result = { checkedAt: new Date().toISOString(), updateId: manifest.id,
  runtimeVersion: manifest.runtimeVersion, platform: 'ios', channel: 'development',
  appEnv: extra.appEnv, backendEnv: extra.backendEnv, supabaseHost: new URL(extra.supabaseUrl).host,
  assetCount: manifest.assets.length, launchAssetPresent: !!manifest.launchAsset?.url };
writeFileSync('artifacts/global-release/onboarding-integration/served-update-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
