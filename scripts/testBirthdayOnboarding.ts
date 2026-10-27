import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { birthdayAge, birthdayDeclaration, localCalendarDate } from '../lib/birthdayEligibility';
import { assessDeclaration } from '../lib/globalEligibility';
import { resolveLocale } from '../lib/i18nCore';
import { LightPalette } from '../constants/colors';

const today = { year: 2026, month: 10, day: 26 };
assert.equal(birthdayAge({ year: 2013, month: 10, day: 26 }, today), 13);
assert.equal(birthdayAge({ year: 2013, month: 10, day: 27 }, today), 12);
assert.equal(birthdayAge({ year: 2026, month: 10, day: 27 }, today), null);
assert.equal(birthdayAge({ year: 2000, month: 2, day: 29 }, today), 26);
assert.equal(birthdayAge({ year: 1900, month: 2, day: 29 }, today), null);
assert.equal(birthdayAge({ year: 2011, month: 2, day: 29 }, today), null);
assert.equal(birthdayAge({ year: 2000, month: 4, day: 31 }, today), null);
assert.equal(birthdayAge({ year: NaN, month: 1, day: 1 }, today), null);
assert.equal(birthdayAge({ year: 2012, month: 2, day: 29 }, { year: 2025, month: 2, day: 28 }), 12);
assert.equal(birthdayAge({ year: 2012, month: 2, day: 29 }, { year: 2025, month: 3, day: 1 }), 13);
const local = new Date(2026, 9, 26, 0, 1);
assert.deepEqual(localCalendarDate(local), today, 'local midnight, not UTC conversion');
assert.equal(birthdayDeclaration(null, 'US', today), null);
assert.equal(birthdayDeclaration({ year: 2000, month: 1, day: 1 }, null, today), null);
assert.deepEqual(birthdayDeclaration({ year: 2000, month: 1, day: 1 }, 'US', today), { ageBand: '18_plus', countryCode: 'US' });
assert.equal(assessDeclaration(birthdayDeclaration({ year: 2013, month: 10, day: 26 }, 'US', today)!).status, 'eligible');
assert.equal(assessDeclaration(birthdayDeclaration({ year: 2013, month: 10, day: 27 }, 'US', today)!).status, 'under_minimum');
assert.equal(assessDeclaration(birthdayDeclaration({ year: 2011, month: 10, day: 26 }, 'DE', today)!).status, 'under_minimum');
assert.equal(assessDeclaration(birthdayDeclaration({ year: 2000, month: 1, day: 1 }, 'ZZ', today)!).status, 'region_unavailable');
assert.equal(resolveLocale(['ar-SA']), 'en-US');
assert.equal(resolveLocale(['zh-Hant', 'ko-KR']), 'ko');
assert.equal(resolveLocale(['de-DE']), 'de');

const Module = require('node:module');
const originalLoad = Module._load;
let confirmed = false;
let locale = 'en-US';
let picker: any;
let back: (() => boolean) | null = null;
let access: any = { status: 'pending' };
const calls: Array<{ name: string; args: unknown }> = [];
const stored = new Map<string, string>();
const storage = { getItem: async (key: string) => stored.get(key) ?? null, setItem: async (key: string, value: string) => { stored.set(key, value); } };
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') return {
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: ({ visible, children }: any) => visible ? React.createElement('Modal', {}, children) : null,
    ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'android' }, Linking: { openURL() {} },
    useWindowDimensions: () => ({ height: 640, fontScale: 1.6 }),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    BackHandler: { addEventListener: (_name: string, callback: () => boolean) => { back = callback; return { remove: () => { back = null; } }; } },
    AppState: { addEventListener: () => ({ remove() {} }) },
  };
  if (request === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === 'expo-status-bar') return { StatusBar: 'StatusBar' };
  if (request === '@react-native-community/datetimepicker') return { __esModule: true, default: 'DateTimePicker', DateTimePickerAndroid: { open: (value: unknown) => { picker = value; } } };
  if (request === '@react-native-async-storage/async-storage') return storage;
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: LightPalette, resolvedTheme: 'light' }) };
  if (request === '@/lib/i18n') return { t: (key: string) => key };
  if (request === '@/hooks/useLocale') return { useLocale: () => ({ ready: true, confirmed, locale, setLocale: async (value: string) => { locale = value; confirmed = true; } }) };
  if (request.endsWith('/lib/supabase')) return { supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    rpc: (name: string, args: unknown) => { calls.push({ name, args }); return { abortSignal: async () => { if (name === 'declare_global_eligibility') { access = { status: 'eligible', aiAllowed: false }; return { data: 'eligible', error: null }; } return { data: access, error: null }; } }; },
  } };
  if (request.endsWith('/lib/splashLifecycle')) return { hideNativeSplashWhenReady: async () => {} };
  if (request.startsWith('@/')) return originalLoad.call(this, path.join(process.cwd(), request.slice(2)), parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { AgeEligibilityGate } = require('../components/AgeEligibilityGate');
  const { BirthdayPicker } = require('../components/onboarding/BirthdayPicker');
  const { EligibilityContinue } = require('../components/onboarding/EligibilityFrame');
  let cta!: ReactTestRenderer;
  await act(async () => { cta = create(React.createElement(EligibilityContinue, { onPress() {}, busy: true })); });
  assert.equal(cta.root.findByType('Pressable').props.accessibilityLabel, 'Saving…');
  await act(async () => { cta.update(React.createElement(EligibilityContinue, { onPress() {}, busy: false })); });
  assert.equal(cta.root.findByType('Pressable').props.accessibilityLabel, 'Continue', 'busy announcement must clear after language saving');
  assert.equal(cta.root.findByType('Pressable').props.accessibilityState.busy, false);
  await act(async () => { cta.unmount(); });
  const { PreAccountEligibility } = require('../components/PreAccountEligibility');
  const { bindLocalDeclarationToNewAnonymous, readOwnedLocalDeclaration, LOCAL_ELIGIBILITY_KEY } = require('../lib/localEligibility');
  const { useAgeEligibility } = require('../hooks/useAgeEligibility');
  let screen!: ReactTestRenderer;
  let fail = true;
  const declarations: unknown[] = [];
  const props = { status: 'pending', submitting: false, onRetry() {}, onDeclare: async (value: unknown) => { declarations.push(value); return !fail; } };
  const text = () => JSON.stringify(screen.toJSON());
  const press = (id: string) => screen.root.findAll(node => String(node.type) === 'Pressable' && node.props.testID === id)[0].props.onPress();
  await act(async () => { screen = create(React.createElement(AgeEligibilityGate, props)); });
  assert.match(text(), /Choose your language/);
  assert.doesNotMatch(text(), /When’s your birthday/);
  await act(async () => { press('onboarding-language-de'); });
  await act(async () => { press('eligibility-continue'); });
  assert.match(text(), /When’s your birthday/);
  assert.doesNotMatch(text(), /Choose your language/);
  assert.equal(screen.root.findByType(BirthdayPicker).props.value, null, 'no arbitrary birthday');
  await act(async () => { press('birthday-picker'); });
  assert.equal(picker.mode, 'date'); assert.equal(picker.display, 'spinner'); assert.ok(picker.maximumDate <= new Date());
  await act(async () => { picker.onChange({ type: 'set' }, picker.value); });
  assert.equal(screen.root.findByType(BirthdayPicker).props.value, null, 'unmodified native seed cannot be accidentally submitted');
  await act(async () => { picker.onChange({ type: 'dismissed' }, new Date(2000, 1, 29, 12)); });
  assert.equal(screen.root.findByType(BirthdayPicker).props.value, null, 'cancel is not a declaration');
  await act(async () => { picker.onChange({ type: 'set' }, new Date(2000, 1, 29, 12)); press('residence-picker'); });
  const us = screen.root.findAll(node => String(node.type) === 'Pressable' && node.findAll(child => String(child.type) === 'Text' && child.props.children === 'United States').length > 0)[0];
  await act(async () => { us.props.onPress(); });
  await act(async () => { press('eligibility-continue'); });
  assert.deepEqual(declarations, [{ ageBand: '18_plus', countryCode: 'US' }]);
  assert.deepEqual(screen.root.findByType(BirthdayPicker).props.value, { year: 2000, month: 2, day: 29 }, 'transient failure retains DOB only in screen memory');
  assert.match(text(), /couldn’t save your answer/);
  await act(async () => { back!(); });
  assert.match(text(), /Choose your language/);
  await act(async () => { press('eligibility-continue'); });
  assert.deepEqual(screen.root.findByType(BirthdayPicker).props.value, { year: 2000, month: 2, day: 29 });
  fail = false;
  await act(async () => { press('eligibility-continue'); });
  assert.equal(screen.root.findByType(BirthdayPicker).props.value, null, 'success clears DOB');
  await act(async () => { screen.unmount(); screen = create(React.createElement(AgeEligibilityGate, props)); });
  assert.match(text(), /When’s your birthday/); assert.doesNotMatch(text(), /Choose your language/);
  assert.equal(screen.root.findByType(BirthdayPicker).props.value, null, 'interrupted DOB is not persisted');
  await act(async () => { screen.update(React.createElement(AgeEligibilityGate, { ...props, status: 'under_minimum' })); });
  assert.match(text(), /Nearr isn’t available just yet/); assert.equal(screen.root.findAllByType(BirthdayPicker).length, 0);
  assert.match(text(), /request your data/);
  await act(async () => { screen.update(React.createElement(AgeEligibilityGate, { ...props, status: 'eligible' })); });
  assert.equal(screen.toJSON(), null);
  await act(async () => { screen.unmount(); screen = create(React.createElement(PreAccountEligibility, {}, React.createElement('AllowedTutorial'))); });
  await act(async () => { await screen.root.findByType(AgeEligibilityGate).props.onDeclare({ ageBand: 'under_13', countryCode: 'US' }); });
  await act(async () => { screen.unmount(); screen = create(React.createElement(PreAccountEligibility, {}, React.createElement('AllowedTutorial'))); });
  assert.equal(screen.root.findByType(AgeEligibilityGate).props.status, 'under_minimum', 'restricted state survives restart');
  assert.equal(screen.root.findAll(node => String(node.type) === 'AllowedTutorial').length, 0);
  await act(async () => { screen.unmount(); });
  stored.set(LOCAL_ELIGIBILITY_KEY, JSON.stringify({ ageBand: '18_plus', countryCode: 'US' }));
  await bindLocalDeclarationToNewAnonymous('new-anonymous');
  assert.equal(await readOwnedLocalDeclaration('other-user'), null);
  let result: any;
  function Probe({ user, anonymous }: any) { result = useAgeEligibility(user, null, anonymous); return null; }
  await act(async () => { screen = create(React.createElement(Probe, { user: 'new-anonymous', anonymous: true })); });
  assert.equal(result.status, 'eligible'); assert.equal(result.aiAllowed, false, 'client answer never authorizes AI');
  assert.deepEqual(calls.map(call => call.name), ['get_my_global_access', 'declare_global_eligibility', 'get_my_global_access']);
  assert.deepEqual(calls[1].args, { p_age_band: '18_plus', p_country_code: 'US' });
  access = { status: 'pending' }; calls.length = 0;
  await act(async () => { screen.update(React.createElement(Probe, { user: 'permanent-other', anonymous: false })); });
  assert.equal(result.status, 'pending'); assert.deepEqual(calls.map(call => call.name), ['get_my_global_access']);
  access = { status: 'eligible' }; calls.length = 0;
  await act(async () => { screen.update(React.createElement(Probe, { user: 'existing-eligible', anonymous: false })); });
  assert.equal(result.status, 'eligible'); assert.deepEqual(calls.map(call => call.name), ['get_my_global_access']);
  await act(async () => { screen.unmount(); });
  const root = readFileSync('app/_layout.tsx', 'utf8');
  assert.match(root, /key=\{session\?\.user\.id\}/, 'account switch discards former input');
  assert.match(root, /ageEligibility.status !== 'eligible'/);
  assert.match(readFileSync('components/AgeEligibilityGate.tsx', 'utf8'), /birthdayDeclaration\(birthday, countryCode\)/);
  console.log('PASS birthday onboarding: calendar/age boundaries, leap years, unknown/higher regions, minimized payload, real component transitions, native picker cancel/select, transient retry, back, restart, restricted persistence, existing-account bypass prevention, server reuse and no redundant prompt');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
