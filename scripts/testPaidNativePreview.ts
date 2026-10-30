/** Real preview + ThemeProvider rendering; storage/native/i18n/paywall boundaries
 * are inert. This qualifies fixture readiness/restoration, not native pixels. */
import assert from 'node:assert/strict';
import React from 'react';
import Renderer from 'react-test-renderer';

const Module = require('node:module'), originalLoad = Module._load;
let development = true, systemScheme = 'light';
let storedTheme: string | null = 'system', holdThemeRead = false, releaseThemeRead: (() => void) | null = null;
let holdLocale = false;
const writes: string[] = [], localeCalls: string[] = [], frames: any[] = [], pendingLocales: Array<() => void> = [];
let latestTheme: any;
const i18n = {
  language: 'en-US',
  changeLanguage(locale: string) {
    localeCalls.push(locale);
    if (holdLocale) return new Promise<void>(resolve => pendingLocales.push(() => { i18n.language = locale; resolve(); }));
    i18n.language = locale; return Promise.resolve();
  },
};
let themeModule: typeof import('../lib/theme');
function FixtureContent(props: any) {
  const theme = themeModule.useTheme();
  frames.push({ preference: theme.themePreference, resolved: theme.resolvedTheme, locale: i18n.language, preview: props.preview });
  return React.createElement('Fixture', { background: theme.colors.bg, theme: theme.resolvedTheme, preview: props.preview });
}
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
    getItem: async () => holdThemeRead ? await new Promise<string | null>(resolve => { releaseThemeRead = () => resolve(storedTheme); }) : storedTheme,
    setItem: async (_key: string, value: string) => { writes.push(value); storedTheme = value; },
  } };
  if (request === 'react-native') return { Text: 'Text', Platform: { OS: 'android', select: (choices: any) => choices.android ?? choices.default }, useColorScheme: () => systemScheme };
  if (request === '@/lib/i18n') return { i18n };
  if (request === '@/lib/onboardingV2DevReset') return { isOnboardingV2DevelopmentResetAvailable: () => development };
  if (request === '../app/plus' && /PaidFindsNativePreview/.test(parent?.filename ?? '')) return { PaidFindsContent: FixtureContent };
  if (/supabase|react-native-purchases/.test(request)) throw new Error('Unexpected backend or purchase dependency in fixture');
  if (request.startsWith('@/')) return originalLoad(require.resolve('../' + request.slice(2)), parent, isMain);
  return originalLoad(request, parent, isMain);
};

type PreviewProps = { state: string; locale: string; theme?: 'light' | 'dark' };
let Preview: typeof import('../components/PaidFindsNativePreview').PaidFindsNativePreview;
function ObserveTheme() { latestTheme = themeModule.useTheme(); return null; }
function Shell({ visible = true, ...props }: PreviewProps & { visible?: boolean }) {
  return React.createElement(themeModule.ThemeProvider, null,
    React.createElement(ObserveTheme), visible ? React.createElement(Preview, props) : null);
}
function reset(preference: string | null = 'system') {
  (globalThis as any).__DEV__ = true; development = true; systemScheme = 'light';
  storedTheme = preference; holdThemeRead = false; releaseThemeRead = null; holdLocale = false;
  i18n.language = 'en-US'; writes.length = 0; localeCalls.length = 0; frames.length = 0; pendingLocales.length = 0;
}
async function mount(props: PreviewProps) {
  let tree!: Renderer.ReactTestRenderer;
  await Renderer.act(async () => { tree = Renderer.create(React.createElement(Shell, props)); });
  return tree;
}
async function leave(tree: Renderer.ReactTestRenderer, props: PreviewProps) {
  await Renderer.act(async () => { tree.update(React.createElement(Shell, { ...props, visible: false })); });
}
async function unmount(tree: Renderer.ReactTestRenderer) { await Renderer.act(async () => { tree.unmount(); }); }
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }

async function main() {
  try {
    themeModule = require('../lib/theme');
    Preview = require('../components/PaidFindsNativePreview').PaidFindsNativePreview;
    await test('dark waits for hydrated preference, applies real palette, and restores system on exit', async () => {
      reset(); holdThemeRead = true;
      const props: PreviewProps = { state: 'free', locale: 'ja', theme: 'dark' }, tree = await mount(props);
      assert.equal(frames.length, 0); assert.deepEqual(writes, []);
      await Renderer.act(async () => { releaseThemeRead!(); });
      assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.resolved === 'dark' && frame.preference === 'dark' && frame.locale === 'ja' && frame.preview === true));
      assert.equal(tree.root.findByType('Fixture' as any).props.background, themeModule.DarkColors.bg);
      await leave(tree, props); assert.equal(latestTheme.themePreference, 'system'); assert.equal(storedTheme, 'system'); assert.equal(i18n.language, 'en-US');
      await unmount(tree);
    });
    await test('light overrides stored dark and restores dark', async () => {
      reset('dark'); const props: PreviewProps = { state: 'active', locale: 'en-US', theme: 'light' }, tree = await mount(props);
      assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.resolved === 'light'));
      assert.equal(tree.root.findByType('Fixture' as any).props.background, themeModule.LightColors.bg);
      await leave(tree, props); assert.equal(latestTheme.themePreference, 'dark'); assert.equal(storedTheme, 'dark'); await unmount(tree);
    });
    await test('fixture also waits for locale completion', async () => {
      reset(); holdLocale = true; const props: PreviewProps = { state: 'free', locale: 'de', theme: 'dark' }, tree = await mount(props);
      assert.equal(latestTheme.resolvedTheme, 'dark'); assert.equal(frames.length, 0);
      holdLocale = false; await Renderer.act(async () => { pendingLocales.shift()!(); });
      assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.locale === 'de' && frame.resolved === 'dark')); await unmount(tree);
    });
    await test('query changes keep the original preference and suppress old-theme frames', async () => {
      reset(); const first: PreviewProps = { state: 'free', locale: 'en-US', theme: 'dark' }, tree = await mount(first);
      frames.length = 0; const next: PreviewProps = { ...first, locale: 'ko', theme: 'light' };
      await Renderer.act(async () => { tree.update(React.createElement(Shell, next)); });
      assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.resolved === 'light' && frame.locale === 'ko'));
      await leave(tree, next); assert.equal(storedTheme, 'system'); assert.equal(latestTheme.themePreference, 'system'); assert.equal(i18n.language, 'en-US'); await unmount(tree);
    });
    for (const value of [undefined, 'system', 'DARK', ['dark']]) {
      await test(`missing/invalid theme ${JSON.stringify(value)} leaves the preference untouched`, async () => {
        reset('dark'); const tree = await mount({ state: 'free', locale: 'en-US', theme: value as any });
        assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.resolved === 'dark')); assert.deepEqual(writes, []);
        await unmount(tree); assert.deepEqual(writes, []); assert.equal(storedTheme, 'dark');
      });
    }
    for (const unavailable of ['production-build', 'not-development']) {
      await test(`${unavailable} prevents rendering and locale/theme side effects`, async () => {
        reset(); if (unavailable === 'production-build') (globalThis as any).__DEV__ = false; else development = false;
        const tree = await mount({ state: 'free', locale: 'ja', theme: 'dark' });
        assert.equal(tree.toJSON(), null); assert.equal(frames.length, 0); assert.deepEqual(localeCalls, []); assert.deepEqual(writes, []);
        await unmount(tree); assert.deepEqual(localeCalls, []); assert.deepEqual(writes, []);
      });
    }
    await test('leaving before theme hydration never applies a late override', async () => {
      reset('dark'); holdThemeRead = true; const props: PreviewProps = { state: 'free', locale: 'ja', theme: 'light' }, tree = await mount(props);
      await leave(tree, props); await Renderer.act(async () => { releaseThemeRead!(); });
      assert.equal(frames.length, 0); assert.deepEqual(writes, []); assert.equal(latestTheme.themePreference, 'dark'); assert.equal(i18n.language, 'en-US'); await unmount(tree);
    });
    console.log(`${passed} actual Development preview/ThemeProvider renderer scenarios passed; no native pixel or store proof.`);
  } finally { Module._load = originalLoad; (globalThis as any).__DEV__ = true; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
