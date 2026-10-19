import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';

const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const submitted: Array<{ url: string; submissionId: string }> = [];
const navigated: string[] = [];
const prepared: string[] = [];
let submitResult: { ok: boolean; reason?: string; duplicate?: boolean } = { ok: false, reason: 'network_failure' };

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === 'react-native') return {
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView',
    Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
  };
  if (request === 'expo-router') return { useRouter: () => ({ replace: (route: string) => navigated.push(route) }) };
  if (request === '@/components') return {
    Screen: 'Screen',
    Button: (props: any) => React.createElement('Button', props, React.createElement('Text', null, props.title)),
  };
  if (request === '@/components/AiSharePermissionPrompt') return require('../components/AiSharePermissionPrompt');
  if (request === '@/components/VayrinPresentationHeader') return { VayrinPresentationHeader: 'VayrinPresentationHeader' };
  if (request === '@/constants') return { Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } };
  if (request === '@/lib/featureFlags') return { isVayrinProductUiEnabled: () => false };
  if (request === '@/lib/theme') return {
    useTheme: () => ({ colors: { primary: '#f60', success: '#0f0', text: '#fff', textSecondary: '#ddd' }, typography: { heading: {}, body: {} } }),
  };
  if (request === '@/lib/vayrinPresentation') return { buildVayrinPresentation: () => ({}) };
  if (request === '@/lib/analytics') return { trackEvent: () => undefined };
  if (request === '@/lib/shareSubmission') return { resolveSubmissionId: () => 'synthetic-submission-id' };
  if (request === '@/lib/hostShareSubmit') return {
    hostShareSubmitter: { submit: async (input: { url: string; submissionId: string }) => {
      submitted.push(input);
      return submitResult;
    } },
  };
  if (request === '@/lib/logger') return { logDebug: () => undefined };
  if (request === '@/lib/deviceDiagnostics') return { recordDiagnostic: () => undefined };
  if (request === '@/lib/sharedAuth') return { sharedAuth: { recordShareTrace: () => undefined } };
  if (request === '@/hooks/useOnboardingV2') return { useOnboardingV2: () => ({ state: null }) };
  if (request === '@/lib/onboardingV2') return { prepareOnboardingV2RealPracticeShare: async (url: string) => { prepared.push(url); } };
  if (request === '@/lib/onboardingV2Core') return { isExpectedOnboardingSource: () => false };
  return originalLoad(request, parent, isMain);
};

const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { AiSharePermissionPrompt, AI_SHARE_PERMISSION_NOTICE } = require('../components/AiSharePermissionPrompt') as typeof import('../components/AiSharePermissionPrompt');
const { ShareJobHandoff } = require('../components/ShareJobHandoff') as typeof import('../components/ShareJobHandoff');

async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log(`PASS ${name}`);
}

function button(root: ReturnType<typeof TestRenderer.create>['root'], label: string) {
  const match = root.findAll((node: any) =>
    (node.type === 'Pressable' && node.props.accessibilityLabel === label) ||
    (node.type === 'Button' && node.props.title === label));
  assert.equal(match.length, 1, `expected one ${label} button`);
  return match[0];
}

async function main() {
  await check('prompt names both AI providers and the data shared before consent', async () => {
    for (const detail of ['find places and later generate an AI note about a saved video place', 'link', 'captions', 'creator/location details', 'selected video frames to Google Gemini', 'selected text and video frames to OpenAI', 'OpenAI may receive post audio for transcription']) {
      assert.ok(AI_SHARE_PERMISSION_NOTICE.includes(detail), detail);
    }
    let allowed = 0;
    let cancelled = 0;
    let screen!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      screen = TestRenderer.create(React.createElement(AiSharePermissionPrompt, {
        onAllow: () => { allowed += 1; }, onCancel: () => { cancelled += 1; }, compact: true,
      }));
    });
    assert.equal(allowed, 0);
    assert.equal(cancelled, 0);
    await TestRenderer.act(async () => {
      button(screen.root, 'Cancel share without analyzing this post').props.onPress();
    });
    assert.equal(allowed, 0);
    assert.equal(cancelled, 1);
    await TestRenderer.act(async () => { screen.unmount(); });
  });

  await check('host handoff cancel performs zero preparation and submission', async () => {
    submitted.length = 0; prepared.length = 0; navigated.length = 0;
    let screen!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      screen = TestRenderer.create(React.createElement(ShareJobHandoff, { url: 'https://example.invalid/post/1' }));
    });
    assert.equal(submitted.length, 0);
    assert.equal(prepared.length, 0);
    await TestRenderer.act(async () => {
      button(screen.root, 'Cancel share without analyzing this post').props.onPress();
    });
    assert.equal(submitted.length, 0);
    assert.equal(prepared.length, 0);
    assert.deepEqual(navigated, ['/(tabs)/map']);
    await TestRenderer.act(async () => { screen.unmount(); });
  });

  await check('host handoff allows once and retries a failed job without a second permission prompt', async () => {
    submitted.length = 0; prepared.length = 0; navigated.length = 0;
    submitResult = { ok: false, reason: 'network_failure' };
    let screen!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      screen = TestRenderer.create(React.createElement(ShareJobHandoff, { url: 'https://example.invalid/post/2' }));
    });
    await TestRenderer.act(async () => {
      button(screen.root, 'Allow third-party AI analysis of this post').props.onPress();
    });
    assert.equal(submitted.length, 1);
    assert.deepEqual(prepared, ['https://example.invalid/post/2']);
    assert.equal(screen.root.findAll((node: any) => node.props.accessibilityLabel === 'Allow third-party AI analysis of this post').length, 0);
    submitResult = { ok: false, reason: 'network_failure' };
    await TestRenderer.act(async () => { button(screen.root, 'Retry').props.onPress(); });
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[0], submitted[1], 'retry must preserve the original submission identity');
    await TestRenderer.act(async () => { screen.unmount(); });
  });

  await check('a new selected URL needs fresh permission even after a previous allow', async () => {
    submitted.length = 0; prepared.length = 0; navigated.length = 0;
    submitResult = { ok: false, reason: 'network_failure' };
    let screen!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      screen = TestRenderer.create(React.createElement(ShareJobHandoff, {
        key: 'https://example.invalid/post/first', url: 'https://example.invalid/post/first',
      }));
    });
    await TestRenderer.act(async () => {
      button(screen.root, 'Allow third-party AI analysis of this post').props.onPress();
    });
    assert.equal(submitted.length, 1);
    await TestRenderer.act(async () => {
      screen.update(React.createElement(ShareJobHandoff, {
        key: 'https://example.invalid/post/second', url: 'https://example.invalid/post/second',
      }));
    });
    assert.equal(submitted.length, 1);
    button(screen.root, 'Allow third-party AI analysis of this post');
    await TestRenderer.act(async () => {
      button(screen.root, 'Cancel share without analyzing this post').props.onPress();
    });
    assert.equal(submitted.length, 1);
    assert.deepEqual(prepared, ['https://example.invalid/post/first']);
    await TestRenderer.act(async () => { screen.unmount(); });
  });

  await check('extension and legacy host guards precede either extraction path', () => {
    const extension = read('ShareExtension.tsx');
    const extensionGate = extension.indexOf('if (sharedUrl && aiPermissionGrantedUrl !== sharedUrl)');
    assert.ok(extensionGate > 0);
    assert.ok(extensionGate < extension.indexOf('return <AsyncShareExtension {...props} />'));
    assert.ok(extensionGate < extension.indexOf('return <LegacyShareExtension {...props} />'));
    const host = read('app/share.tsx');
    assert.match(host, /<ShareJobHandoff\s+key=\{params\.url\}/, 'a new incoming URL must remount handoff and reset permission and submission identity');
    const guard = host.indexOf('if (aiPermissionGrantedUrlRef.current !== trimmed)');
    const start = host.indexOf('async function runSaveFlow(rawUrl: string)');
    const extraction = host.indexOf('serverExtraction = await extractShareOnServer(', start);
    assert.ok(start < guard && guard < extraction);
    assert.match(host, /onCancel=\{\(\) => \{[\s\S]*?setPendingAiPermissionUrl\(null\)/);
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
