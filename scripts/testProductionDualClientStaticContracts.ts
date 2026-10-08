import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const release = 'ca08c154347096fe5da0bf2739cf0b25c0b706b0';
const embeddedLegacy = '627ad618d57c99faa280fb085e7b0692fc0bd58f';
const current = (name: string) => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
const at = (sha: string, name: string) => execFileSync('git', ['show', `${sha}:${name}`], { encoding: 'utf8' });
const candidate = (name: string) => at(release, name);

const oldProfile = current('services/profileService.ts');
const newProfile = candidate('services/profileService.ts');
assert.match(oldProfile, /id, email, notifications_enabled/);
assert.doesNotMatch(oldProfile, /\.select\('id, email, first_name/);
assert.match(at(embeddedLegacy, 'services/profileService.ts'), /id, email, notifications_enabled/);
assert.match(newProfile, /id, email, first_name, last_name, notifications_enabled/);
assert.match(newProfile, /providerNamePatch\(names\)/);
assert.match(newProfile, /if \(Object\.keys\(patch\)\.length === 0\) return/);

const oldTransfer = current('lib/anonymousOnboarding.ts');
const newTransfer = candidate('lib/anonymousOnboarding.ts');
assert.match(oldTransfer, /rpc\('begin_onboarding_account_transfer'/);
assert.match(oldTransfer, /rpc\('complete_onboarding_account_transfer'/);
assert.match(at(embeddedLegacy, 'lib/anonymousOnboarding.ts'), /rpc\('begin_onboarding_account_transfer'/);
assert.match(at(embeddedLegacy, 'lib/anonymousOnboarding.ts'), /rpc\('complete_onboarding_account_transfer'/);
assert.match(newTransfer, /rpc\('begin_onboarding_account_transfer_v2'/);
assert.match(newTransfer, /rpc\('complete_onboarding_account_transfer_v2'/);
assert.match(newTransfer, /rpc\('resume_completed_onboarding_account_transfer'/);
assert.match(newTransfer, /realSavedPlaceIds\(/);

for (const name of [
  'services/savedPlacesService.ts',
  'services/shareJobsService.ts',
  'lib/pushTokens.ts',
  'lib/onboardingV2.ts',
]) {
  assert.match(current(name), /supabase/);
  assert.match(candidate(name), /supabase/);
}

assert.match(current('lib/shareJobRouting.ts'), /if \(jobId\) return \{ kind: 'queue_item', jobId \}/);
assert.match(candidate('lib/shareJobRouting.ts'), /if \(jobId\) return \{ kind: 'queue_item', jobId \}/);
console.log('PASS static dual-client selectors and RPC names (not a live authenticated contract test)');
