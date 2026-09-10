import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
const core = read('lib/onboardingV2Core.ts');
const secondHalf = read('components/onboarding/v2/OnboardingV2SecondHalf.tsx');
const visuals = read('components/onboarding/v2/Phase1Visuals.tsx');
const account = read('app/(onboarding)/account.tsx');
const map = read('app/(tabs)/map.tsx');

assert.match(visuals, /orange: '#FF6A1A'/);
assert.match(visuals, /accessibilityRole="progressbar"/);
assert.match(visuals, /<ScrollView/);
console.log('PASS shared onboarding frame preserves accessible progress and large-text scrolling');

assert.match(preAuth, /WHAT USUALLY HAPPENS NEXT/);
assert.match(preAuth, /selectedInterests\.length === 0 \|\| !state\.painPoint/);
assert.match(preAuth, /Find this place/);
assert.match(preAuth, /hostShareSubmitter\.submit/);
assert.match(core, /tutorial-in-app:/);
assert.doesNotMatch(preAuth, /Show me how|Add to my map/);
console.log('PASS compact personalization leads directly to the real in-app job');

assert.match(preAuth, /NEARR • VERIFIED EXAMPLE/);
assert.match(preAuth, /exactPlatform && fixture\.thumbnailUrl/);
assert.doesNotMatch(preAuth, /InstagramReelMock|fake social/i);
console.log('PASS platform mismatch uses neutral Nearr framing rather than fake social UI');

assert.match(preAuth, /FOUND • SAVED TO YOUR MAP/);
assert.match(preAuth, /Social apps save the video\. Nearr saves the place/);
assert.match(preAuth, /AccessibilityInfo\.isReduceMotionEnabled/);
assert.match(preAuth, /Saved automatically/);
console.log('PASS reveal, save proof, Why Nearr, celebration, and Reduce Motion are integrated');

assert.match(secondHalf, /Share a post straight to Nearr/);
assert.match(secondHalf, /ShareStep icon="share-2"/);
assert.match(secondHalf, /Foreground access only during onboarding/);
assert.doesNotMatch(secondHalf, /requestOnboardingBackgroundLocation/);
assert.match(secondHalf, /Notifications make nearby discoveries useful later/);
console.log('PASS post-reveal share lesson and benefit-led foreground/notification education are present');

assert.match(account, /Continue with Apple|AppleAuthenticationButton/);
assert.match(account, /GoogleSignInButton/);
assert.match(account, /More options/);
assert.match(secondHalf, /Phase1PrimaryButton title="Explore my map"/);
assert.match(secondHalf, /Find another on/);
console.log('PASS auth and final activation have the approved first-glance hierarchy');

assert.match(map, /cleanOnboardingLanding = placeSource === 'onboarding_tutorial'/);
assert.match(map, /__DEV__ && !cleanOnboardingLanding/);
assert.match(map, /!cleanOnboardingLanding && !searchVisible/);
console.log('PASS first map landing suppresses diagnostics and queue chrome without global removal');

console.log('\nAll Onboarding V2 founder-polish visual contracts passed.');
