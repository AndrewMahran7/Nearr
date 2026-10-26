import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import React from 'react';

import actualManifest from '../constants/privacyPolicy.json';
import {
  getApprovedPrivacyPolicy,
  getPrivacyPolicyErrors,
  isPrivacyPolicyUrl,
  privacyPolicyApprovalPayload,
  type PrivacyPolicyManifest,
} from '../lib/privacyPolicyManifest';
import { openPrivacyPolicyWebsite } from '../lib/privacyPolicy';

const { checkApprovedPolicy, requiresPrivacyApproval } = require('./checkPrivacyPolicyRelease.cjs');
const ROOT = path.resolve(__dirname, '..');
let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`PASS ${name}`);
}

// Deliberately synthetic render/test content, never imported by the app.
const fixture: PrivacyPolicyManifest = {
  schemaVersion: 1,
  canonicalUrl: 'https://example.invalid/privacy',
  snapshot: {
    version: 'test-only-v1',
    effectiveDate: 'October 15, 2026',
    operator: 'Synthetic test operator',
    contactEmail: 'privacy@example.invalid',
    sections: [
      { heading: 'Test section one', paragraphs: ['Synthetic policy paragraph one.', 'Synthetic policy paragraph two.'] },
      { heading: 'Test section two', paragraphs: ['Synthetic policy paragraph three.'] },
    ],
  },
  approval: {
    status: 'approved',
    approvedBy: 'test fixture only',
    approvedAt: '2026-10-15T12:00:00.000Z',
    reference: 'synthetic test reference, not a founder approval',
    contentSha256: '0'.repeat(64),
    publicationVerified: true,
  },
};
fixture.approval!.contentSha256 = createHash('sha256').update(privacyPolicyApprovalPayload(fixture)).digest('hex');
const cloneFixture = () => JSON.parse(JSON.stringify(fixture)) as PrivacyPolicyManifest;

check('real manifest is either explicitly pending or has complete exact-content approval', () => {
  if (actualManifest.approval === null) {
    assert.equal(actualManifest.snapshot, null);
    assert.equal(getApprovedPrivacyPolicy(actualManifest), null);
    assert.ok(getPrivacyPolicyErrors(actualManifest).length >= 2);
  } else {
    assert.doesNotThrow(() => checkApprovedPolicy(actualManifest));
  }
});
check('canonical URL matches the previously configured public policy destination', () => {
  assert.equal(actualManifest.canonicalUrl, 'https://andrewmahran7.github.io/nearr-legal/privacy');
});
check('approved complete fixture is selected as offline snapshot', () => {
  assert.deepEqual(getApprovedPrivacyPolicy(fixture), fixture.snapshot);
  assert.deepEqual(getPrivacyPolicyErrors(fixture), []);
  assert.equal(checkApprovedPolicy(fixture), fixture.approval!.contentSha256);
});
check('pending or malformed approval never exposes policy content as final', () => {
  for (const approval of [null, {}, { ...fixture.approval, status: 'pending' }, { ...fixture.approval, publicationVerified: false }]) {
    assert.equal(getApprovedPrivacyPolicy({ ...fixture, approval }), null);
  }
});
check('every required approval and policy field is enforced', () => {
  for (const key of ['approvedBy', 'approvedAt', 'reference', 'contentSha256']) {
    const invalid = cloneFixture();
    (invalid.approval as any)[key] = '';
    assert.equal(getApprovedPrivacyPolicy(invalid), null, key);
    assert.throws(() => checkApprovedPolicy(invalid));
  }
  for (const key of ['version', 'effectiveDate', 'operator', 'contactEmail']) {
    const invalid = cloneFixture();
    (invalid.snapshot as any)[key] = '';
    assert.equal(getApprovedPrivacyPolicy(invalid), null, key);
  }
  for (const sections of [[], null, [{}], [{ heading: '', paragraphs: ['text'] }], [{ heading: 'Heading', paragraphs: [] }], [{ heading: 'Heading', paragraphs: [''] }]]) {
    assert.equal(getApprovedPrivacyPolicy({ ...fixture, snapshot: { ...fixture.snapshot, sections } }), null);
  }
});
check('old internal warning and unfinished text are rejected as policy content', () => {
  for (const note of ['Lawyer review required before public launch.', 'This is a production-readiness draft.', 'Must be reviewed by counsel.', 'TODO confirm operator', '[insert the approved date]']) {
    const invalid = cloneFixture();
    invalid.snapshot!.sections[0].paragraphs[0] = note;
    assert.equal(getApprovedPrivacyPolicy(invalid), null);
  }
});
check('canonical content and URL are cryptographically bound to recorded approval', () => {
  const changedText = cloneFixture();
  changedText.snapshot!.sections[0].paragraphs[0] = 'Changed after approval.';
  assert.throws(() => checkApprovedPolicy(changedText), /SHA-256/);
  const changedUrl = cloneFixture();
  changedUrl.canonicalUrl = 'https://example.invalid/other';
  assert.throws(() => checkApprovedPolicy(changedUrl), /SHA-256/);
});
check('non-HTTPS, credentialed and tracking-parameter URLs are rejected', () => {
  for (const url of ['http://example.invalid/privacy', 'javascript:alert(1)', 'https://user:password@example.invalid/privacy', 'https://example.invalid/privacy?user=123', 'https://example.invalid/privacy#tracking', 'invalid']) {
    assert.equal(isPrivacyPolicyUrl(url), false, url);
  }
});
check('Production and Store profiles require approval, including inherited and unknown profiles', () => {
  const config = { build: {
    development: { developmentClient: true, distribution: 'internal', environment: 'development' },
    preview: { distribution: 'internal', environment: 'preview' },
    production: { environment: 'production' },
    customStore: { distribution: 'store' },
    inheritedStore: { extends: 'customStore' },
    unspecifiedStore: {},
    disguisedProduction: { distribution: 'internal', env: { EXPO_PUBLIC_APP_ENV: 'production' } },
    mixed: { developmentClient: true, distribution: 'store' },
    cycle: { extends: 'cycle' },
  } };
  for (const profile of ['production', 'customStore', 'inheritedStore', 'unspecifiedStore', 'disguisedProduction', 'mixed']) {
    assert.equal(requiresPrivacyApproval(config, { EAS_BUILD_PROFILE: profile }), true, profile);
  }
  for (const profile of ['development', 'preview']) {
    assert.equal(requiresPrivacyApproval(config, { EAS_BUILD_PROFILE: profile }), false, profile);
    assert.equal(requiresPrivacyApproval(config, { EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_APP_ENV: 'production' }), true);
  }
  for (const profile of [undefined, 'not-configured', 'cycle']) {
    assert.throws(() => requiresPrivacyApproval(config, { EAS_BUILD_PROFILE: profile }));
  }
});
check('real release CLI enforces the recorded policy state without any build or network action', () => {
  const run = spawnSync(process.execPath, ['scripts/checkPrivacyPolicyRelease.cjs'], { cwd: ROOT, encoding: 'utf8' });
  if (actualManifest.approval === null) {
    assert.equal(run.status, 1);
    assert.match(run.stderr, /PRIVACY_RELEASE_BLOCKED/);
    assert.match(run.stderr, /founder-approved offline policy snapshot is missing/);
  } else {
    assert.equal(run.status, 0);
    assert.match(run.stdout, /release gate passed/);
  }
});
check('EAS pre-install hook is wired without altering existing postinstall behavior', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['eas-build-pre-install'], 'node scripts/checkPrivacyPolicyRelease.cjs --eas-build');
  assert.equal(pkg.scripts.postinstall, 'patch-package');
});
check('actual EAS hook allows internal preview and rejects pending Production or unknown targets', () => {
  for (const profile of ['development', 'preview', 'production', 'not-configured']) {
    const run = spawnSync(process.execPath, ['scripts/checkPrivacyPolicyRelease.cjs', '--eas-build'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_APP_ENV: profile === 'production' ? 'production' : 'development' },
    });
    if (profile === 'not-configured' || (profile === 'production' && actualManifest.approval === null)) {
      assert.equal(run.status, 1, profile);
      assert.match(run.stderr, /PRIVACY_RELEASE_BLOCKED/);
    } else {
      assert.equal(run.status, 0, profile);
    }
  }
});
check('founder-published Terms and legacy acceptance state remain pinned; privacy routes stay separate', () => {
  const normalize = (text: string) => text.replace(/\r\n/g, '\n').trimEnd();
  // The approved Terms replacement changed this shared module, so compare it
  // to the reviewed release copy rather than the pre-release draft in Git.
  const legalSource = normalize(readFileSync(path.join(ROOT, 'constants/legal.ts'), 'utf8'));
  assert.equal(createHash('sha256').update(legalSource).digest('hex'), 'ba49bfd3097ad442816a38b909c3e6d3550e5c4d66a74e0645b050496d7d4695');
  const terms = spawnSync(process.execPath, ['node_modules/ts-node/dist/bin.js', '-P', 'scripts/tsconfig.json', 'scripts/testTermsRelease.ts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(terms.status, 0, terms.stderr || terms.stdout);
  assert.match(readFileSync(path.join(ROOT, 'app/(tabs)/settings.tsx'), 'utf8'), /\/legal\/privacy/);
  assert.match(readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8'), /legal\/privacy/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'app/legal/privacy.tsx'), 'utf8'), /PRIVACY_SECTIONS|LEGAL_EFFECTIVE_DATE|LEGAL_CONTACT_EMAIL|lawyer review|internal production readiness/i);
});

// Render the actual screen with React Native host mocks. No device, backend,
// URL request, app analytics or real policy publication occurs in these tests.
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
let screenPolicy: { canonicalUrl: string; snapshot: ReturnType<typeof getApprovedPrivacyPolicy> } = {
  canonicalUrl: actualManifest.canonicalUrl,
  snapshot: null,
};
let openedUrls: string[] = [];
let openFailure = false;
let waitForOpen: Promise<void> | null = null;
let screenThemeMode: 'light' | 'dark' = 'dark';
let themePalettes: Record<'light' | 'dark', typeof import('../lib/theme').LightColors>;
let authReads = 0;
let receiptSession: { access_token: string; user: { id: string } } | null = { access_token: 'owner-a-token', user: { id: 'owner-a' } };
let accessHandler = async (): Promise<Record<string, unknown>> => ({ legalApproved: true, privacyVersion: 'nearr-global-privacy-v1' });
const receiptCalls: { name: string; transport: { accessToken: string }; args: unknown }[] = [];
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === '@/lib/i18n') return require('../lib/i18nEngine');
  if (request === '@/hooks/useLocale') return { useLocale: () => ({ locale: 'en-US', preference: 'system', setLocale: async () => undefined }) };
  // Development review material is deliberately separate from approved policy
  // content; this harness exercises the production viewer with that panel off.
  if (request === '@/components/GlobalLegalDraft') return { GlobalLegalDraft: () => null };
  if (request === 'expo-constants') return { __esModule: true, default: { expoConfig: { extra: { supabaseUrl: 'https://test.invalid', supabaseAnonKey: 'test-public-key' } } } };
  if (request === '../../lib/supabase') return { supabase: { auth: { getSession: async () => { authReads += 1; return { data: { session: receiptSession } }; } } } };
  if (request === '@/lib/aiSharingConsent') return { consentRpc: async (transport: { accessToken: string }, name: string, args?: unknown) => {
    receiptCalls.push({ name, transport, args });
    return name === 'get_my_global_access' ? accessHandler() : { recorded: true };
  } };
  if (request === 'react-native') return {
    ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: unknown) => styles },
    Linking: { openURL: async (url: string) => {
      openedUrls.push(url);
      if (waitForOpen) await waitForOpen;
      if (openFailure) throw new Error('offline test');
    } },
  };
  if (request === '@/components') return {
    Screen: 'Screen', Card: 'Card',
    Button: (props: any) => React.createElement('Button', props, React.createElement('Text', {}, props.title)),
  };
  if (request === '@/constants') return require('../constants');
  if (request === '@react-native-async-storage/async-storage') return {
    getItem: async () => null,
    setItem: async () => undefined,
  };
  if (request === '@/lib/theme') return {
    useTheme: () => {
      const colors = themePalettes[screenThemeMode];
      const { Typography } = require('../constants');
      const typography = Object.fromEntries(Object.entries(Typography).map(([name, style]) => [
        name,
        { ...(style as object), color: name === 'caption' ? colors.textSecondary : colors.text },
      ]));
      return { colors, typography };
    },
  };
  if (request === '@/lib/privacyPolicy') return {
    get privacyPolicy() { return screenPolicy; },
    openPrivacyPolicyWebsite: (openURL: (url: string) => Promise<unknown>) => openPrivacyPolicyWebsite(openURL, screenPolicy.canonicalUrl),
  };
  return originalLoad(request, parent, isMain);
};
// Reuse real Nearr 1.5 palette values, without mounting storage or native hooks.
const { LightColors, DarkColors } = require('../lib/theme') as typeof import('../lib/theme');
themePalettes = { light: LightColors, dark: DarkColors };
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const PrivacyScreen = require('../app/legal/privacy.tsx').default;
const textContent = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textContent).join('') : (node?.children ?? []).map(textContent).join('');
function nativeTextInvariant(node: any, insideText = false): void {
  if (node == null) return;
  if (typeof node === 'string' || typeof node === 'number') { assert.ok(insideText, 'raw text outside a Text node'); return; }
  if (Array.isArray(node)) { node.forEach((child) => nativeTextInvariant(child, insideText)); return; }
  (node.children ?? []).forEach((child: any) => nativeTextInvariant(child, insideText || node.type === 'Text'));
}
function flattenStyle(style: any): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : (style ?? {});
}
function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    assert.match(hex, /^#[0-9a-f]{6}$/i);
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function assertReadablePolicyText(screen: ReturnType<typeof TestRenderer.create>) {
  const colors = themePalettes[screenThemeMode];
  for (const node of screen.root.findAllByType('Text' as any)) {
    const style = flattenStyle(node.props.style);
    if (typeof style.color !== 'string') continue; // Button is mocked and owns its own theme.
    let parent = node.parent;
    let inCard = false;
    while (parent) {
      if (parent.type === ('Card' as any)) inCard = true;
      parent = parent.parent;
    }
    const background = inCard ? colors.surface : colors.bg;
    assert.ok(contrastRatio(style.color, background) >= 4.5,
      `${screenThemeMode} policy text ${JSON.stringify(node.children)} has insufficient contrast`);
  }
  const title = screen.root.findAllByType('Text' as any).find((node) => node.children.join('') === 'Privacy Policy');
  assert.equal(flattenStyle(title!.props.style).color, colors.text);
  assert.equal(title!.props.accessibilityRole, 'header');
}

async function main() {
  let screen!: ReturnType<typeof TestRenderer.create>;
  try {
    await TestRenderer.act(async () => { screen = TestRenderer.create(React.createElement(PrivacyScreen)); });
    check('pending screen renders neutral unavailable state without warning, date, contact or invented content', () => {
      const text = textContent(screen.toJSON());
      assert.match(text, /A saved privacy policy is not available in this build/);
      assert.match(text, /https:\/\/andrewmahran7.github.io\/nearr-legal\/privacy/);
      assert.doesNotMatch(text, /lawyer|TODO|draft|support@nearr.app|May 2|Synthetic|Effective date:/i);
      nativeTextInvariant(screen.toJSON());
      assert.equal(screen.root.findAllByType('ScrollView' as any).length, 1);
    });
    check('viewing privacy does not open the website automatically', () => assert.deepEqual(openedUrls, []));
    check('absent snapshot performs no auth read or privacy receipt RPC', () => {
      assert.equal(authReads, 0);
      assert.deepEqual(receiptCalls, []);
    });
    for (const mode of ['light', 'dark'] as const) {
      screenThemeMode = mode;
      await TestRenderer.act(async () => { screen.update(React.createElement(PrivacyScreen)); });
      check(`pending privacy screen uses the existing ${mode} theme with readable text`, () => assertReadablePolicyText(screen));
    }
    await TestRenderer.act(async () => { await screen.root.findByType('Button' as any).props.onPress(); });
    check('explicit accessible link opens only the exact canonical HTTPS URL', () => {
      assert.deepEqual(openedUrls, [actualManifest.canonicalUrl]);
      assert.equal(screen.root.findByType('Button' as any).props.accessibilityLabel, 'Open privacy policy website in your browser');
      assert.equal(screen.root.findByType('Button' as any).props.loading, false);
    });
    openFailure = true;
    await TestRenderer.act(async () => { await screen.root.findByType('Button' as any).props.onPress(); });
    check('pending screen gives predictable accessible failure/retry text when browser opening fails', () => {
      assert.match(textContent(screen.toJSON()), /Check your connection and try again/);
      assert.equal(screen.root.findAll((node) => node.props.accessibilityRole === 'alert').length, 1);
    });
    await TestRenderer.act(async () => { screen.unmount(); });
    screenPolicy = { canonicalUrl: fixture.canonicalUrl, snapshot: getApprovedPrivacyPolicy(fixture) };
    openedUrls = [];
    await TestRenderer.act(async () => { screen = TestRenderer.create(React.createElement(PrivacyScreen)); });
    check('approved versioned offline snapshot renders every section, paragraph and exact metadata without networking', () => {
      const text = textContent(screen.toJSON());
      assert.match(text, /Effective date: October 15, 2026/);
      assert.match(text, /Saved copy · test-only-v1 · Available offline/);
      assert.match(text, /Synthetic test operator/);
      assert.match(text, /privacy@example.invalid/);
      for (const section of fixture.snapshot!.sections) {
        assert.ok(text.includes(section.heading));
        for (const paragraph of section.paragraphs) assert.ok(text.includes(paragraph));
      }
      assert.deepEqual(openedUrls, []);
      assert.equal(authReads, 0, 'a synthetic non-current snapshot never accesses account state');
      assert.deepEqual(receiptCalls, [], 'a test-only snapshot is not a current privacy notice receipt');
      nativeTextInvariant(screen.toJSON());
    });
    for (const mode of ['light', 'dark'] as const) {
      screenThemeMode = mode;
      await TestRenderer.act(async () => { screen.update(React.createElement(PrivacyScreen)); });
      check(`approved offline snapshot remains readable in the existing ${mode} theme`, () => {
        assertReadablePolicyText(screen);
        assert.equal(screen.root.findAll((node) => node.props.accessibilityRole === 'header').length, fixture.snapshot!.sections.length + 1);
      });
    }
    await TestRenderer.act(async () => { await screen.root.findByType('Button' as any).props.onPress(); });
    check('offline website failure preserves the whole snapshot and offers retry', () => {
      assert.match(textContent(screen.toJSON()), /You can read the saved policy below or try again/);
      assert.match(textContent(screen.toJSON()), /Synthetic policy paragraph three/);
    });
    openFailure = false;
    await TestRenderer.act(async () => { await screen.root.findByType('Button' as any).props.onPress(); });
    check('successful retry clears the previous link error', () => {
      assert.doesNotMatch(textContent(screen.toJSON()), /could not be opened/);
    });
    let finishOpen!: () => void;
    waitForOpen = new Promise<void>((resolve) => { finishOpen = resolve; });
    const beforeOpen = openedUrls.length;
    let firstOpen!: Promise<void>;
    TestRenderer.act(() => {
      const press = screen.root.findByType('Button' as any).props.onPress;
      firstOpen = press();
      void press();
    });
    check('rapid double tap opens one browser and marks the action busy', () => {
      assert.equal(openedUrls.length, beforeOpen + 1);
      assert.equal(screen.root.findByType('Button' as any).props.loading, true);
    });
    await TestRenderer.act(async () => { finishOpen(); await firstOpen; });
    waitForOpen = null;
    let unsafeCalls = 0;
    const unsafeResult = await openPrivacyPolicyWebsite(async () => { unsafeCalls += 1; }, 'javascript:alert(1)');
    check('unsafe external link is rejected before invoking platform handler', () => {
      assert.equal(unsafeResult, false);
      assert.equal(unsafeCalls, 0);
    });
    // Bind the actual presentation receipt to both the approved current notice
    // and the same account before/after the server qualification read.
    const currentFixture = cloneFixture();
    currentFixture.snapshot!.version = 'nearr-global-privacy-v1';
    currentFixture.approval!.contentSha256 = createHash('sha256').update(privacyPolicyApprovalPayload(currentFixture)).digest('hex');
    assert.doesNotThrow(() => checkApprovedPolicy(currentFixture));
    const mountCurrent = async () => {
      await TestRenderer.act(async () => { screen.unmount(); });
      screenPolicy = { canonicalUrl: currentFixture.canonicalUrl, snapshot: getApprovedPrivacyPolicy(currentFixture) };
      receiptCalls.length = 0;
      await TestRenderer.act(async () => { screen = TestRenderer.create(React.createElement(PrivacyScreen)); });
    };
    for (const access of [
      { legalApproved: false, privacyVersion: 'nearr-global-privacy-v1' },
      { legalApproved: true, privacyVersion: 'old-privacy-version' },
    ]) {
      accessHandler = async () => access;
      await mountCurrent();
      check(`no receipt when qualification or current version differs: ${JSON.stringify(access)}`, () => {
        assert.deepEqual(receiptCalls.map(call => call.name), ['get_my_global_access']);
      });
    }
    receiptSession = null;
    await mountCurrent();
    check('current approved notice remains readable without an authenticated account', () => {
      assert.deepEqual(receiptCalls, []);
      assert.match(textContent(screen.toJSON()), /Synthetic policy paragraph three/);
    });
    receiptSession = { access_token: 'owner-a-token', user: { id: 'owner-a' } };
    accessHandler = async () => {
      receiptSession = { access_token: 'owner-b-token', user: { id: 'owner-b' } };
      return { legalApproved: true, privacyVersion: 'nearr-global-privacy-v1' };
    };
    await mountCurrent();
    check('identity change during qualification cannot record the previous account notice', () => {
      assert.deepEqual(receiptCalls.map(call => call.name), ['get_my_global_access']);
    });
    receiptSession = { access_token: 'owner-a-token', user: { id: 'owner-a' } };
    accessHandler = async () => {
      receiptSession = { access_token: 'owner-a-refreshed-token', user: { id: 'owner-a' } };
      return { legalApproved: true, privacyVersion: 'nearr-global-privacy-v1' };
    };
    await mountCurrent();
    check('presented current approved notice records only its own version using the same owner refreshed token', () => {
      assert.deepEqual(receiptCalls.map(call => call.name), ['get_my_global_access', 'record_global_privacy_notice']);
      assert.equal(receiptCalls[1].transport.accessToken, 'owner-a-refreshed-token');
      assert.deepEqual(receiptCalls[1].args, { p_notice_version: 'nearr-global-privacy-v1' });
      assert.equal(receiptCalls.some(call => ['record_global_terms', 'set_ai_sharing_permission'].includes(call.name)), false);
    });
  } finally {
    if (screen) TestRenderer.act(() => screen.unmount());
    Module._load = originalLoad;
  }
  console.log(`\n${checks} privacy policy tests passed. No network, Store build, legal approval or publication performed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
