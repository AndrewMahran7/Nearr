import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
const activation = read('components/onboarding/v2/OnboardingV2Activation.tsx');
const immersive = read('components/onboarding/v2/ImmersiveGuidedSave.tsx');
const visuals = read('components/onboarding/v2/Phase1Visuals.tsx');
const combined = preAuth + '\n' + activation + '\n' + immersive;

function pass(label: string) {
  console.log('PASS ' + label);
}

// A small, branded visual system owns Phase 1 without changing shared Phase 2/3 surfaces.
assert.match(visuals, /orange: '#FF6A1A'/);
assert.match(visuals, /export function Phase1Frame/);
assert.match(visuals, /export function Phase1Progress/);
assert.match(visuals, /export function Phase1Prompt/);
assert.match(visuals, /accessibilityRole="progressbar"/);
assert.match(visuals, /width: 44,[\s\S]{0,120}height: 44/);
pass('Phase 1 uses the production palette, shared frame, coach mark, and accessible progress');

// Setup is media-led and compact instead of a stack of giant form cards.
assert.match(preAuth, /<WelcomeProductHero \/>/);
assert.match(preAuth, /Spot it\. Save it\. Go\./);
assert.match(preAuth, /<InterestTile/);
assert.match(preAuth, /<PracticePostHero/);
assert.match(preAuth, /Start with \$\{shellPlatform\}/);
assert.match(preAuth, /personalizedSavePrompt/);
assert.doesNotMatch(preAuth, /platformCard|interestRow|stayCard|valueRow/);
pass('Welcome, source, category, and tutorial-ready states use the new media-led hierarchy');

// Guidance stays attached to the one action that matters on each screen.
for (const prompt of [
  'Tap Share',
  'Share to…',
  'Choose Nearr',
  'Tap +',
]) {
  assert.ok(immersive.includes(prompt), 'missing contextual prompt: ' + prompt);
}
assert.doesNotMatch(combined, /LEARN[^\n]{0,20}OF\s+\d/i);
pass('guided steps have contextual prompts and no numbered task counter');

assert.match(activation, /<ImmersiveGuidedSave/);
assert.doesNotMatch(immersive, /<Phase1Frame/);
assert.match(immersive, /accessibilityRole="progressbar"/);
assert.match(immersive, /sheets transform over the same Reel underneath/);
pass('durable tutorial checkpoints render inside one immersive simulation shell');

assert.match(preAuth, /numberOfLines=\{1\}/);
assert.match(preAuth, /platformRow: \{ flexDirection: 'row', gap: 10 \}/);
assert.doesNotMatch(preAuth, /platformChoice: \{ width: '48%'/);
pass('source cards use balanced responsive rows and single-line labels');

// Production onboarding must not expose internal test language or unnecessary tutorial prose.
for (const copy of [
  'verified test library',
  'This is interactive and stays completely inside Nearr',
  'This one-time step keeps Nearr',
  'We will shape the practice screen',
  'Pick one. Nearr will choose',
]) {
  assert.equal(combined.includes(copy), false, 'copy should be removed: ' + copy);
}
pass('implementation vocabulary and redundant instructional copy are absent');

// The payoff is deliberately found-before-saved. The real mutation is still behind the CTA.
const resultStart = activation.indexOf("if (stage === 'tutorial_result_seen')");
const resultEnd = activation.indexOf("stage === 'tutorial_ready'", resultStart);
assert.ok(resultStart > -1 && resultEnd > resultStart, 'result branch exists');
const resultBranch = activation.slice(resultStart, resultEnd);
assert.match(resultBranch, /<FoundPlaceHero/);
assert.match(resultBranch, /MATCHED BY VAYRIN/);
assert.match(resultBranch, /title="Save to my map" onPress=\{\(\) => void savePlace\(\)\}/);
assert.doesNotMatch(resultBranch, /OnboardingSavedPlacePreview|>Saved<|Saved badge/);
assert.match(activation, /await saveOnboardingV2TutorialPlace\(content\)/);
pass('the result is Found until the explicit authoritative save CTA');

// No motion dependency or final media asset is smuggled into this visual pass.
assert.doesNotMatch(combined, /Animated\.|react-native-reanimated|expo-linear-gradient/);
assert.doesNotMatch(combined, /from ['"]react-native['"][\s\S]{0,80}\bImage\b/);
pass('the visual pass remains compatible with the later motion and final-assets tickets');

console.log('\nAll Onboarding V2 Phase 1 visual contracts passed.');
