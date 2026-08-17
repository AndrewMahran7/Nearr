/**
 * scripts/testProviderApiPath.ts
 *
 * PINNED contract for WHICH GOOGLE PLACES SURFACE SERVED A SEARCH.
 *
 * Nearr is designed around Places API (New): it alone returns `primaryType`,
 * which scoring and the geographic guards consume. `searchPlacesLegacy` exists
 * as resilience and has no `primaryType` contract at all — Legacy results are
 * mapped with `primaryType: undefined` on purpose.
 *
 * The failure this pins is not a crash, it is a SILENCE. A key that is not
 * allowed to call Places API (New) returns 403 API_KEY_SERVICE_BLOCKED on every
 * request, forever. The old code fell back and said nothing, so Nearr could
 * live permanently on the degraded provider while every search still "worked".
 * A recognition failure measured on that path is not comparable to one measured
 * on the intended path, which makes it poison for a failure audit.
 *
 * So: the surface used is now reported, a configuration-shaped fallback is
 * distinguishable from a transient one, and neither the key nor the raw error
 * body ever appears in what we keep.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testProviderApiPath.ts
 */

import {
  mapPlacesV1Candidate,
  mapPlacesLegacyCandidate,
} from '../supabase/functions/process-share-link/places/googlePlaces';
import { resolveVenueMentions } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type { SearchPlacesResult } from '../supabase/functions/process-share-link/places/googlePlaces';
import type { VenueMention, MediaGeoContext } from '../supabase/functions/process-share-jobs/mediaMentions';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

// ---------------------------------------------------------------------------
// 1. Normalization: New keeps primaryType, Legacy cannot invent one
// ---------------------------------------------------------------------------

const v1Raw = {
  id: 'place_new_1',
  displayName: { text: 'Brooklyn City Pizzeria & Market' },
  formattedAddress: '30012 Crown Valley Pkwy, Laguna Niguel, CA 92677, USA',
  location: { latitude: 33.52, longitude: -117.71 },
  primaryType: 'pizza_restaurant',
  primaryTypeDisplayName: { text: 'Pizza restaurant' },
  types: ['pizza_restaurant', 'restaurant', 'food', 'point_of_interest'],
  businessStatus: 'OPERATIONAL',
};
const v1 = mapPlacesV1Candidate(v1Raw);
check('new: primaryType survives normalization', v1.primaryType === 'pizza_restaurant');
check('new: types survive normalization', (v1.types ?? []).includes('pizza_restaurant'));
check('new: display label retained', v1.primaryTypeDisplayName === 'Pizza restaurant');
check('new: id/name/coords retained', v1.googlePlaceId === 'place_new_1' && !!v1.name && v1.latitude === 33.52);

const legacyRaw = {
  place_id: 'place_legacy_1',
  name: 'Brooklyn City Pizzeria & Market',
  formatted_address: '30012 Crown Valley Pkwy, Laguna Niguel, CA 92677, USA',
  geometry: { location: { lat: 33.52, lng: -117.71 } },
  types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
  business_status: 'OPERATIONAL',
};
const legacy = mapPlacesLegacyCandidate(legacyRaw);
check('legacy: primaryType is absent, never guessed from types', legacy.primaryType === undefined);
check('legacy: types still present', (legacy.types ?? []).includes('restaurant'));
check(
  'legacy: the first type is NOT promoted to primaryType',
  legacy.primaryType !== legacyRaw.types[0],
);

// ---------------------------------------------------------------------------
// 2. Provider path is visible through the resolver
// ---------------------------------------------------------------------------

function mention(over: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: 'Brooklyn City Pizzeria',
    normalizedName: 'brooklyn city pizzeria',
    distinctiveTokens: ['brooklyn', 'city'],
    category: null,
    sources: ['caption'],
    nameEvidenceSources: ['caption'],
    timestamps: [],
    mentionCount: 1,
    repeated: false,
    confidence: 0.9,
    geo: { city: null, region: null, country: null },
    ...over,
  } as VenueMention;
}
const GEO: MediaGeoContext = { city: null, region: null, country: null };

async function runWith(searchResult: () => SearchPlacesResult, counter?: { n: number }) {
  return resolveVenueMentions({
    mentions: [mention()],
    geoContext: GEO,
    env: { googlePlacesKey: 'test-key' } as never,
    platform: 'instagram',
    deps: {
      search: async () => { if (counter) counter.n += 1; return searchResult(); },
      geocode: async () => null,
    },
  });
}

async function main(): Promise<void> {

// --- New succeeds: Legacy must never be consulted -------------------------
{
  const counter = { n: 0 };
  const r = await runWith(() => ({ ok: true, results: [v1], apiPath: 'places_new' }), counter);
  const d = r.resolutionDiagnostics;
  check('new success: provider path recorded as places_new', d.providerApiPath === 'places_new');
  check('new success: no fallback flagged', d.providerFallbackUsed === false);
  check('new success: no fallback reason', d.providerFallbackReason === undefined);
  check('new success: exactly one provider call (no double billing)', counter.n === 1);
  check('new success: primaryType reached the resolver', r.mentionResults[0]!.scoring[0]?.name === v1.name);
}

// --- Service-blocked fallback: degraded path must be visible --------------
{
  const r = await runWith(() => ({
    ok: true,
    results: [legacy],
    apiPath: 'places_legacy',
    fallbackReason: 'service_blocked',
  }));
  const d = r.resolutionDiagnostics;
  check('service blocked: provider path recorded as places_legacy', d.providerApiPath === 'places_legacy');
  check('service blocked: fallback flagged', d.providerFallbackUsed === true);
  check('service blocked: reason is the bounded code', d.providerFallbackReason === 'service_blocked');
  check(
    'service blocked: reason is a closed vocabulary, not a raw error',
    !JSON.stringify(d).toLowerCase().includes('permission_denied'),
  );
}

// --- A transient provider failure is NOT a configuration fallback ---------
{
  const r = await runWith(() => ({ ok: false, reason: 'http_error', status: '503', apiPath: 'places_new' }));
  const d = r.resolutionDiagnostics;
  check('transient error: still attributed to the new path', d.providerApiPath === 'places_new');
  check('transient error: not reported as a fallback', d.providerFallbackUsed === false);
  check('transient error: outcome is provider_error', r.providerErrorCount === 1);
}

// --- Degraded wins across mentions ----------------------------------------
{
  let call = 0;
  const r = await resolveVenueMentions({
    mentions: [mention({ id: 'm1' }), mention({ id: 'm2', displayName: 'Other Place', distinctiveTokens: ['other'] })],
    geoContext: GEO,
    env: { googlePlacesKey: 'k' } as never,
    platform: 'instagram',
    deps: {
      search: async () => {
        call += 1;
        return call === 1
          ? { ok: true, results: [v1], apiPath: 'places_new' }
          : { ok: true, results: [legacy], apiPath: 'places_legacy', fallbackReason: 'service_blocked' };
      },
      geocode: async () => null,
    },
  });
  check(
    'mixed: one degraded search marks the whole task degraded',
    r.resolutionDiagnostics.providerApiPath === 'places_legacy',
  );
  check('mixed: fallback flagged', r.resolutionDiagnostics.providerFallbackUsed === true);
}

// --- Absent apiPath (older/hand-built doubles) stays undefined ------------
{
  const r = await runWith(() => ({ ok: true, results: [v1] }));
  check('unknown path: absent apiPath is not invented', r.resolutionDiagnostics.providerApiPath === undefined);
  check('unknown path: fallback not asserted', r.resolutionDiagnostics.providerFallbackUsed === false);
}

// ---------------------------------------------------------------------------
// 3. Failure traces carry the path, so a no-match is attributable
// ---------------------------------------------------------------------------

{
  const r = await runWith(() => ({
    ok: true,
    results: [],
    apiPath: 'places_legacy',
    fallbackReason: 'service_blocked',
  }));
  const trace = r.resolutionDiagnostics.failureTraces[0];
  check('trace: a no-match records which surface produced it', trace?.providerApiPath === 'places_legacy');
  check('trace: reason still derived normally', trace?.noMatchReason === 'provider_empty');
}

// ---------------------------------------------------------------------------
// 4. Nothing sensitive is retained
// ---------------------------------------------------------------------------

{
  const r = await runWith(() => ({
    ok: true,
    results: [legacy],
    apiPath: 'places_legacy',
    fallbackReason: 'service_blocked',
  }));
  const json = JSON.stringify(r.resolutionDiagnostics);
  check('privacy: no api key in diagnostics', !json.includes('test-key'));
  check('privacy: no endpoint url', !json.includes('googleapis.com'));
  check('privacy: no raw google error text', !json.includes('API_KEY_SERVICE_BLOCKED'));
}

}

main().then(() => {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
