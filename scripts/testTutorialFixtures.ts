import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { parseTutorialFixtureResolution } from '../supabase/functions/process-share-jobs/tutorialFixture';
import { loadManifest, validateManifestEntry } from './tutorialFixtures/core';

const root = process.cwd();
const migration = readFileSync(path.join(root, 'supabase/migrations/20260909000002_curated_tutorial_fixtures_v1.sql'), 'utf8');
const processor = readFileSync(path.join(root, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
const manifest = loadManifest();
assert.equal(manifest.length, 1);
validateManifestEntry(manifest[0]!);

const shorts = canonicalContentIdentity('https://www.youtube.com/shorts/rrKmN3zZ0lM');
const watch = canonicalContentIdentity('https://www.youtube.com/watch?v=rrKmN3zZ0lM&utm_source=test');
const shortLink = canonicalContentIdentity('https://youtu.be/rrKmN3zZ0lM?si=tutorial');
assert.ok(shorts && watch && shortLink);
assert.equal(shorts.key, manifest[0]!.identityKey);
assert.deepEqual([shorts.key, watch.key, shortLink.key], Array(3).fill(manifest[0]!.identityKey));

const validRow = {
  fixture_id: manifest[0]!.fixtureId,
  fixture_revision: 1,
  fixture_role: 'primary',
  fixture_priority: 100,
  fixture_canonical_url: shorts.canonicalUrl,
  fixture_place_id: '1896322f-b910-4f0c-ab69-0a9648ee3790',
  google_place_id: manifest[0]!.googlePlaceId,
  place_name: manifest[0]!.expectedPlaceName,
  formatted_address: 'Attabad Lake, Hunza Nagar',
  latitude: manifest[0]!.expectedLatitude,
  longitude: manifest[0]!.expectedLongitude,
  google_primary_type: null,
  google_types: [],
  google_type_label: null,
  business_status: null,
};
const parsed = parseTutorialFixtureResolution(validRow, shorts);
assert.ok(parsed);
assert.equal(parsed.candidate.googlePlaceId, manifest[0]!.googlePlaceId);
assert.equal(parseTutorialFixtureResolution({ ...validRow, fixture_canonical_url: 'https://example.com' }, shorts), null);
assert.equal(parseTutorialFixtureResolution({ ...validRow, business_status: 'CLOSED_PERMANENTLY' }, shorts), null);
assert.equal(parseTutorialFixtureResolution({ ...validRow, latitude: 999 }, shorts), null);

assert.match(migration, /unique index onboarding_tutorial_fixtures_one_active_identity_idx[\s\S]*where status = 'active'/);
assert.match(migration, /health_expires_at > now\(\)/);
assert.match(migration, /expected_media_sha256 = f\.last_observed_media_sha256/);
assert.match(migration, /p\.merged_into_place_id is null/);
assert.match(migration, /recognition_correction_quarantine_tutorial_fixture/);
assert.match(migration, /status = 'quarantined'[\s\S]*last_health_error_code = 'user_wrong_place'/);
assert.match(migration, /grant execute on function public\.resolve_onboarding_tutorial_fixture[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}to authenticated/);

const fixtureCall = processor.indexOf('useTutorialFixture({ admin, job, identity: activeIdentity');
const cacheCall = processor.indexOf('prepareRecognitionIdentity(admin, job, activeIdentity');
assert.ok(fixtureCall > 0 && cacheCall > fixtureCall, 'fixture lookup must precede Cache V2 preparation');
assert.match(processor, /recognition_run_mode !== 'normal'\) return false/);
assert.match(processor, /resolution_source: 'tutorial_fixture'/);
assert.match(processor, /__skipRecognitionCachePersist: true/);
assert.match(processor, /modelInvoked: false/);
assert.match(processor, /mediaInvoked: false/);
assert.match(processor, /ruleVersion: TUTORIAL_FIXTURE_RULE_VERSION/);
assert.match(processor, /reasonCodes: \['curated_tutorial_fixture', 'exact_canonical_source_identity'\]/);

console.log('PASS tutorial fixture identity, eligibility, ordering, result, quarantine, and Cache V2 separation contracts');
