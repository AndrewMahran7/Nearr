import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source contracts for what the pre-auth onboarding TEACHES.
 *
 * These exist because the flow drifted away from the product: it used to ask
 * the user to tap a fake Save button, promise a fabricated "0.3 mi away" for a
 * Tokyo coffee shop, and end a screen titled "Saved to your map" with a
 * "Save your first place" CTA. Nearr now saves a post with one clear place by
 * itself, so onboarding must demonstrate that instead.
 *
 * Rendering these screens needs a device (Animated + AccessibilityInfo), so
 * these assertions read the source the way the other UI contract suites do.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** Comments explain the rules; assertions about behaviour must read code only. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const flow = read('app/(onboarding)/index.tsx');
const account = read('app/(onboarding)/account.tsx');
const card = read('components/onboarding/demo/FindingSavingCard.tsx');
const findingScreen = read('components/onboarding/screens/FindingSavingScreen.tsx');
const mapScreen = read('components/onboarding/screens/MapResultScreen.tsx');
const mapCard = read('components/onboarding/demo/DemoMapCard.tsx');
const valueProp = read('components/onboarding/screens/ValuePropScreen.tsx');
const tapShare = read('components/onboarding/screens/TapShareScreen.tsx');
const chooseNearr = read('components/onboarding/screens/ChooseNearrScreen.tsx');
const savedPreview = read('components/onboarding/OnboardingSavedPlacePreview.tsx');
const onboardingLib = read('lib/onboarding.ts');

/**
 * Every user-visible onboarding surface, for the copy bans below. Comments are
 * stripped: a comment explaining why "0.3 mi away" was removed is not copy.
 */
const allSurfaces: Array<[string, string]> = ([
  ['app/(onboarding)/index.tsx', flow],
  ['app/(onboarding)/account.tsx', account],
  ['components/onboarding/demo/FindingSavingCard.tsx', card],
  ['components/onboarding/demo/DemoMapCard.tsx', mapCard],
  ['components/onboarding/screens/FindingSavingScreen.tsx', findingScreen],
  ['components/onboarding/screens/MapResultScreen.tsx', mapScreen],
  ['components/onboarding/screens/ValuePropScreen.tsx', valueProp],
  ['components/onboarding/OnboardingSavedPlacePreview.tsx', savedPreview],
] as Array<[string, string]>).map(([path, source]) => [path, stripComments(source)]);

function noManualSaveInteraction() {
  const body = stripComments(card);
  assert.doesNotMatch(body, /Pressable/, 'the demo card has nothing to tap');
  assert.doesNotMatch(body, /onSave\b/, 'the manual onSave callback is gone');
  assert.doesNotMatch(body, /accessibilityRole="button"/, 'no button role remains on the card');
  assert.doesNotMatch(
    body,
    />\s*\{?saved \? 'Saved' : 'Save'/,
    'the Save/Saved toggle button is gone',
  );
  assert.doesNotMatch(
    stripComments(findingScreen),
    /Tap Save|onSave\b/,
    'the screen no longer instructs the user to tap Save',
  );
  assert.doesNotMatch(
    stripComments(flow),
    /handleSaveTap|onSave=/,
    'the flow no longer wires a manual save handler',
  );
}

function autoSaveSequence() {
  // finding → found → saved, as an explicit stage machine.
  assert.match(
    card,
    /type Stage = 'finding' \| 'found' \| 'saved'/,
    'the sequence has three named stages',
  );
  assert.match(card, /setStage\('found'\)/, 'it reaches the found stage');
  assert.match(card, /setStage\('saved'\)/, 'it reaches the saved stage by itself');
  assert.match(card, /onSavedRef\.current\?\.\(\)/, 'the saved stage reports completion');

  // Exact user-facing copy for each state.
  assert.match(card, /'Finding the place\.\.\.'/, "copy: 'Finding the place...'");
  assert.match(card, /'Found it'/, "copy: 'Found it'");
  assert.match(card, />Saved to your map</, "copy: 'Saved to your map'");

  // The demo place stays the example it always was.
  assert.match(card, /Allpress Espresso/);
  assert.match(card, /Coffee shop · Tokyo, Japan/);

  // Simulated only: no backend, no real row, no new animation dependency.
  assert.doesNotMatch(card, /supabase|savePlace|fetch\(|services\//i, 'the demo calls nothing real');
  const cardImports = card.match(/from '[^']+'/g) ?? [];
  for (const spec of cardImports) {
    assert.ok(
      /'(react|react-native|@expo\/vector-icons|\.\.\/theme)'/.test(spec),
      `the demo card must not pull in a new dependency: ${spec}`,
    );
  }
  assert.match(card, /Animated\.timing/, 'it animates with the react-native Animated API');
  assert.doesNotMatch(
    stripComments(flow),
    /supabase|savePlace|createSavedPlace/i,
    'onboarding must never write a demo place to a real account',
  );
}

function demoTimingIsFast() {
  const number = (name: string) => {
    const match = card.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(match, `${name} is defined`);
    return Number(match![1]);
  };
  const total = number('FIND_DURATION') + number('SAVE_DELAY');
  assert.ok(
    total <= 2500,
    `finding → saved must feel fast (instructional, not a simulation): ${total}ms`,
  );

  // Reduce Motion skips straight to the explained end state.
  assert.match(
    card,
    /if \(reduceMotion\) \{[\s\S]{0,240}settleOnSaved\(\);/,
    'Reduce Motion jumps to the saved state instead of animating',
  );
}

function statesAreReadableWithoutColour() {
  // Each stage is spelled out as text, not conveyed by a coloured check alone.
  assert.match(card, /\{found \? 'Found it' : 'Finding the place\.\.\.'\}/);
  assert.match(card, /accessibilityRole="progressbar"/, 'the progress bar has a role');
  assert.match(
    card,
    /accessibilityLabel=\{found \? 'Found it' : 'Finding the place'\}/,
    'the progress bar announces its state',
  );
  assert.match(
    card,
    /announceForAccessibility\('Found it'\)/,
    'reaching found is announced to screen readers',
  );
  assert.match(
    card,
    /announceForAccessibility\('Saved to your map'\)/,
    'reaching saved is announced to screen readers',
  );
  assert.match(card, /accessibilityLiveRegion="polite"/, 'the saved row is a live region');
}

function truthfulCopy() {
  // No fabricated user-relative distance anywhere in onboarding.
  for (const [path, source] of allSurfaces) {
    assert.doesNotMatch(
      source,
      /\d+(\.\d+)?\s?(mi|km|miles|kilometers)\b/i,
      `${path} must not fabricate a distance in onboarding`,
    );
    assert.doesNotMatch(
      source,
      /mi away|km away/i,
      `${path} must not fabricate a user-relative distance`,
    );
  }

  // What replaced it: the example's own city.
  assert.match(mapCard, /detail = 'Saved · Tokyo, Japan'/, 'the map card names the city');
  assert.match(valueProp, /Coffee shop · Tokyo/, 'the value-prop card names the city');

  // Confident, not absolute.
  for (const [path, source] of allSurfaces) {
    assert.doesNotMatch(
      source,
      /always finds|every post|guaranteed|never fails/i,
      `${path} must not promise a perfect match rate`,
    );
    assert.doesNotMatch(
      source,
      /multimodal|\bAI\b|machine learning|resolver|candidate|confidence|extraction/,
      `${path} must not explain the internals`,
    );
  }

  assert.match(findingScreen, /headline="Nearr finds the place"/, 'the headline is the benefit');
  assert.match(
    findingScreen,
    /When there's one clear place, Nearr saves it to your map for you\./,
    'the subtext is honest about which posts save themselves',
  );
}

function valuePropAndTutorialPreserved() {
  assert.match(
    valueProp,
    /headline="Turn places you see online into pins on your map"/,
    'the opening value proposition is unchanged',
  );
  // Category neutrality: not restaurant-only.
  assert.match(valueProp, /restaurant, hike, hotel, or coffee shop/, 'multiple categories remain');

  // One concrete sharing tutorial, with its orange interaction cues.
  assert.match(tapShare, /headline="See somewhere you want to go\?"/);
  assert.match(tapShare, /highlightShare/, 'the Share cue is still highlighted');
  assert.match(tapShare, /Share to…/, 'the Share to… step is still taught');
  assert.match(chooseNearr, /headline="Choose Nearr from the Share Sheet"/);
  assert.match(chooseNearr, /onNearrPress=\{handleNearr\}/, 'the Nearr tile is still the target');
  assert.match(chooseNearr, /Don&apos;t see Nearr\?/, 'the share-sheet help affordance is kept');
  assert.match(chooseNearr, /NearrFavoritesHelp/, 'the help sheet is still wired up');

  // The nearby-reminder concept survives without a fake distance.
  assert.match(mapCard, /Remind me when nearby/, 'proximity behaviour is still taught');

  // Still five screens — no new onboarding length.
  assert.match(flow, /const TOTAL_STEPS = 5;/, 'the flow is still five screens');
  const screenNames = flow.match(/const SCREEN_NAMES = \[([\s\S]*?)\] as const;/);
  assert.ok(screenNames, 'SCREEN_NAMES exists');
  for (const name of [
    'value_prop',
    'tap_share',
    'choose_nearr',
    'finding_saving',
    'map_result',
  ]) {
    assert.ok(screenNames![1].includes(name), `screen ${name} is preserved`);
  }
}

function finalCtaCreatesTheMap() {
  assert.match(
    flow,
    /<OnboardingPrimaryButton title="Create your map" onPress=\{handleCreateYourMap\} \/>/,
    'the final CTA is "Create your map"',
  );
  assert.doesNotMatch(flow, /Save your first place/, 'the contradictory final CTA is gone');
  // Screen 5 still shows the result the CTA follows on from.
  assert.match(mapScreen, /headline="Saved to your map"/);

  // Screen 4 has a way forward that is not a save.
  assert.match(
    flow,
    /<OnboardingPrimaryButton title="Continue" onPress=\{handleDemoContinue\} \/>/,
    'screen 4 advances with a neutral Continue CTA',
  );

  // The CTA leads to the real account/map, and marks only the DEMO complete.
  const finish = flow.slice(flow.indexOf('const handleCreateYourMap'));
  assert.match(finish, /markDemoCompleted\(\)/, 'finishing records the demo, not a save');
  assert.match(finish, /router\.push\('\/\(onboarding\)\/account'\)/, 'it routes to auth');
  assert.doesNotMatch(finish, /markOnboardingComplete/, 'the demo is not account onboarding');
}

function authContinuity() {
  assert.match(
    account,
    /anonymousOnboarding \? 'Keep your Nearr map' : 'Create your map'/,
    'auth preserves the legacy promise and uses preservation copy after the real tutorial',
  );
  assert.doesNotMatch(account, /Continue to Nearr/, 'no conflicting auth headline remains');
  assert.match(
    account,
    /We&apos;ll email you a secure sign-in link\. No password needed\./,
    'magic-link copy is consumer-facing',
  );
  assert.doesNotMatch(account, /New users are created/, 'no developer wording in the auth copy');
  for (const banned of ['provisioned', 'Supabase account', 'authentication link']) {
    assert.equal(account.includes(banned), false, `auth copy must not say "${banned}"`);
  }

  // Apple and Google stay above the email block.
  assert.match(account, /AppleAuthentication\.AppleAuthenticationButton/, 'Apple auth preserved');
  assert.match(account, /<GoogleSignInButton/, 'Google auth preserved');
  const providersIndex = account.indexOf('<View style={styles.providers}>');
  const dividerIndex = account.indexOf('<AuthDivider />');
  const emailIndex = account.indexOf("{mode === 'magic_link' ?");
  assert.ok(providersIndex > -1 && dividerIndex > -1 && emailIndex > -1);
  assert.ok(
    providersIndex < dividerIndex && dividerIndex < emailIndex,
    'Apple/Google must stay above the email option, never buried below it',
  );

  // Behaviour untouched: same handlers, same shared resolver, same keyboard care.
  for (const symbol of [
    'handleSendMagicLink',
    'sendMagicLink(email)',
    'completeAuthentication',
    'resolvePostAuthRoute',
    'KeyboardAvoidingView',
  ]) {
    assert.ok(account.includes(symbol), `${symbol} is preserved`);
  }
}

function analyticsContinuity() {
  // Replacement for the retired manual-save event.
  assert.match(
    flow,
    /trackEvent\('onboarding_demo_autosaved', screenProps\(3\)\)/,
    'the auto-save demo reports completion on screen 4',
  );
  assert.doesNotMatch(
    stripComments(flow),
    /trackEvent\('onboarding_demo_save_tapped'/,
    'the manual-save event is retired with the button',
  );
  // Step 4 → 5 tap-through keeps being measurable with an existing event.
  assert.match(
    flow,
    /trackEvent\('onboarding_continue_tapped', screenProps\(3\)\)/,
    'the screen 4 CTA is measured',
  );
  // Everything else in the funnel is untouched.
  for (const event of [
    'onboarding_demo_started',
    'onboarding_screen_viewed',
    'onboarding_back_tapped',
    'onboarding_share_demo_tapped',
    'onboarding_share_to_demo_tapped',
    'onboarding_nearr_demo_tapped',
    'onboarding_nearr_help_opened',
    'onboarding_nearr_help_step_viewed',
    'onboarding_nearr_help_closed',
    'onboarding_demo_pin_shown',
    'onboarding_demo_completed',
  ]) {
    assert.ok(flow.includes(event), `analytics event ${event} is preserved`);
  }
  // The auto-save event fires at most once per demo run.
  assert.match(flow, /autoSavedRef\.current\) return;/, 'the auto-save event is de-duplicated');
}

function backNavigationAndReset() {
  assert.match(flow, /onBack=\{isWelcome \? undefined : goBack\}/, 'back is available after screen 1');
  assert.match(flow, /setStep\(\(s\) => Math\.max\(s - 1, 0\)\)/, 'back steps the flow down');

  // Returning to screen 4 must not find the demo stuck at "saved": the switch
  // renders it only for step 3, and the card resets every value on (re)play.
  assert.match(flow, /case 3:[\s\S]{0,240}<FindingSavingScreen onSaved=\{handleDemoAutoSaved\} \/>/);
  const play = card.slice(card.indexOf('let cancelled = false;'));
  for (const reset of [
    'progress.setValue(0)',
    'reveal.setValue(0)',
    'savedReveal.setValue(0)',
    "setStage('finding')",
  ]) {
    assert.ok(play.includes(reset), `the sequence resets ${reset} before replaying`);
  }
  assert.match(card, /\}, \[playKey, progress, reveal, savedReveal\]\);/, 'playKey replays it');
  // A pending timer must not fire into an unmounted/replayed card.
  assert.match(card, /if \(saveTimer\) clearTimeout\(saveTimer\);/, 'the save timer is cleaned up');
  // A stale advance must not survive a back tap.
  assert.match(flow, /clearTimeout\(advanceTimerRef\.current\)/, 'pending advances are cancelled');
}

function completionAndReturningUsers() {
  // Unchanged source of truth: per-user AsyncStorage flag + memory cache.
  assert.match(onboardingLib, /nearr:onboarding:completed:v1:/, 'the completion key is unchanged');
  assert.match(onboardingLib, /export async function markOnboardingComplete/);
  assert.match(onboardingLib, /export async function getOnboardingStatus/);
  assert.match(
    onboardingLib,
    /if \(completedMemory\.has\(userId\)\) return 'complete';/,
    'a completion recorded this session is seen immediately',
  );
  assert.match(
    onboardingLib,
    /status_read_failed_failing_open[\s\S]{0,120}return 'complete';/,
    'a read failure still fails open so nobody is trapped in onboarding',
  );
  assert.match(
    onboardingLib,
    /onboardedBySaves[\s\S]{0,200}markOnboardingComplete\(userId\)/,
    'an existing user with saves is treated as onboarded',
  );

  // The pre-auth demo flag stays separate from account onboarding.
  assert.match(onboardingLib, /nearr:onboarding:demo_completed:v1/);
  assert.match(onboardingLib, /export async function markDemoCompleted/);

  // Signed-in users are pulled out of the flow (dev preview excepted).
  const layout = read('app/_layout.tsx');
  assert.match(
    layout,
    /if \(\(inAuth \|\| inOnboarding\) && !previewingOnboarding && !isPostAuthRoutingPending\(\)\)/,
    'AuthGate still routes signed-in users out of onboarding',
  );
  assert.match(read('app/index.tsx'), /if \(!session\) return <Redirect href="\/\(onboarding\)" \/>/);
}

function run() {
  noManualSaveInteraction();
  autoSaveSequence();
  demoTimingIsFast();
  statesAreReadableWithoutColour();
  truthfulCopy();
  valuePropAndTutorialPreserved();
  finalCtaCreatesTheMap();
  authContinuity();
  analyticsContinuity();
  backNavigationAndReset();
  completionAndReturningUsers();
  console.log('testOnboardingDemoCopy: all assertions passed');
}

run();
