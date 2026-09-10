import type { CanonicalContentIdentity } from '../../../lib/shareAgent/contentIdentity.ts';

export const TUTORIAL_FIXTURE_RULE_VERSION = 'tutorial-fixture.v1';
export const TUTORIAL_FIXTURE_PROVENANCE = 'onboarding_tutorial_verified';

export type TutorialFixtureResolution = {
  fixtureId: string;
  fixtureRevision: number;
  fixtureRole: 'primary' | 'backup';
  fixturePriority: number;
  canonicalUrl: string;
  placeId: string;
  candidate: {
    googlePlaceId: string;
    name: string;
    formattedAddress: string | null;
    latitude: number;
    longitude: number;
    types: string[];
    primaryType: string | null;
    primaryTypeDisplayName: string | null;
    googleMapsTypeLabel: string | null;
    businessStatus: string | null;
    confidenceScore: number;
    evidence: string[];
    reasons: string[];
    contextReason: 'exact_source_evidence';
  };
};

export type TutorialFixtureLookup =
  | { kind: 'hit'; resolution: TutorialFixtureResolution; lookupLatencyMs: number }
  | { kind: 'miss'; reason: 'ineligible_or_absent' | 'invalid_row' | 'lookup_unavailable'; lookupLatencyMs: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function finiteCoordinate(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

/**
 * Defense in depth over the database eligibility RPC. A malformed or partial
 * row is always a miss; fixture data can never fabricate an automatic save.
 */
export function parseTutorialFixtureResolution(
  row: Record<string, unknown> | null | undefined,
  identity: CanonicalContentIdentity,
): TutorialFixtureResolution | null {
  if (!row) return null;
  const fixtureId = typeof row.fixture_id === 'string' ? row.fixture_id : '';
  const placeId = typeof row.fixture_place_id === 'string' ? row.fixture_place_id : '';
  const googlePlaceId = typeof row.google_place_id === 'string' ? row.google_place_id.trim() : '';
  const name = typeof row.place_name === 'string' ? row.place_name.trim() : '';
  const canonicalUrl = typeof row.fixture_canonical_url === 'string' ? row.fixture_canonical_url.trim() : '';
  const revision = Number(row.fixture_revision);
  const priority = Number(row.fixture_priority);
  const role = row.fixture_role;
  const latitude = finiteCoordinate(row.latitude, -90, 90);
  const longitude = finiteCoordinate(row.longitude, -180, 180);
  if (!UUID.test(fixtureId) || !UUID.test(placeId) || !googlePlaceId || !name ||
      canonicalUrl !== identity.canonicalUrl || !Number.isSafeInteger(revision) || revision < 1 ||
      !Number.isSafeInteger(priority) || priority < 0 || priority > 10000 ||
      (role !== 'primary' && role !== 'backup') || latitude === null || longitude === null ||
      row.business_status === 'CLOSED_PERMANENTLY') {
    return null;
  }
  return {
    fixtureId,
    fixtureRevision: revision,
    fixtureRole: role,
    fixturePriority: priority,
    canonicalUrl,
    placeId,
    candidate: {
      googlePlaceId,
      name,
      formattedAddress: typeof row.formatted_address === 'string' ? row.formatted_address : null,
      latitude,
      longitude,
      types: Array.isArray(row.google_types)
        ? row.google_types.filter((value): value is string => typeof value === 'string').slice(0, 8)
        : [],
      primaryType: typeof row.google_primary_type === 'string' ? row.google_primary_type : null,
      primaryTypeDisplayName: typeof row.google_type_label === 'string' ? row.google_type_label : null,
      googleMapsTypeLabel: typeof row.google_type_label === 'string' ? row.google_type_label : null,
      businessStatus: typeof row.business_status === 'string' ? row.business_status : null,
      confidenceScore: 1,
      evidence: ['curated_tutorial_fixture'],
      reasons: ['exact_canonical_source_identity', 'independently_verified_place'],
      contextReason: 'exact_source_evidence',
    },
  };
}

export async function lookupTutorialFixture(
  admin: any,
  identity: CanonicalContentIdentity,
): Promise<TutorialFixtureLookup> {
  const started = Date.now();
  try {
    const { data, error } = await admin.rpc('resolve_onboarding_tutorial_fixture', {
      p_identity_key: identity.key,
      p_identity_version: identity.identityVersion,
      p_platform: identity.platform,
      p_content_id: identity.contentId,
      p_canonical_url: identity.canonicalUrl,
    });
    const elapsed = Date.now() - started;
    if (error) {
      console.log(`[tutorial-fixture] lookup_unavailable code=${error.code ?? 'unknown'}`);
      return { kind: 'miss', reason: 'lookup_unavailable', lookupLatencyMs: elapsed };
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return { kind: 'miss', reason: 'ineligible_or_absent', lookupLatencyMs: elapsed };
    const resolution = rows.length === 1
      ? parseTutorialFixtureResolution(rows[0] as Record<string, unknown>, identity)
      : null;
    return resolution
      ? { kind: 'hit', resolution, lookupLatencyMs: elapsed }
      : { kind: 'miss', reason: 'invalid_row', lookupLatencyMs: elapsed };
  } catch {
    return { kind: 'miss', reason: 'lookup_unavailable', lookupLatencyMs: Date.now() - started };
  }
}

export async function recordTutorialFixtureResolution(
  admin: any,
  args: {
    jobId: string;
    userId: string;
    fixture: TutorialFixtureResolution;
    lookupLatencyMs: number;
    totalResolutionLatencyMs: number;
  },
): Promise<void> {
  const properties = {
    share_job_id: args.jobId,
    resolution_source: 'tutorial_fixture',
    fixture_id: args.fixture.fixtureId,
    fixture_role: args.fixture.fixtureRole,
    fixture_revision: args.fixture.fixtureRevision,
    cache_hit: false,
    model_invoked: false,
    media_invoked: false,
    fixture_lookup_latency_ms: args.lookupLatencyMs,
    total_resolution_latency_ms: args.totalResolutionLatencyMs,
  };
  try {
    const [analytics, audit] = await Promise.all([
      admin.from('analytics_events').insert({
        user_id: args.userId,
        event_name: 'tutorial_fixture_resolved',
        properties,
      }),
      admin.from('onboarding_tutorial_fixture_events').insert({
        fixture_id: args.fixture.fixtureId,
        event_type: 'resolved',
        from_status: 'active',
        to_status: 'active',
        verification_revision: args.fixture.fixtureRevision,
        actor: 'process-share-jobs',
        reason_code: 'exact_identity_match',
        source_job_id: args.jobId,
        user_id: args.userId,
        detail: {
          lookup_latency_ms: args.lookupLatencyMs,
          total_resolution_latency_ms: args.totalResolutionLatencyMs,
        },
      }),
    ]);
    if (analytics.error || audit.error) {
      console.log(`[tutorial-fixture] diagnostics_write_failed job_id=${args.jobId}`);
    }
  } catch {
    // Diagnostics are never allowed to block a verified user result.
  }
}
