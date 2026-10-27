// Read-only served-manifest verification. Never print client API keys/config.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [platform, expectedUpdate] = process.argv.slice(2);
assert.ok(['ios', 'android'].includes(platform));
assert.match(expectedUpdate || '', /^[0-9a-f-]{36}$/);
const runtime = platform === 'ios' ? '1.7-onboarding-date-v1' : '1.7-onboarding-date-android-v2';
const response = await fetch('https://u.expo.dev/2ec7a08a-2078-4232-a244-c9d16fb75ffe', {
  headers: { 'expo-platform': platform, 'expo-runtime-version': runtime,
    'expo-channel-name': 'development', 'expo-protocol-version': '1',
    accept: 'application/expo+json,application/json,multipart/mixed' },
});
assert.equal(response.status, 200);
const raw = await response.text();
let manifest;
if (response.headers.get('content-type')?.includes('multipart')) {
  const boundary = response.headers.get('content-type').match(/boundary="?([^";]+)/)?.[1];
  const part = raw.split('--' + boundary).find(part => /name="manifest"/.test(part));
  assert.ok(part);
  manifest = JSON.parse(part.slice(part.indexOf('\r\n\r\n') + 4).trim());
} else manifest = JSON.parse(raw);
const extra = manifest.extra.expoClient.extra;
assert.equal(manifest.id, expectedUpdate);
assert.equal(manifest.runtimeVersion, runtime);
assert.equal(extra.appEnv, 'development');
assert.equal(extra.backendEnv, 'development');
assert.equal(extra.supabaseUrl, 'https://qnfxnmvxpjzfydgudtvs.supabase.co');
const result = { checkedAt: new Date().toISOString(), platform, channel: 'development',
  updateId: manifest.id, runtime, appEnv: extra.appEnv, backendEnv: extra.backendEnv,
  supabaseHost: new URL(extra.supabaseUrl).host, assetCount: manifest.assets.length,
  launchAssetPresent: !!manifest.launchAsset?.url };
writeFileSync(`artifacts/global-release/android-qualification/served-update-${platform}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
