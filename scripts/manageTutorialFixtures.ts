import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import {
  developmentAdmin,
  FIXTURE_HEALTH_TTL_DAYS,
  loadManifest,
  parseOptions,
  readFixture,
  requireOption,
  sourceHealthProbe,
  validateManifestEntry,
  writeFixtureEvent,
  type FixtureRow,
} from './tutorialFixtures/core';

const FIXTURE_COLUMNS = 'id,identity_key,identity_version,platform,content_id,canonical_url,place_id,status,role,priority,provenance,verification_revision,verified_at,verified_by,expected_media_sha256,last_observed_media_sha256,health_state,last_health_checked_at,health_expires_at,last_health_error_code,disabled_at,disabled_reason,created_at,updated_at';

async function register(db: any, options: Record<string, string | boolean>): Promise<void> {
  const manifest = loadManifest(typeof options.manifest === 'string' ? options.manifest : undefined);
  const wanted = typeof options.id === 'string' ? manifest.filter((entry) => entry.fixtureId === options.id) : manifest;
  if (!wanted.length) throw new Error('manifest_fixture_not_found');
  for (const entry of wanted) {
    validateManifestEntry(entry);
    const { data: existing, error: existingError } = await db.from('onboarding_tutorial_fixtures').select(FIXTURE_COLUMNS).eq('id', entry.fixtureId).maybeSingle();
    if (existingError) throw new Error(`fixture_read_failed:${existingError.message}`);
    if (existing) {
      if (existing.identity_key !== entry.identityKey || existing.canonical_url !== entry.canonicalUrl) {
        throw new Error(`existing_fixture_identity_conflict:${entry.fixtureId}`);
      }
      console.log(JSON.stringify({ action: 'register', fixtureId: entry.fixtureId, result: 'already_registered', status: existing.status }));
      continue;
    }
    const { data: place, error: placeError } = await db.from('places')
      .select('id,google_place_id,name,latitude,longitude,business_status,merged_into_place_id')
      .eq('google_place_id', entry.googlePlaceId).maybeSingle();
    if (placeError) throw new Error(`canonical_place_read_failed:${placeError.message}`);
    if (!place || place.name !== entry.expectedPlaceName || Number(place.latitude) !== entry.expectedLatitude ||
        Number(place.longitude) !== entry.expectedLongitude || place.merged_into_place_id ||
        place.business_status === 'CLOSED_PERMANENTLY') {
      throw new Error(`canonical_place_missing_or_mismatched:${entry.fixtureId}`);
    }
    const probe = await sourceHealthProbe({
      canonical_url: entry.canonicalUrl,
      identity_key: entry.identityKey,
      expected_media_sha256: entry.expectedMediaSha256,
    }, options['verify-fingerprint'] === true);
    const now = new Date();
    const expires = new Date(now.getTime() + FIXTURE_HEALTH_TTL_DAYS * 86400_000);
    const payload = {
      id: entry.fixtureId,
      identity_key: entry.identityKey,
      identity_version: entry.identityVersion,
      platform: entry.platform,
      content_id: entry.contentId,
      canonical_url: entry.canonicalUrl,
      place_id: place.id,
      status: 'active',
      role: entry.role,
      priority: entry.priority,
      provenance: 'onboarding_tutorial_verified',
      verification_revision: 1,
      verified_at: now.toISOString(),
      verified_by: entry.verifiedBy,
      expected_media_sha256: entry.expectedMediaSha256,
      last_observed_media_sha256: probe.mediaSha256,
      health_state: 'healthy',
      last_health_checked_at: now.toISOString(),
      health_expires_at: expires.toISOString(),
    };
    const { data: inserted, error } = await db.from('onboarding_tutorial_fixtures').insert(payload).select(FIXTURE_COLUMNS).single();
    if (error) throw new Error(`fixture_register_failed:${error.message}`);
    await writeFixtureEvent(db, inserted as FixtureRow, 'registered', 'active', 'manage-tutorial-fixtures', 'independently_verified_registration', {
      source_corpus_id: entry.sourceCorpusId,
      source_probe_format_count: probe.formatCount,
    });
    console.log(JSON.stringify({ action: 'register', fixtureId: entry.fixtureId, result: 'registered', placeId: place.id }));
  }
}

async function transition(db: any, command: 'disable' | 'quarantine', options: Record<string, string | boolean>): Promise<void> {
  const id = requireOption(options, 'id');
  const reason = requireOption(options, 'reason');
  const actor = requireOption(options, 'actor');
  const fixture = await readFixture(db, id);
  const toStatus = command === 'disable' ? 'disabled' : 'quarantined';
  const patch = command === 'disable'
    ? { status: toStatus, health_state: fixture.health_state, disabled_at: new Date().toISOString(), disabled_reason: reason, updated_at: new Date().toISOString() }
    : { status: toStatus, health_state: 'quarantined', last_health_error_code: reason, disabled_at: null, disabled_reason: null, updated_at: new Date().toISOString() };
  const { error } = await db.from('onboarding_tutorial_fixtures').update(patch).eq('id', id);
  if (error) throw new Error(`fixture_${command}_failed:${error.message}`);
  await writeFixtureEvent(db, fixture, command === 'disable' ? 'disabled' : 'quarantined', toStatus, actor, reason);
  console.log(JSON.stringify({ action: command, fixtureId: id, from: fixture.status, to: toStatus }));
}

async function reverify(db: any, options: Record<string, string | boolean>): Promise<void> {
  const id = requireOption(options, 'id');
  const reason = requireOption(options, 'reason');
  const actor = requireOption(options, 'actor');
  const confirmedIdentity = requireOption(options, 'confirm-identity');
  const confirmedPlaceId = requireOption(options, 'confirm-place-id');
  const fixture = await readFixture(db, id);
  if (confirmedIdentity !== fixture.identity_key || confirmedPlaceId !== fixture.place_id) {
    throw new Error('reverification_confirmation_mismatch');
  }
  const identity = canonicalContentIdentity(fixture.canonical_url);
  if (!identity || identity.key !== fixture.identity_key) throw new Error('reverification_canonical_identity_mismatch');
  const { data: place, error: placeError } = await db.from('places')
    .select('id,google_place_id,name,business_status,merged_into_place_id').eq('id', fixture.place_id).maybeSingle();
  if (placeError || !place || !place.google_place_id || place.merged_into_place_id || place.business_status === 'CLOSED_PERMANENTLY') {
    throw new Error('reverification_place_unusable');
  }
  const probe = await sourceHealthProbe(fixture, options['verify-fingerprint'] === true);
  const now = new Date();
  const revision = Number(fixture.verification_revision) + 1;
  const patch = {
    status: 'active', health_state: 'healthy', verification_revision: revision,
    verified_at: now.toISOString(), verified_by: actor,
    last_health_checked_at: now.toISOString(),
    health_expires_at: new Date(now.getTime() + FIXTURE_HEALTH_TTL_DAYS * 86400_000).toISOString(),
    last_observed_media_sha256: probe.mediaSha256,
    last_health_error_code: null, disabled_at: null, disabled_reason: null, updated_at: now.toISOString(),
  };
  const { error } = await db.from('onboarding_tutorial_fixtures').update(patch).eq('id', id).eq('verification_revision', fixture.verification_revision);
  if (error) throw new Error(`fixture_reverify_failed:${error.message}`);
  await writeFixtureEvent(db, { ...fixture, verification_revision: revision }, 'reactivated', 'active', actor, reason, {
    previous_revision: fixture.verification_revision,
    source_probe_format_count: probe.formatCount,
  });
  console.log(JSON.stringify({ action: 'reverify', fixtureId: id, from: fixture.status, to: 'active', revision }));
}

async function run(): Promise<void> {
  const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!command || !['register','inspect','disable','quarantine','reverify','list'].includes(command)) {
    throw new Error('usage: manageTutorialFixtures.ts <register|inspect|disable|quarantine|reverify|list> [--key=value]');
  }
  const options = parseOptions();
  const { db, ref } = developmentAdmin();
  if (command === 'register') await register(db, options);
  else if (command === 'disable' || command === 'quarantine') await transition(db, command, options);
  else if (command === 'reverify') await reverify(db, options);
  else {
    let query = db.from('onboarding_tutorial_fixtures').select(`${FIXTURE_COLUMNS},place:places(id,google_place_id,name,business_status,merged_into_place_id)`)
      .order('priority', { ascending: false }).order('created_at', { ascending: true });
    if (command === 'inspect') query = query.eq('id', requireOption(options, 'id'));
    if (command === 'list' && typeof options.status === 'string') query = query.eq('status', options.status);
    const { data, error } = await query;
    if (error) throw new Error(`fixture_${command}_failed:${error.message}`);
    console.log(JSON.stringify({ target: ref, command, fixtures: data }, null, 2));
  }
}

run().catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
