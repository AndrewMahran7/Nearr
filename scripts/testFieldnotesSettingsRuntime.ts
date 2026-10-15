import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { canRunOnboardingV2DevelopmentReset } from '../lib/onboardingV2DevResetCore';
import { NEARR_DEV_SUPABASE_REF, resolveEnvironment } from '../lib/appEnvironmentCore';

const sourceRoot = process.env.NEARR_QA_SOURCE_ROOT ?? path.resolve(__dirname, '..');
const Module = require('node:module');
const originalLoad = Module._load;
let systemAppearance: 'light' | 'dark' | null = 'dark';
const reads: Array<{ resolve: (value: string | null) => void; reject: (error: Error) => void }> = [];
const writes: Array<{ key: string; value: string }> = [];
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') return { useColorScheme: () => systemAppearance };
  if (request === '@react-native-async-storage/async-storage') return { getItem: () => new Promise((resolve, reject) => reads.push({ resolve, reject })), setItem: async (key: string, value: string) => { writes.push({ key, value }); } };
  if (request.startsWith('@/')) return originalLoad(path.join(sourceRoot, request.slice(2)), parent, isMain);
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { ThemeProvider, useTheme } = require(path.join(sourceRoot, 'lib/theme.tsx'));
let theme: any;
function Consumer() { theme = useTheme(); return React.createElement('Theme', { preference: theme.themePreference, resolved: theme.resolvedTheme }); }
const render = async () => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => { tree = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(Consumer))); });
  return tree;
};
async function main() {
  const raced = await render();
  assert.equal(theme.resolvedTheme, 'light', 'first install defaults to Fieldnotes Light even on dark system');
  assert.equal(theme.isThemeReady, false);
  await TestRenderer.act(async () => theme.setThemePreference('light'));
  await TestRenderer.act(async () => reads[0].resolve('dark'));
  assert.equal(theme.resolvedTheme, 'light', 'a late stored preference cannot undo a newer user choice');
  assert.equal(theme.isThemeReady, true);
  assert.deepEqual(writes[0], { key: 'nearr:themePreference', value: 'light' });
  await TestRenderer.act(async () => raced.unmount());
  const storedDark = await render();
  await TestRenderer.act(async () => reads[1].resolve('dark'));
  assert.equal(theme.resolvedTheme, 'dark', 'existing explicit dark mode is preserved');
  assert.equal(theme.colors.bg, '#171A18');
  await TestRenderer.act(async () => theme.setThemePreference('system'));
  assert.equal(theme.resolvedTheme, 'dark');
  systemAppearance = 'light';
  await TestRenderer.act(async () => storedDark.update(React.createElement(ThemeProvider, null, React.createElement(Consumer))));
  assert.equal(theme.resolvedTheme, 'light', 'system preference follows system changes');
  await TestRenderer.act(async () => theme.setThemePreference('dark'));
  assert.equal(theme.resolvedTheme, 'dark', 'explicit dark ignores light system');
  await TestRenderer.act(async () => storedDark.unmount());
  const failed = await render();
  await TestRenderer.act(async () => reads[2].reject(new Error('storage unavailable')));
  assert.equal(theme.isThemeReady, true);
  assert.equal(theme.resolvedTheme, 'light', 'storage failure keeps usable Light default');
  await TestRenderer.act(async () => failed.unmount());
  const invalid = await render();
  await TestRenderer.act(async () => reads[3].resolve('legacy-invalid'));
  assert.equal(theme.resolvedTheme, 'light');
  await TestRenderer.act(async () => invalid.unmount());
  const env = { appEnv: 'development', backendEnv: 'development', supabaseUrl: `https://${NEARR_DEV_SUPABASE_REF}.supabase.co` };
  assert.equal(canRunOnboardingV2DevelopmentReset(resolveEnvironment(env)), true);
  for (const input of [{ ...env, appEnv: 'production' }, { ...env, backendEnv: 'production' }, { ...env, appEnv: 'preview' }, { ...env, appEnv: '' }, { ...env, supabaseUrl: 'https://other.supabase.co' }, {}]) {
    assert.equal(canRunOnboardingV2DevelopmentReset(resolveEnvironment(input)), false, 'production, preview, defaulted and wrong backend cannot run QA actions');
  }
  const settings = readFileSync(path.join(sourceRoot, 'app/(tabs)/settings.tsx'), 'utf8');
  const route = readFileSync(path.join(sourceRoot, 'app/dev-qa.tsx'), 'utf8');
  const operations = readFileSync(path.join(sourceRoot, 'lib/onboardingV2DevReset.ts'), 'utf8');
  assert.match(settings, /Same verified Development boundary[\s\S]*?\{onboardingResetAvailable \?/, 'Testing controls use environment policy in Development OTA and debug');
  assert.match(settings, /async function handleSendTestNotification\(\) \{\s*if \(!isOnboardingV2DevelopmentResetAvailable\(\)\) return;/);
  assert.match(settings, /function handleTestOnboarding\(\) \{\s*if \(!isOnboardingV2DevelopmentResetAvailable\(\)\) return;/);
  assert.match(route, /if \(!isOnboardingV2DevelopmentResetAvailable\(\)\) return <Redirect href="\/" \/>/, 'consumer deep-link cannot open QA route');
  assert.equal((operations.match(/if \(!isOnboardingV2DevelopmentResetAvailable\(\)\)/g) ?? []).length, 2, 'both reset operations repeat their own hard guard');
  assert.match(settings, /const \{ colors, typography, themePreference, setThemePreference \} = useTheme\(\)/);
  assert.doesNotMatch(settings, /DarkColors|DarkPalette|backgroundColor: ['"]#(?:000|000000|171A18)['"]/i);
  console.log('PASS Fieldnotes settings runtime: theme hydration race, first-install Light, persisted Dark, system changes, read failure/invalid value; Development-only actions, Production/deep-link/operation guards');
}
main().finally(() => { Module._load = originalLoad; }).catch(error => { console.error(error); process.exitCode = 1; });
