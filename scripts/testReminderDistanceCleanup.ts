/**
 * Contracts for removing the obsolete profile-wide reminder-distance setting
 * without changing Nearby Notifications V2's saved-place/category policy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (relativePath: string): string =>
  readFileSync(resolve(root, relativePath), 'utf8');

let passed = 0;
function check(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const settings = read('app/(tabs)/settings.tsx');
check('Settings no longer renders the obsolete distance control', () => {
  assert.doesNotMatch(settings, /Default reminder distance/);
  assert.doesNotMatch(settings, /default_radius_(value|unit)/);
  assert.doesNotMatch(settings, /radiusText|setRadiusText|radiusUnit|setRadiusUnit/);
});
check('Settings keeps the nearby reminder preference', () => {
  assert.match(settings, /label="Nearby alerts"/);
  assert.match(settings, /nearby_notifications_enabled/);
});

const profileService = read('services/profileService.ts');
const profileSelect = profileService.match(/const PROFILE_SELECT\s*=\s*\n?\s*'([^']+)'/)?.[1] ?? '';
const profilePatch = profileService.match(/export type ProfilePatch = \{([\s\S]*?)\n\};/)?.[1] ?? '';
check('Current profile reads exclude legacy radius columns', () => {
  assert.ok(profileSelect.length > 0, 'PROFILE_SELECT must be explicit');
  assert.doesNotMatch(profileSelect, /default_radius_/);
});
check('Current profile writes cannot include legacy radius columns', () => {
  assert.ok(profilePatch.length > 0, 'ProfilePatch must be found');
  assert.doesNotMatch(profilePatch, /default_radius_/);
});

const snapshot = read('lib/reminderSnapshot.ts');
const reminderProfile = snapshot.match(/export type ReminderProfile = \{([\s\S]*?)\n\};/)?.[1] ?? '';
check('Offline reminder profile excludes legacy radius fields', () => {
  assert.ok(reminderProfile.length > 0, 'ReminderProfile must be found');
  assert.doesNotMatch(reminderProfile, /default_radius_/);
  assert.match(snapshot, /profile: toReminderProfile/);
});

const notifications = read('lib/notifications.ts');
check('Notification radius resolver has no profile/default input', () => {
  assert.match(
    notifications,
    /export function effectiveRadiusMeters\(saved: ReminderPlace\): number \{\s*return getEffectiveNearbyNotificationRadiusMeters\(saved\);/,
  );
  assert.doesNotMatch(notifications, /effectiveRadiusMeters\([^)]*,\s*profile\)/);
});

const geofencing = read('lib/geofencing.ts');
const map = read('app/(tabs)/map.tsx');
const addPlace = read('app/add-place.tsx');
const placeDetails = read('components/map/SelectedPlaceDetails.tsx');
check('Geofence registration uses the same V2 radius resolver', () => {
  assert.match(geofencing, /clampRegionRadius\(effectiveRadiusMeters\(s\)\)/);
});
check('Map radius display uses the shared V2 policy without fetching a profile default', () => {
  assert.match(map, /getEffectiveNearbyNotificationRadiusMeters\(s\)/);
  assert.doesNotMatch(map, /getProfile|default_radius_/);
});
check('Per-place automatic mode no longer implies a profile default', () => {
  assert.match(addPlace, /label="Auto"/);
  assert.match(placeDetails, /<RadiusOption label="Auto"/);
  assert.doesNotMatch(addPlace, /Default \(auto\)/);
  assert.doesNotMatch(placeDetails, /<RadiusOption label="Default"/);
});

const migration = read('supabase/migrations/20260426000001_init_schema.sql');
check('Legacy database columns remain for old-client compatibility', () => {
  assert.match(migration, /default_radius_value/);
  assert.match(migration, /default_radius_unit/);
});

console.log(`PASS reminder-distance cleanup contracts (${passed} checks)`);
