import assert from 'node:assert/strict';
import React from 'react';
import { LightPalette, DarkPalette } from '../constants/colors';

import {
  beginOnboardingInAppTutorialResolution,
  advanceOnboardingSharingRehearsal,
  beginOnboardingSharingRehearsal,
  bindAnonymousUser,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  observeOnboardingTutorialJob,
  resolveOnboardingTutorialResult,
  startOnboardingV2,
  type OnboardingTutorialFixture,
} from '../lib/onboardingV2Core';
import * as offlineFixtures from '../onboarding/fixtures/offlineOnboardingFixtures';

// Render the real affected component with small host mocks, then enforce the
// React Native invariant that raw text may only appear below a Text host node.
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
const host = (name: string) => name;
let reduceMotion = false;
let theme: 'light' | 'dark' = 'light';
let fontScale = 1;
let animations = 0;
const getColors = () => theme === 'light' ? LightPalette : DarkPalette;
const getPhaseColors = () => { const c = getColors(); return { background: c.bg, surface: c.surface, surfaceRaised: c.surfaceElevated, border: c.border, text: c.text, textMuted: c.textSecondary, orange: c.accent, onOrange: c.textInverse, success: c.success, successSurface: c.successSurface, danger: c.danger, action: c.primary, onAction: c.textInverse }; };
const Pressable = ({ children, ...props }: any) => React.createElement(
  'Pressable',
  props,
  typeof children === 'function' ? children({ pressed: false }) : children,
);
class AnimatedValue {
  setValue() {}
  interpolate() { return 0; }
}
const inertAnimation = { start() {}, stop() {} };

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'),
    Animated: {
      View: host('Animated.View'), Value: AnimatedValue,
      loop: () => inertAnimation, parallel: () => inertAnimation,
      sequence: () => inertAnimation, spring: () => inertAnimation, timing: () => { animations += 1; return inertAnimation; },
    },
    Image: host('Image'), Linking: { openURL: async () => undefined }, Pressable,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
    Text: host('Text'), View: host('View'),
    useWindowDimensions: () => ({ width: 375, height: 667, fontScale }),
  };
  if (/\.(png|jpg|jpeg)$/.test(request)) return { uri: `bundle:${request}` };
  if (request === '@/lib/useReduceMotion') return { useReduceMotion: () => reduceMotion };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: getColors(), resolvedTheme: theme, typography: { title: { color: getColors().text }, body: { color: getColors().text }, eyebrow: { color: getColors().accent }, metadata: { color: getColors().textSecondary }, caption: { color: getColors().textSecondary } } }) };
  if (request === '@/components/onboarding/v2/FieldnotesPracticeScene') return originalLoad.call(this, '../components/onboarding/v2/FieldnotesPracticeScene.tsx', module, isMain);
  if (request === '@expo/vector-icons') return { Feather: host('Feather'), Ionicons: host('Ionicons') };
  if (request === 'expo-router') return { useRouter: () => ({ replace() {} }) };
  if (request === 'react-native-maps') return { __esModule: true, default: host('MapView'), Marker: host('Marker') };
  if (request === '@/components/PlaceImage') return { PlaceImage: host('PlaceImage') };
  if (request === '@/components/StartupSurface') return { StartupSurface: host('StartupSurface') };
  if (request === '@/components/onboarding/v2/Phase1Visuals') return {
    Phase1Colors: getPhaseColors(),
    usePhase1Colors: getPhaseColors,
    Phase1Frame: ({ children, footer, ...props }: any) => React.createElement('Phase1Frame', props, children, footer),
    Phase1PrimaryButton: (props: any) => React.createElement('Phase1PrimaryButton', props),
  };
  if (request === '@/components/onboarding/v2/OnboardingVisualLanguage') return {
    MagicScanner: (props: any) => React.createElement('MagicScanner', props),
    NearrSparkleMark: (props: any) => React.createElement('NearrSparkleMark', props),
    SocialToMapIllustration: (props: any) => React.createElement('SocialToMapIllustration', props),
    useOnboardingReduceMotion: () => reduceMotion,
  };
  if (request === '@/components/onboarding/v2/OfflineFixtureVideo') return {
    OfflineFixtureVideo: (props: any) => React.createElement('OfflineFixtureVideo', props),
  };
  if (request === '@/onboarding/assets/offlineOnboardingAssets') return {
    offlineOnboardingAsset: (key: string) => ({ uri: `bundle:${key}` }),
    offlineOnboardingMedia: (key: string) => ({ sourcePosterAsset: { uri: `bundle:${key}-poster` }, sourceVideoAsset: { uri: `bundle:${key}-video` }, placePhotoAssets: [{ uri: `bundle:${key}-place1` }, { uri: `bundle:${key}-place2` }] }),
  };
  if (request === '@/onboarding/fixtures/offlineOnboardingFixtures') return offlineFixtures;
  if (request.startsWith('@/')) return new Proxy({}, { get: () => () => undefined });
  return originalLoad(request, parent, isMain);
};

const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { ChallengeSourcePreview, ProcessingScreen } = require('../components/onboarding/v2/OnboardingV2PreAuth.tsx') as typeof import('../components/onboarding/v2/OnboardingV2PreAuth');

type JsonNode = ReturnType<ReturnType<typeof TestRenderer.create>['toJSON']>;
function assertNativeTextInvariant(node: JsonNode, insideText = false): void {
  if (node == null || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    assert.equal(insideText, true, `raw native text child outside <Text>: ${JSON.stringify(node)}`);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) assertNativeTextInvariant(child, insideText);
    return;
  }
  const nextInsideText = insideText || node.type === 'Text';
  for (const child of node.children ?? []) assertNativeTextInvariant(child as JsonNode, nextInsideText);
}

const renderedOfflineFixture = offlineFixtures.selectOfflineOnboardingFixture('instagram', 'outdoors');
const state = {
  preferredPlatform: 'instagram',
  tutorialFixture: offlineFixtures.toOnboardingTutorialFixture(renderedOfflineFixture, '2026-09-10T12:00:00.000Z'),
} as any;

type ScheduledTimer = { id: number; delay: number; callback: () => void; cleared: boolean };
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const timers: ScheduledTimer[] = [];
(global as any).setTimeout = (callback: () => void, delay = 0) => {
  const timer = { id: timers.length + 1, delay, callback, cleared: false };
  timers.push(timer);
  return timer.id;
};
(global as any).clearTimeout = (id: number) => {
  const timer = timers.find((item) => item.id === id);
  if (timer) timer.cleared = true;
};

function textContent(node: JsonNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return (node.children ?? []).map((child) => textContent(child as JsonNode)).join('');
}

try {
  let processing!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    processing = TestRenderer.create(React.createElement(ProcessingScreen, { state, failed: false, onRetry() {} }));
  });
  assertNativeTextInvariant(processing.toJSON());
  assert.match(textContent(processing.toJSON()), /Post received/, 'zero/initial processing state renders');
  const firstStep = timers.find((timer) => timer.delay === 420 && !timer.cleared);
  const secondStep = timers.find((timer) => timer.delay === 900 && !timer.cleared);
  const thirdStep = timers.find((timer) => timer.delay === 1380 && !timer.cleared);
  assert.ok(firstStep && secondStep && thirdStep, 'normal-motion processing schedules all deterministic delayed steps');
  TestRenderer.act(() => firstStep.callback());
  assert.match(textContent(processing.toJSON()), /Scanning video/, 'first delayed step renders');
  TestRenderer.act(() => secondStep.callback());
  assert.match(textContent(processing.toJSON()), /Looking for clues/, 'second delayed step renders');
  TestRenderer.act(() => thirdStep.callback());
  assert.match(textContent(processing.toJSON()), /Matching the place/, 'third delayed step renders');
  assertNativeTextInvariant(processing.toJSON());
  processing.unmount();

  reduceMotion = true;
  let reduced!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    reduced = TestRenderer.create(React.createElement(ProcessingScreen, { state, failed: false, onRetry() {} }));
  });
  assert.match(textContent(reduced.toJSON()), /Matching the place/, 'Reduce Motion reaches the stable final processing step without animation timers');
  assertNativeTextInvariant(reduced.toJSON());
  reduced.unmount();
  reduceMotion = false;

  const instagramFixture = offlineFixtures.toOnboardingTutorialFixture(offlineFixtures.selectOfflineOnboardingFixture('instagram', 'outdoors'), '2026-09-10T12:00:00.000Z');
  const youtubeFixture = offlineFixtures.toOnboardingTutorialFixture(offlineFixtures.selectOfflineOnboardingFixture('youtube', 'food'), '2026-09-10T12:00:00.000Z');

  let instagram!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    instagram = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: instagramFixture, preferredPlatform: 'instagram' }));
  });
  assert.equal(instagram.root.findByProps({ testID: 'onboarding-source-preview-video' }).props.assetKey, 'dorset_quarry');
  assertNativeTextInvariant(instagram.toJSON());
  instagram.unmount();

  let youtube!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    youtube = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: youtubeFixture, preferredPlatform: 'youtube' }));
  });
  assert.equal(youtube.root.findByProps({ testID: 'onboarding-source-preview-video' }).props.assetKey, 'mad_yolks');
  assertNativeTextInvariant(youtube.toJSON());
  youtube.unmount();

  const started = startOnboardingV2(createInitialOnboardingV2State('2026-09-10T12:00:00.000Z'), '2026-09-10T12:00:01.000Z').state;
  const bound = bindAnonymousUser(started, 'anonymous-user', '11111111-1111-4111-8111-111111111111', '2026-09-10T12:00:02.000Z').state;
  const challenge = { ...bound, stage: 'tutorial_challenge' as const, tutorialFixture: instagramFixture, preferredPlatform: 'instagram' as const };
  const ready = beginOnboardingSharingRehearsal(challenge, '2026-09-10T12:00:03.000Z').state;
  const shared = advanceOnboardingSharingRehearsal(ready, 'share', '2026-09-10T12:00:04.000Z').state;
  const more = advanceOnboardingSharingRehearsal(shared, 'more', '2026-09-10T12:00:05.000Z').state;
  const pending = beginOnboardingInAppTutorialResolution(more, '2026-09-10T12:00:06.000Z').state;
  assert.equal(pending.stage, 'tutorial_processing');
  assert.equal(pending.tutorialJobId, `onboarding-scripted-job:${renderedOfflineFixture.id}`, 'local processing has a deterministic synthetic job identity');
  const resumed = decodeOnboardingV2State(encodeOnboardingV2State(pending), '2026-09-10T12:00:04.000Z');
  assert.equal(resumed.pendingShare?.attemptId, pending.pendingShare?.attemptId, 'persisted resume keeps the stable idempotency key');
  assert.equal(resumed.stage, 'tutorial_processing');

  const result = offlineFixtures.buildOfflineOnboardingResult(renderedOfflineFixture);
  assert.equal(resolveOnboardingTutorialResult(pending, result, '2026-09-10T12:00:03.200Z').state.stage, 'fixture_map_payoff', 'fast scripted completion opens the authentic map payoff');
  assert.equal(resolveOnboardingTutorialResult(resumed, result, '2026-09-10T12:00:21.000Z').state.stage, 'fixture_map_payoff', 'persisted resume opens the same authentic map payoff');

  // Host rendering exercises the actual scene at dynamic text sizes. This is
  // a component contract check, not native pixel or VoiceOver evidence.
  const { FieldnotesPracticeScene } = require('../components/onboarding/v2/FieldnotesPracticeScene.tsx');
  for (theme of ['light', 'dark'] as const) for (fontScale of [1, 1.5, 2]) for (reduceMotion of [false, true]) {
    for (const stage of ['receipt', 'place'] as const) {
      const before = animations;
      let scene!: ReturnType<typeof TestRenderer.create>;
      TestRenderer.act(() => { scene = TestRenderer.create(React.createElement(FieldnotesPracticeScene, { fixtureId: renderedOfflineFixture.id, stage })); });
      assertNativeTextInvariant(scene.toJSON());
      const surface = scene.root.findByProps({ testID: 'fieldnotes-practice-' + stage });
      assert.equal(surface.props.style[1].backgroundColor, getColors().surface);
      assert.match(textContent(scene.toJSON()), stage === 'receipt' ? /Sent to Nearr/ : /Saved for this walkthrough/);
      for (const img of scene.root.findAllByType('Image' as any)) assert.match(img.props.source.uri, /^bundle:/, 'practice scene uses only local bundled media');
      assert.equal(animations - before, reduceMotion ? 0 : 1, 'Reduce Motion does not start the scene choreography');
      TestRenderer.act(() => scene.unmount());
    }
  }

} finally {
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  Module._load = originalLoad;
}

console.log('PASS Onboarding V2 magic-moment rendering, previews, timing, Reduce Motion, and persisted resume');
