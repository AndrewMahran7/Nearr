import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
const core = read('lib/onboardingV2Core.ts');
const secondHalf = read('components/onboarding/v2/OnboardingV2SecondHalf.tsx');
const frame = read('components/onboarding/v2/Phase1Visuals.tsx');
const visualLanguage = read('components/onboarding/v2/OnboardingVisualLanguage.tsx');
const account = read('app/(onboarding)/account.tsx');
const settings = read('app/(tabs)/settings.tsx');
const index = read('app/index.tsx');
const map = read('app/(tabs)/map.tsx');

assert.match(frame, /background: '#F7F4EE'/);
assert.match(frame, /orange: '#FF5B24'/);
assert.match(frame, /accessibilityRole="progressbar"/);
assert.match(frame, /<ScrollView/);
console.log('PASS bright shared frame preserves accessible progress and large-text scrolling');

assert.match(preAuth, /Where do you usually find places/);
assert.match(preAuth, /What do you save most/);
assert.match(preAuth, /Perfect/);
assert.match(preAuth, /continueOnboardingV2FromPersonalizedPayoff/);
assert.match(preAuth, /Practice sharing it/);
assert.match(preAuth, /hostShareSubmitter\.submit/);
assert.match(core, /tutorial-in-app:/);
assert.doesNotMatch(preAuth, /Show me how|Add to my map/);
console.log('PASS single-job setup screens lead through a personalized payoff to the real in-app job');

assert.match(preAuth, /A POST WORTH SAVING/);
assert.match(preAuth, /onboardingTutorialPreviewUrl/);
assert.match(preAuth, /onboarding-source-preview-fallback/);
assert.doesNotMatch(preAuth, /InstagramReelMock|fake social/i);
console.log('PASS platform mismatch uses neutral Nearr framing rather than fake social UI');

assert.match(preAuth, /1 PLACE FOUND/);
assert.match(preAuth, /Social apps save the video\. Nearr saves the place/);
assert.match(visualLanguage, /AccessibilityInfo\.isReduceMotionEnabled/);
assert.match(preAuth, /Saved to your map/);
assert.match(preAuth, /MagicScanner/);
console.log('PASS processing, progressive reveal, save proof, and Reduce Motion are integrated');

assert.match(secondHalf, /YOUR SAVES HAVE A HOME/);
assert.match(secondHalf, /original post, and directions together/);
assert.match(secondHalf, /Allow while using Nearr/);
assert.match(secondHalf, /requestOnboardingBackgroundLocation/);
assert.match(secondHalf, /Allow background location/);
assert.match(secondHalf, /MAKING NEARR YOURS/);
assert.match(secondHalf, /Your map works if you decline/);
console.log('PASS post-proof value, permission education, and truthful setup choreography are present');

assert.match(account, /Continue with Apple|AppleAuthenticationButton/);
assert.match(account, /GoogleSignInButton/);
assert.match(account, /Back up your map/);
assert.match(secondHalf, /Phase1PrimaryButton title="Explore my map"/);
assert.match(secondHalf, /Practice with the selected/);
assert.match(secondHalf, /No account setup is needed to explore them/);
assert.match(settings, /Back up your map/);
assert.match(index, /stage === 'onboarding_complete'/);
console.log('PASS final activation enters the anonymous map and defers account backup to Settings');

assert.match(map, /cleanOnboardingLanding = placeSource === 'onboarding_tutorial'/);
assert.match(map, /__DEV__ && !cleanOnboardingLanding/);
assert.match(map, /!searchVisible && !nearbyExplorer/);
assert.doesNotMatch(map, /!cleanOnboardingLanding && !searchVisible/, 'guided entry no longer suppresses Queue');
console.log('PASS first map landing suppresses diagnostics while retaining Queue chrome');

console.log('\nAll Onboarding V2 Albo-parity presentation contracts passed.');
