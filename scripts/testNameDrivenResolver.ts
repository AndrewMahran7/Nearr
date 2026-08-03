/**
 * scripts/testNameDrivenResolver.ts
 *
 * Unit tests for Phase 2 name-driven multi-place verification
 * (supabase/functions/process-share-link/resolver/nameDrivenResolver.ts).
 *
 * Google Places is MOCKED (deps.search / deps.geocode injected) so CI never
 * hits the network. Covers deterministic scoring signals, per-mention outcomes,
 * partial success (one failed mention keeps the others), Place-ID dedup, distinct
 * chain locations staying distinct, provider timeout/error, request limits, and
 * per-task cache (replay idempotency).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testNameDrivenResolver.ts
 */

import {
  scoreMentionCandidate,
  classifyMention,
  resolveVenueMentions,
  normalizeStateToAbbr,
  normalizeRawScore,
  type ScoredMentionCandidate,
} from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import {
  distinctiveTokensOf,
  normalizeVenueName,
  type VenueMention,
  type MediaGeoContext,
} from '../supabase/functions/process-share-jobs/mediaMentions';
import type { PlacesCandidate, SearchPlacesResult } from '../supabase/functions/process-share-link/places/googlePlaces';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const env = { googlePlacesKey: 'test-key' } as any;

function mention(name: string, geo: Partial<MediaGeoContext> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: name,
    normalizedName: normalizeVenueName(name),
    distinctiveTokens: distinctiveTokensOf(name),
    category: 'Pizza Restaurant',
    sources: ['visible_text'],
    timestamps: [1],
    mentionCount: 1,
    repeated: false,
    confidence: 0.9,
    geo: { city: geo.city ?? null, region: geo.region ?? null, country: geo.country ?? null },
  };
}

function cand(name: string, over: Partial<PlacesCandidate> = {}): PlacesCandidate {
  return {
    googlePlaceId: over.googlePlaceId ?? `pid-${name.replace(/\W+/g, '').toLowerCase()}`,
    name,
    formattedAddress: over.formattedAddress ?? `123 Main St, Somewhere, CA, USA`,
    latitude: over.latitude,
    longitude: over.longitude,
    types: over.types ?? ['restaurant', 'food', 'point_of_interest'],
    businessStatus: over.businessStatus,
  };
}

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------
check('normalizeStateToAbbr maps full name', normalizeStateToAbbr('California') === 'CA');
check('normalizeStateToAbbr passes abbr through', normalizeStateToAbbr('ny') === 'NY');
check('normalizeStateToAbbr null on unknown', normalizeStateToAbbr('Nowhere') === null);

{
  const s = scoreMentionCandidate(cand('Parlor Woodfire'), mention('Parlor Woodfire', { region: 'California' }), {
    expectedState: 'CA',
    bias: null,
    platform: 'instagram',
  });
  check('strong+distinctive+business => high score', normalizeRawScore(s.rawScore) > 0.8, `norm=${normalizeRawScore(s.rawScore)}`);
  check('reasons include distinctive_token_match', s.reasons.includes('distinctive_token_match'));
  check('reasons include state_match', s.reasons.includes('state_match'));
}
{
  // Generic-only "match": candidate shares only the generic word "pizza".
  const s = scoreMentionCandidate(cand('Downtown Pizza', { types: ['restaurant', 'food'] }), mention('Lunita Pizza'), {
    expectedState: null,
    bias: null,
    platform: 'instagram',
  });
  check('generic-only name match is demoted', s.reasons.includes('weak_generic_name_match') || !s.reasons.includes('distinctive_token_match'));
}
{
  const s = scoreMentionCandidate(cand('Parlor Woodfire', { formattedAddress: '9 5th Ave, New York, NY, USA' }), mention('Parlor Woodfire', { region: 'California' }), {
    expectedState: 'CA',
    bias: null,
    platform: 'instagram',
  });
  check('wrong state => rejected', s.rejected === true && s.rejectionReason === 'wrong_location');
}
{
  const s = scoreMentionCandidate(cand('Parlor Woodfire', { businessStatus: 'CLOSED_PERMANENTLY' }), mention('Parlor Woodfire'), {
    expectedState: null,
    bias: null,
    platform: 'instagram',
  });
  check('permanently closed penalized', s.reasons.includes('permanently_closed'));
}
{
  const s = scoreMentionCandidate(cand('TikTok Inc.', { types: ['point_of_interest'] }), mention('Parlor Woodfire'), {
    expectedState: null,
    bias: null,
    platform: 'tiktok',
  });
  check('platform noise rejected', s.rejected === true && s.rejectionReason === 'platform_noise');
}

// ---- classifyMention ------------------------------------------------------
function scored(name: string, raw: number, reasons: string[]): ScoredMentionCandidate {
  return { candidate: cand(name), rawScore: raw, reasons, rejected: false, rejectionReason: null };
}
check('classify verified_single (clear winner)', classifyMention([scored('A', 57, ['business_type', 'strong_name_match', 'distinctive_token_match']), scored('B', 10, ['business_type'])]).outcome === 'verified_single');
check('classify ambiguous (two close)', classifyMention([scored('A', 55, ['strong_name_match', 'distinctive_token_match']), scored('B', 54, ['strong_name_match', 'distinctive_token_match'])]).outcome === 'ambiguous_candidates');
check('classify no_match (business only, no name evidence)', classifyMention([scored('A', 25, ['business_type'])]).outcome === 'no_match');
check('classify no_match (empty)', classifyMention([]).outcome === 'no_match');

// ---------------------------------------------------------------------------
// Orchestration (mocked Places)
// ---------------------------------------------------------------------------
function fixedSearch(map: Record<string, PlacesCandidate[]>, counter?: { n: number }): any {
  return async (query: string): Promise<SearchPlacesResult> => {
    if (counter) counter.n += 1;
    const key = Object.keys(map).find((k) => query.toLowerCase().includes(k.toLowerCase()));
    return { ok: true, results: key ? map[key]! : [] };
  };
}
const noGeocode = async () => null;

function mentions(...names: string[]): VenueMention[] {
  return names.map((n, i) => ({ ...mention(n), id: `m${i + 1}` }));
}
const geo: MediaGeoContext = { city: null, region: 'California', country: 'United States' };

(async () => {
  // clear single candidate => verified_single
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Parlor Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: fixedSearch({ 'Parlor Woodfire': [cand('Parlor Woodfire')] }), geocode: noGeocode },
    });
    check('single clear candidate => verified_single', r.mentionResults[0]!.outcome === 'verified_single');
    check('verified aggregate has 1', r.aggregateCandidates.length === 1);
  }

  // two ambiguous candidates
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Joe Pizza'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: {
        search: fixedSearch({
          'Joe Pizza': [
            cand('Joe Pizza', { googlePlaceId: 'a', formattedAddress: '1 A St, Los Angeles, CA' }),
            cand('Joe Pizza', { googlePlaceId: 'b', formattedAddress: '2 B St, San Diego, CA' }),
          ],
        }),
        geocode: noGeocode,
      },
    });
    check('two same-name candidates => ambiguous', r.mentionResults[0]!.outcome === 'ambiguous_candidates', r.mentionResults[0]!.outcome);
    check('ambiguous preserves both', r.mentionResults[0]!.candidates.length === 2);
  }

  // no candidate => no_match
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Nonexistent Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: fixedSearch({}), geocode: noGeocode },
    });
    check('no results => no_match', r.mentionResults[0]!.outcome === 'no_match');
    check('no_match aggregate empty', r.aggregateCandidates.length === 0);
  }

  // provider error (one mention) does NOT discard the other verified mention
  {
    const search = async (query: string): Promise<SearchPlacesResult> => {
      if (query.toLowerCase().includes('boom')) return { ok: false, reason: 'api_error', status: 'OVER_QUERY_LIMIT' };
      return { ok: true, results: [cand('Parlor Woodfire')] };
    };
    const r = await resolveVenueMentions({
      mentions: mentions('Parlor Woodfire', 'Boom Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: search as any, geocode: noGeocode },
    });
    check('one provider_error preserved', r.mentionResults.find((m) => m.displayName === 'Boom Woodfire')!.outcome === 'provider_error');
    check('other mention still verified', r.mentionResults.find((m) => m.displayName === 'Parlor Woodfire')!.outcome === 'verified_single');
    check('failed mention does NOT discard verified', r.verifiedCount === 1);
  }

  // provider timeout (throw) => provider_error
  {
    const search = async () => {
      throw new Error('timeout');
    };
    const r = await resolveVenueMentions({
      mentions: mentions('Parlor Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: search as any, geocode: noGeocode },
    });
    check('search throw => provider_error', r.mentionResults[0]!.outcome === 'provider_error');
  }

  // Place-ID dedup across mentions (same place id twice => aggregate 1)
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Parlor Woodfire', 'Parlor Woodfire Grill'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: {
        search: async (): Promise<SearchPlacesResult> => ({ ok: true, results: [cand('Parlor Woodfire', { googlePlaceId: 'SAME' })] }),
        geocode: noGeocode,
      },
    });
    check('dedup by Place ID => aggregate 1', r.aggregateCandidates.length === 1, `got ${r.aggregateCandidates.length}`);
  }

  // Distinct chain locations remain distinct (different place ids kept)
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Alpha Woodfire', 'Beta Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: {
        search: fixedSearch({
          'Alpha Woodfire': [cand('Alpha Woodfire', { googlePlaceId: 'alpha' })],
          'Beta Woodfire': [cand('Beta Woodfire', { googlePlaceId: 'beta' })],
        }),
        geocode: noGeocode,
      },
    });
    check('distinct places stay distinct => aggregate 2', r.aggregateCandidates.length === 2);
  }

  // Request limit
  {
    const counter = { n: 0 };
    const r = await resolveVenueMentions({
      mentions: mentions('One Woodfire', 'Two Woodfire', 'Three Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: fixedSearch({ Woodfire: [cand('X Woodfire')] }, counter), geocode: noGeocode, globalRequestLimit: 1 },
    });
    // Note: identical geo makes queries differ by name, so cache doesn't collapse them.
    check('request limit caps searches', counter.n <= 1, `searched ${counter.n}`);
    check('over-limit mentions => provider_error', r.mentionResults.filter((m) => m.outcome === 'provider_error').length >= 1);
  }

  // Per-task cache / replay idempotency (identical query searched once)
  {
    const counter = { n: 0 };
    // Two mentions with the SAME display name AND same geo => identical query.
    const dup = mentions('Parlor Woodfire', 'Parlor Woodfire');
    dup[1]!.id = 'm2';
    await resolveVenueMentions({
      mentions: dup,
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: fixedSearch({ 'Parlor Woodfire': [cand('Parlor Woodfire')] }, counter), geocode: noGeocode },
    });
    check('identical query searched once (cache)', counter.n === 1, `searched ${counter.n}`);
  }

  // Never auto-saves: the resolver produces candidates but the module itself
  // never sets safeToAutoSave (that lives in the caller); assert outcome types
  // only carry verified/ambiguous, never an auto-save flag.
  {
    const r = await resolveVenueMentions({
      mentions: mentions('Parlor Woodfire'),
      geoContext: geo,
      env,
      platform: 'instagram',
      deps: { search: fixedSearch({ 'Parlor Woodfire': [cand('Parlor Woodfire')] }), geocode: noGeocode },
    });
    check('no safeToAutoSave leaks from resolver', !('safeToAutoSave' in (r as any)));
  }

  if (failures > 0) {
    console.error(`\n${failures} name-driven resolver assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nALL NAME-DRIVEN RESOLVER TESTS PASSED');
})();
