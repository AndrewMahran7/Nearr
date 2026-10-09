import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { LightPalette, DarkPalette } from '../constants/colors';

// Render the actual extension root; replace native bridges and the server boundary.
// This exercises completion/latch behavior without a network or an iOS host.
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
let appearance = 'light', reduced = false, success = 0, errors = 0, closes = 0, opens = 0, submits = 0, animations = 0;
let auth = 'submit', blocked = false;
let result: any = { ok: true, duplicate: false, jobId: 'fixture-job', status: 'queued' };
let pending: Promise<any> | null = null;
const Pressable = ({ children, style, ...props }: any) => React.createElement('Pressable', { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style }, children);
class Value { constructor(public value: number) {} setValue(value: number) { this.value = value; } interpolate() { return this.value; } }
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return { Pressable, View: 'View', Text: 'Text', Image: 'Image', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', useColorScheme: () => appearance, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, Animated: { Value, View: 'AnimatedView', timing: (value: Value) => ({ start: () => { animations++; value.setValue(1); }, stop() {} }) } };
  if (request === 'expo-share-extension') return { close: () => closes++, openHostApp: () => opens++ };
  if (request === './lib/useReduceMotion') return { useReduceMotion: () => reduced };
  if (request === './lib/haptics') return { hapticSuccess: () => success++, hapticError: () => errors++ };
  if (request === './lib/sharedAuth') return { sharedAuth: { getToken: () => 'fixture-token', isInitialized: () => true, isAvailable: () => true, recordShareTrace() {} } };
  if (request === './lib/sharedAuthSession') return { selectExtensionAuthAction: () => auth };
  if (request === './lib/featureFlags') return { isAsyncShareJobsEnabled: () => true, resolveCreateShareJobUrl: () => 'https://fixture.invalid/create' };
  if (request === './lib/appEnvironment') return { areDeveloperToolsVisible: () => false, describeEnvironment: () => 'fixture', getBlockingEnvironmentViolations: () => blocked ? [{ code: 'FIXTURE_BLOCK' }] : [] };
  if (request === './lib/shareEnvDiagnostics') return { hostFromUrl: () => 'fixture.invalid', resolveProcessShareLinkUrl: () => ({ url: 'https://fixture.invalid/process', source: 'fixture' }) };
  if (request === './lib/shareJobClient') return { createShareJob: async () => { submits++; return pending ? pending : result; } };
  if (request.endsWith('/assets/icon.png')) return 1;
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { default: ShareExtension } = require('../ShareExtension') as typeof import('../ShareExtension');
const textOf = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(' ');
const flatten = (style: any): any => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
async function render() {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => { tree = TestRenderer.create(React.createElement(ShareExtension, { url: 'https://instagram.com/reel/fixture', text: 'A coastal afternoon https://instagram.com/reel/fixture', images: ['https://remote.invalid/image.jpg', 'file:///local.jpg'] })); });
  return tree;
}
async function main() {
  let renders = 0;
  try {
    for (const mode of ['light', 'dark']) for (const reduce of [false, true]) for (const duplicate of [false, true]) {
      appearance = mode; reduced = reduce;
      result = { ok: true, duplicate, jobId: 'fixture-job', status: 'queued' };
      const before = success;
      const tree = await render(); renders++;
      assert.match(textOf(tree.toJSON()), /Sent to Nearr/);
      assert.match(textOf(tree.toJSON()), /You can close this/);
      assert.doesNotMatch(textOf(tree.toJSON()), /add.*map|place found|high confidence/i);
      const palette = mode === 'dark' ? DarkPalette : LightPalette;
      const title = tree.root.findAllByType('Text' as any).find(node => node.children.includes('Sent to Nearr'))!;
      assert.equal(flatten(title.props.style).color, palette.text);
      assert.equal(title.props.numberOfLines, undefined, 'receipt title grows at Dynamic Type');
      const button = tree.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === 'Done')!;
      assert.equal(flatten(button.props.style).backgroundColor, palette.primary);
      assert.ok(flatten(button.props.style).minHeight >= 44);
      assert.equal(success, before + 1, 'one semantic success only after acknowledgement');
      const images = tree.root.findAllByType('Image' as any);
      assert.equal(images[0]!.props.source, 1, 'receipt uses the actual bundled brand icon');
      assert.ok(images.some(node => node.props.source?.uri === 'file:///local.jpg'));
      assert.ok(!images.some(node => /^https?:/.test(node.props.source?.uri ?? '')), 'receipt never fetches remote imagery');
      assert.equal(tree.root.findAllByType('AnimatedView' as any).filter(node => node.props.pointerEvents === 'none').length, reduced ? 0 : 1, 'Reduce Motion has no animated pulse');
      if (!reduced) {
        const beforeAnimations = animations;
        reduced = true;
        TestRenderer.act(() => tree.update(React.createElement(ShareExtension, { url: 'https://instagram.com/reel/fixture' })));
        reduced = false;
        TestRenderer.act(() => tree.update(React.createElement(ShareExtension, { url: 'https://instagram.com/reel/fixture' })));
        assert.equal(animations, beforeAnimations, 'changing the OS preference does not replay a completed receipt entrance');
      }
      const beforeCloses = closes;
      TestRenderer.act(() => { button.props.onPress(); button.props.onPress(); });
      assert.equal(closes, beforeCloses + 1, 'Done stays terminal and idempotent');
      assert.equal(opens, 0, 'Done never opens the host');
      tree.unmount();
    }
    // Pending acknowledgement cannot show the accepted state or emit success.
    let accept!: (value: unknown) => void;
    pending = new Promise(resolve => { accept = resolve; });
    const beforeSuccess = success;
    const waiting = await render(); renders++;
    assert.match(textOf(waiting.toJSON()), /Sending to Nearr/);
    assert.match(textOf(waiting.toJSON()), /Keep this open until it is sent/);
    assert.doesNotMatch(textOf(waiting.toJSON()), /You can close this/);
    assert.equal(success, beforeSuccess);
    await TestRenderer.act(async () => { accept({ ok: true, duplicate: false, jobId: 'fixture-job', status: 'queued' }); });
    assert.equal(success, beforeSuccess + 1); waiting.unmount(); pending = null;

    pending = new Promise(resolve => { accept = resolve; });
    const abandoned = await render(); renders++;
    const beforeAbandonedSuccess = success;
    const cancel = abandoned.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === 'Cancel')!;
    TestRenderer.act(() => cancel.props.onPress());
    await TestRenderer.act(async () => { accept({ ok: true, duplicate: false, jobId: 'fixture-job', status: 'queued' }); });
    assert.equal(success, beforeAbandonedSuccess, 'acknowledgement after closing does not replay a haptic');
    abandoned.unmount(); pending = null;

    result = { ok: false, reason: 'http_error', httpStatus: 400 };
    const beforeError = errors;
    const failure = await render(); renders++;
    assert.match(textOf(failure.toJSON()), /Couldn't send this to Nearr/);
    assert.match(textOf(failure.toJSON()), /couldn't confirm this share/);
    assert.equal(errors, beforeError + 1); failure.unmount();
    for (const state of ['needs_setup', 'signed_out', 'session_expired']) {
      auth = state;
      const beforeSubmits = submits;
      const tree = await render(); renders++;
      assert.match(textOf(tree.toJSON()), /Open Nearr/);
      assert.equal(submits, beforeSubmits, 'auth fallback never submits'); tree.unmount();
    }
    auth = 'submit'; blocked = true;
    const beforeSubmits = submits;
    const configuration = await render(); renders++;
    assert.match(textOf(configuration.toJSON()), /Nothing was sent/);
    assert.doesNotMatch(textOf(configuration.toJSON()), /FIXTURE_BLOCK|configuration:/);
    assert.equal(submits, beforeSubmits, 'environment guard remains fail-closed'); configuration.unmount();
  } finally { Module._load = originalLoad; }
  const activity = readFileSync('app/share-jobs/index.tsx', 'utf8');
  assert.match(activity, /__DEV__ && isMapPreviewMode\(\) && !!previewData/);
  for (const action of ['clearCompleted', 'emptyQueue', 'dismissJob', 'saveJob', 'dismissCompleted', 'undoRecent', 'openCompletedSave']) {
    assert.match(activity, new RegExp(`function ${action}\\([^)]*\\) \\{\\s*if \\(previewActive\\) return;`), `fixture ${action} is read-only`);
  }
  assert.match(activity, /if \(readOnly\) return;/, 'saved fixture imagery cannot hydrate or persist');
  console.log(`PASS Fieldnotes share receipt: ${renders} real component renders, adaptive colors, durable acknowledgement, retry/error/auth/config gates, bundled/local-only imagery, motion alternatives, one success haptic and read-only Activity fixtures`);
}
void main();
