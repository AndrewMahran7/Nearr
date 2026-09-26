import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sandboxFiles = [
  'components/onboarding/v2/OnboardingV2PreAuth.tsx',
  'components/onboarding/v2/ImmersiveGuidedSave.tsx',
  'components/onboarding/v2/OnboardingV2MapCoachmark.tsx',
  'onboarding/fixtures/offlineOnboardingFixtures.ts',
  'onboarding/assets/offlineOnboardingAssets.ts',
];
const sandbox = sandboxFiles.map((path) => `\n/* ${path} */\n${read(path)}`).join('\n');

const forbidden: Array<[string, RegExp]> = [
  ['Supabase client', /from ['"]@\/lib\/supabase['"]|supabase\./],
  ['share job client', /hostShareSubmitter|useOnboardingTutorialJobs|shareJobsService|create-share-job/],
  ['Google Places client', /PlaceImage|placesService|googlePlaceDetails|react-native-maps/],
  ['social fetch client', /onboardingTutorialPreviewUrl|loadActiveOnboardingTutorialFixture|loadOnboardingPracticeFixture|Linking\.openURL/],
  ['remote media URL', /source=\{\{\s*uri:|https?:\/\//],
  ['real save service', /savedPlacesService|saveSavedPlace/],
  ['worker API', /media-worker|process-share-jobs|Gemini|OpenAI/],
];
for (const [name, pattern] of forbidden) {
  assert.doesNotMatch(sandbox, pattern, `${name} is forbidden inside the onboarding sandbox`);
}

for (const copy of [
  'PRACTICE POST UNAVAILABLE',
  "The real practice post isn't ready",
  'Check your connection',
  'Try preview again',
  'Practice is unavailable',
]) {
  assert.equal(sandbox.includes(copy), false, `retired network UX is absent: ${copy}`);
}

const secondHalf = read('components/onboarding/v2/OnboardingV2SecondHalf.tsx');
const makingStart = secondHalf.indexOf('function MakingNearrYoursScreen');
const makingEnd = secondHalf.indexOf('function LegacyGrowingMapAdvance', makingStart);
const making = secondHalf.slice(makingStart, makingEnd);
assert.doesNotMatch(making, /syncProximityWatch|syncGeofencesForSavedPlaces|registerPushTokenForCurrentUser|prepareSavedPlacesForMapHandoff/);
assert.match(secondHalf.slice(makingEnd), /state\.stage !== 'auth_success'/, 'live reminder setup remains behind successful auth');

const adapter = read('lib/onboardingV2.ts');
assert.match(adapter, /const localSandbox = result\.state\.identityLifecycle === 'none'/);
assert.match(adapter, /if \(!localSandbox && result\.state\.boundUserId\)/);

console.log(`PASS onboarding sandbox import guard (${sandboxFiles.length} files)`);
console.log('PASS retired network/retry copy guard');
console.log('PASS pre-auth state persistence does not read or write Supabase');
console.log('PASS reminder/geofence networking begins only after auth_success');
