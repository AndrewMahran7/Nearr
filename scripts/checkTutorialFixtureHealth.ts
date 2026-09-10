import {
  developmentAdmin,
  FIXTURE_HEALTH_TTL_DAYS,
  parseOptions,
  readFixture,
  sourceHealthProbe,
  writeFixtureEvent,
  type FixtureRow,
} from './tutorialFixtures/core';

async function run(): Promise<void> {
  const options = parseOptions();
  const { db, ref } = developmentAdmin();
  let fixtures: FixtureRow[];
  if (typeof options.id === 'string') fixtures = [await readFixture(db, options.id)];
  else {
    const { data, error } = await db.from('onboarding_tutorial_fixtures').select('*').in('status', ['active','stale']);
    if (error) throw new Error(`fixture_health_list_failed:${error.message}`);
    fixtures = (data ?? []) as FixtureRow[];
  }
  const results: Array<Record<string, unknown>> = [];
  for (const fixture of fixtures) {
    try {
      const { data: place, error: placeError } = await db.from('places')
        .select('id,google_place_id,business_status,merged_into_place_id').eq('id', fixture.place_id).maybeSingle();
      if (placeError || !place || !place.google_place_id || place.merged_into_place_id || place.business_status === 'CLOSED_PERMANENTLY') {
        throw new Error('canonical_place_unusable');
      }
      const probe = await sourceHealthProbe(fixture, options['verify-fingerprint'] === true);
      const now = new Date();
      // Health checks never reactivate quarantine/disabled fixtures. That
      // always requires the explicit reverify command and identity/place pins.
      const nextStatus = fixture.status === 'active' ? 'active' : fixture.status;
      const { error } = await db.from('onboarding_tutorial_fixtures').update({
        health_state: 'healthy', last_health_checked_at: now.toISOString(),
        health_expires_at: new Date(now.getTime() + FIXTURE_HEALTH_TTL_DAYS * 86400_000).toISOString(),
        last_observed_media_sha256: probe.mediaSha256,
        last_health_error_code: null, updated_at: now.toISOString(),
      }).eq('id', fixture.id);
      if (error) throw new Error(`health_update_failed:${error.message}`);
      await writeFixtureEvent(db, fixture, 'health_passed', nextStatus, 'tutorial-fixture-health', 'source_and_place_healthy', {
        source_probe_format_count: probe.formatCount, title_present: probe.titlePresent,
      });
      results.push({ fixtureId: fixture.id, status: nextStatus, health: 'healthy', identityKey: probe.identityKey });
    } catch (error: any) {
      const code = String(error?.message ?? 'health_check_failed').slice(0, 120);
      const severe = code.includes('identity_mismatch') || code.includes('fingerprint_mismatch') || code.includes('canonical_place_unusable');
      const nextStatus = severe ? 'quarantined' : 'stale';
      const healthState = code.includes('identity_mismatch') ? 'identity_mismatch'
        : code.includes('fingerprint_mismatch') ? 'fingerprint_mismatch'
        : code.includes('canonical_place') ? 'quarantined' : 'unavailable';
      const { error: updateError } = await db.from('onboarding_tutorial_fixtures').update({
        status: nextStatus, health_state: healthState, last_health_checked_at: new Date().toISOString(),
        health_expires_at: null, last_health_error_code: code,
        disabled_at: null, disabled_reason: null, updated_at: new Date().toISOString(),
      }).eq('id', fixture.id);
      if (updateError) throw new Error(`health_failure_update_failed:${updateError.message}`);
      await writeFixtureEvent(db, fixture, severe ? 'quarantined' : 'stale', nextStatus, 'tutorial-fixture-health', code);
      results.push({ fixtureId: fixture.id, status: nextStatus, health: healthState, errorCode: code });
    }
  }
  console.log(JSON.stringify({ target: ref, checked: results.length, results }, null, 2));
  if (results.some((result) => result.health !== 'healthy')) process.exitCode = 1;
}

run().catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
