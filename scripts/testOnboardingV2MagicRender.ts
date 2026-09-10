import assert from 'node:assert/strict';
import React from 'react';

import {
  beginOnboardingInAppTutorialResolution,
  bindAnonymousUser,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  observeOnboardingTutorialJob,
  resolveOnboardingTutorialResult,
  startOnboardingV2,
  type OnboardingTutorialFixture,
} from '../lib/onboardingV2Core';
import { onboardingTutorialPreviewUrl } from '../lib/onboardingTutorialPreview';

// Render the real affected component with small host mocks, then enforce the
// React Native invariant that raw text may only appear below a Text host node.
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
const host = (name: string) => name;
let reduceMotion = false;
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
      sequence: () => inertAnimation, spring: () => inertAnimation, timing: () => inertAnimation,
    },
    Image: host('Image'), Linking: { openURL: async () => undefined }, Pressable,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
    Text: host('Text'), View: host('View'),
  };
  if (request === '@expo/vector-icons') return { Feather: host('Feather'), Ionicons: host('Ionicons') };
  if (request === 'react-native-maps') return { __esModule: true, default: host('MapView'), Marker: host('Marker') };
  if (request === '@/components/PlaceImage') return { PlaceImage: host('PlaceImage') };
  if (request === '@/components/StartupSurface') return { StartupSurface: host('StartupSurface') };
  if (request === '@/components/onboarding/v2/Phase1Visuals') return {
    Phase1Colors: { background: '#F7F4EE', surface: '#FFFFFF', border: '#E3DCCF', text: '#191815', textMuted: '#6D6860', orange: '#FF5B24', success: '#2C9B69' },
    Phase1Frame: ({ children, footer, ...props }: any) => React.createElement('Phase1Frame', props, children, footer),
    Phase1PrimaryButton: (props: any) => React.createElement('Phase1PrimaryButton', props),
  };
  if (request === '@/components/onboarding/v2/OnboardingVisualLanguage') return {
    MagicScanner: (props: any) => React.createElement('MagicScanner', props),
    NearrSparkleMark: (props: any) => React.createElement('NearrSparkleMark', props),
    SocialToMapIllustration: (props: any) => React.createElement('SocialToMapIllustration', props),
    useOnboardingReduceMotion: () => reduceMotion,
  };
  if (request === '@/lib/onboardingTutorialPreview') return { onboardingTutorialPreviewUrl };
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

const state = {
  preferredPlatform: 'instagram',
  tutorialFixture: { thumbnailUrl: 'https://images.example/source.jpg' },
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
  assert.match(textContent(processing.toJSON()), /Looking at the post/, 'zero/initial processing state renders');
  const firstStep = timers.find((timer) => timer.delay === 420 && !timer.cleared);
  const secondStep = timers.find((timer) => timer.delay === 840 && !timer.cleared);
  assert.ok(firstStep && secondStep, 'normal-motion processing schedules both delayed steps');
  TestRenderer.act(() => firstStep.callback());
  assert.match(textContent(processing.toJSON()), /Finding visual clues/, 'first delayed step renders');
  TestRenderer.act(() => secondStep.callback());
  assert.match(textContent(processing.toJSON()), /Matching places/, 'second delayed step renders');
  assertNativeTextInvariant(processing.toJSON());
  processing.unmount();

  reduceMotion = true;
  let reduced!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    reduced = TestRenderer.create(React.createElement(ProcessingScreen, { state, failed: false, onRetry() {} }));
  });
  assert.match(textContent(reduced.toJSON()), /Matching places/, 'Reduce Motion reaches the stable final processing step without animation timers');
  assertNativeTextInvariant(reduced.toJSON());
  reduced.unmount();
  reduceMotion = false;

  const instagramFixture: OnboardingTutorialFixture = {
    id: '93b1ded0-02ae-49c6-a03f-1786162fde2f', revision: 8, role: 'primary', platform: 'instagram',
    identityKey: 'v1:instagram:C9Z963muLHI', identityVersion: 1, contentId: 'C9Z963muLHI',
    canonicalUrl: 'https://www.instagram.com/reel/C9Z963muLHI/', launchUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
    thumbnailUrl: null, selectedAt: '2026-09-10T12:00:00.000Z',
  };
  const youtubeFixture: OnboardingTutorialFixture = {
    ...instagramFixture, id: '1c19f2d2-a020-4508-9fe3-ef9ef8bb052a', platform: 'youtube',
    identityKey: 'v1:youtube:rrKmN3zZ0lM', contentId: 'rrKmN3zZ0lM',
    canonicalUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM', launchUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM',
  };
  assert.equal(
    onboardingTutorialPreviewUrl('instagram', instagramFixture.contentId),
    'https://www.instagram.com/p/C9Z963muLHI/media/?size=l',
    'a missing Instagram endpoint field resolves to the exact source poster route',
  );
  assert.equal(
    onboardingTutorialPreviewUrl('youtube', youtubeFixture.contentId),
    'https://i.ytimg.com/vi/rrKmN3zZ0lM/hqdefault.jpg',
  );

  let instagram!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    instagram = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: instagramFixture, preferredPlatform: 'instagram' }));
  });
  assert.equal(instagram.root.findByProps({ testID: 'onboarding-source-preview-image' }).props.source.uri, 'https://www.instagram.com/p/C9Z963muLHI/media/?size=l');
  assert.ok(instagram.root.findByProps({ testID: 'onboarding-source-preview-loading' }), 'preview has an explicit loading state');
  TestRenderer.act(() => instagram.root.findByProps({ testID: 'onboarding-source-preview-image' }).props.onLoad());
  assert.equal(instagram.root.findAllByProps({ testID: 'onboarding-source-preview-loading' }).length, 0);
  assertNativeTextInvariant(instagram.toJSON());
  instagram.unmount();

  let youtube!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    youtube = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: youtubeFixture, preferredPlatform: 'youtube' }));
  });
  assert.equal(youtube.root.findByProps({ testID: 'onboarding-source-preview-image' }).props.source.uri, 'https://i.ytimg.com/vi/rrKmN3zZ0lM/hqdefault.jpg');
  assertNativeTextInvariant(youtube.toJSON());
  youtube.unmount();

  let fallback!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    fallback = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: instagramFixture, preferredPlatform: 'youtube' }));
  });
  assert.ok(fallback.root.findByProps({ testID: 'onboarding-source-preview-fallback' }), 'platform mismatch stays honestly Nearr-branded');
  assert.equal(fallback.root.findAllByProps({ testID: 'onboarding-source-preview-image' }).length, 0);
  assertNativeTextInvariant(fallback.toJSON());
  fallback.unmount();

  let failed!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    failed = TestRenderer.create(React.createElement(ChallengeSourcePreview, { fixture: instagramFixture, preferredPlatform: 'instagram' }));
  });
  TestRenderer.act(() => failed.root.findByProps({ testID: 'onboarding-source-preview-image' }).props.onError());
  assert.ok(failed.root.findByProps({ testID: 'onboarding-source-preview-failed' }), 'image failure is explicit');
  TestRenderer.act(() => failed.root.findByProps({ accessibilityLabel: 'Retry source preview' }).props.onPress());
  assert.match(failed.root.findByProps({ testID: 'onboarding-source-preview-image' }).props.source.uri, /nearr_preview_retry=1$/, 'retry forces a new source request');
  const loadTimeout = [...timers].reverse().find((timer) => timer.delay === 12_000 && !timer.cleared);
  assert.ok(loadTimeout, 'a stalled request has a bounded loading state');
  TestRenderer.act(() => loadTimeout.callback());
  assert.ok(failed.root.findByProps({ testID: 'onboarding-source-preview-failed' }), 'a stalled preview becomes retryable instead of remaining a placeholder');
  assertNativeTextInvariant(failed.toJSON());
  failed.unmount();

  const started = startOnboardingV2(createInitialOnboardingV2State('2026-09-10T12:00:00.000Z'), '2026-09-10T12:00:01.000Z').state;
  const bound = bindAnonymousUser(started, 'anonymous-user', '11111111-1111-4111-8111-111111111111', '2026-09-10T12:00:02.000Z').state;
  const challenge = { ...bound, stage: 'tutorial_challenge' as const, tutorialFixture: instagramFixture, preferredPlatform: 'instagram' as const };
  const pending = beginOnboardingInAppTutorialResolution(challenge, '2026-09-10T12:00:03.000Z').state;
  assert.equal(pending.stage, 'tutorial_processing');
  assert.equal(pending.tutorialJobId, null, 'pending render is valid before the create-job acknowledgement');
  const resumed = decodeOnboardingV2State(encodeOnboardingV2State(pending), '2026-09-10T12:00:04.000Z');
  assert.equal(resumed.pendingShare?.attemptId, pending.pendingShare?.attemptId, 'persisted resume keeps the stable idempotency key');
  assert.equal(resumed.stage, 'tutorial_processing');

  const result = {
    jobId: 'tutorial-job', savedPlaceId: 'saved-dorset', fixtureId: instagramFixture.id,
    fixtureRevision: instagramFixture.revision, fixtureRole: instagramFixture.role,
    resolutionSource: 'tutorial_fixture' as const, sourceUrl: instagramFixture.canonicalUrl,
    place: { googlePlaceId: 'ChIJG9E4hIhd4IkRwN0jnyQ9-F4', name: 'Dorset Marble Quarry', formattedAddress: 'Dorset, Vermont', latitude: 43.23596, longitude: -73.08348, primaryType: null, typeLabel: null, photoUrl: null, photoUrls: [] },
  };
  const fastObserved = observeOnboardingTutorialJob(pending, { jobId: result.jobId, sourceUrl: result.sourceUrl }, '2026-09-10T12:00:03.100Z').state;
  assert.equal(resolveOnboardingTutorialResult(fastObserved, result, '2026-09-10T12:00:03.200Z').state.stage, 'tutorial_reveal', 'fast completion is accepted');
  const delayedObserved = observeOnboardingTutorialJob(resumed, { jobId: result.jobId, sourceUrl: result.sourceUrl }, '2026-09-10T12:00:20.000Z').state;
  assert.equal(resolveOnboardingTutorialResult(delayedObserved, result, '2026-09-10T12:00:21.000Z').state.stage, 'tutorial_reveal', 'delayed completion after persisted resume is accepted');
} finally {
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  Module._load = originalLoad;
}

console.log('PASS Onboarding V2 magic-moment rendering, previews, timing, Reduce Motion, and persisted resume');
