import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real module with native boundaries and a deterministic timer.
// No OS permission result, notification, database write or successful save is fabricated.
let nextId = 0;
const timers = new Map<number, { callback: () => void; delay: number }>();
let current: () => Promise<any> = async () => ({ status: 'undetermined' });
let request: () => Promise<any> = async () => ({ status: 'denied' });
let background: () => Promise<any> = async () => ({ status: 'granted' });
let nativeRequests = 0;
let writes = 0;
const location = {
  getForegroundPermissionsAsync: () => current(),
  requestForegroundPermissionsAsync: () => { nativeRequests++; return request(); },
  getBackgroundPermissionsAsync: () => background(),
  requestBackgroundPermissionsAsync: () => { nativeRequests++; return request(); },
};
const notifications = {
  setNotificationHandler() {},
  getPermissionsAsync: () => current(),
  requestPermissionsAsync: () => { nativeRequests++; return request(); },
};
const moduleExports: any = {};
const nativeMocks: Record<string, unknown> = {
  'expo-location': location, 'expo-notifications': notifications,
  'expo-task-manager': { defineTask() {} },
  'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
  '@react-native-async-storage/async-storage': {},
  './placeNotificationDedupe': { createPlaceNotificationDedupeGate: () => ({}) },
  './logger': { logDebug() {}, logInfo() {}, isDebugLoggingEnabled: () => false },
  './i18n': { t: (s: string) => s, initializeLocale: async () => {}, i18n: { language: 'en-US' } },
  './supabase': { supabase: { from() { writes++; throw new Error('permission acquisition must not persist success'); } } },
  './analytics': {}, './demoMode': {}, './mapPreview': {}, './nearbyEligibility': {},
  './geo': {}, './notificationForegroundPolicy': {}, './reminderSnapshot': {},
};
const code = ts.transpileModule(readFileSync('lib/notifications.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, {
  exports: moduleExports, module: { exports: moduleExports },
  require: (name: string) => { assert.ok(name in nativeMocks, `unmocked dependency ${name}`); return nativeMocks[name]; },
  console: { warn() {}, error() {}, log() {} },
  setTimeout: (callback: () => void, delay: number) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
  clearTimeout: (id: number) => timers.delete(id),
}, { filename: 'notifications.permission-runtime.js' });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const never = () => new Promise<any>(() => {});
const passed: string[] = [];
async function check(name: string, test: () => Promise<void>) {
  timers.clear(); nativeRequests = 0;
  current = async () => ({ status: 'undetermined' });
  request = async () => ({ status: 'denied' });
  background = async () => ({ status: 'granted' });
  await test(); assert.equal(timers.size, 0, `${name}: no timer leak`);
  passed.push(name); console.log(`PASS ${name}`);
}
async function main() {
  assert.equal(moduleExports.PERMISSION_REQUEST_TIMEOUT_MS, 10000);
  for (const name of ['ensureNotificationPermission', 'ensureForegroundLocationPermission', 'ensureBackgroundLocationPermission']) {
    const acquire: () => Promise<boolean> = moduleExports[name];
    await check(`${name}: granted`, async () => { current = async () => ({ status: 'granted' }); assert.equal(await acquire(), true); assert.equal(nativeRequests, 0); });
    await check(`${name}: denied`, async () => { assert.equal(await acquire(), false); assert.equal(nativeRequests, 1); });
    await check(`${name}: dismissed`, async () => { request = async () => ({ status: 'undetermined' }); assert.equal(await acquire(), false); });
    await check(`${name}: asynchronous native rejection`, async () => { request = async () => { throw new Error('native unavailable'); }; assert.equal(await acquire(), false); });
    await check(`${name}: unavailable synchronous native bridge`, async () => { request = () => { throw new Error('native module unavailable'); }; assert.equal(await acquire(), false); });
    await check(`${name}: status timeout`, async () => {
      current = never; const pending = acquire(); await flush();
      assert.equal(timers.size, 1); const timer = [...timers.values()][0]; assert.equal(timer.delay, 10000); timer.callback();
      assert.equal(await pending, false); assert.equal(nativeRequests, 0);
    });
    for (const late of ['resolve', 'reject'] as const) await check(`${name}: request timeout, late ${late}, retry`, async () => {
      let resolve!: (value: any) => void, reject!: (reason: any) => void;
      request = () => new Promise((yes, no) => { resolve = yes; reject = no; });
      let settlements = 0; const pending = acquire().then(result => { settlements++; return result; }); await flush();
      assert.equal(timers.size, 1); [...timers.values()][0].callback(); assert.equal(await pending, false);
      if (late === 'resolve') resolve({ status: 'granted' }); else reject(new Error('late native rejection'));
      await flush(); assert.equal(settlements, 1, 'late native result cannot mutate resolved outcome');
      current = async () => ({ status: 'granted' }); assert.equal(await acquire(), true, 'explicit retry reads fresh OS status');
    });
  }
  assert.equal(writes, 0);
  console.log(`PASS Android permission recovery (${passed.length} deterministic runtime cases; no persisted success)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
