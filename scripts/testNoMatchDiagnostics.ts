/**
 * scripts/testNoMatchDiagnostics.ts
 *
 * PINNED contract for NO-MATCH OBSERVABILITY.
 *
 * A zero-suggestion share used to end with nothing but the word `no_match`.
 * The per-candidate scoring existed in memory and was thrown away at
 * persistence, so nobody could tell these apart afterwards:
 *
 *   Google returned nothing
 *   Google returned results and every one was a city
 *   Google returned results and every one was in the wrong country
 *   results survived every guard and none carried name evidence
 *   the best candidate matched by name and still fell under the floor
 *
 * Those call for five different fixes. This file pins that each is now a
 * distinct, queryable reason code, and that the counts behind the code survive.
 *
 * The anchor is the Nicaragua reel (Ometepe / Granada / San Juan del Sur /
 * León), where Ometepe ends in no_match. Nothing here tries to make Ometepe
 * resolve — the point is that it now explains itself.
 *
 * OBSERVABILITY ONLY. Every assertion about behavior (which outcome a set of
 * candidates produces) must match what the resolver did before this change.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testNoMatchDiagnostics.ts
 */

import {
  classifyMention,
  scoreMentionCandidate,
  buildMentionFailureTrace,
  resolveVenueMentions,
  MAX_FAILURE_TRACES,
  MAX_PERSISTED_PROVIDER_RESULTS,
  type ScoredMentionCandidate,
  type MentionFailureTrace,
} from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type { PlacesCandidate } from '../supabase/functions/process-share-link/places/googlePlaces';
import type { VenueMention, MediaGeoContext } from '../supabase/functions/process-share-jobs/mediaMentions';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cand(name: string, over: Partial<PlacesCandidate> = {}): PlacesCandidate {
  return {
    googlePlaceId: `p_${name.replace(/\W+/g, '_').toLowerCase()}`,
    name,
    formattedAddress: `${name}, Somewhere`,
    types: ['restaurant'],
    primaryType: 'restaurant',
    ...over,
  } as PlacesCandidate;
}

function mention(over: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: 'Ometepe Island',
    normalizedName: 'ometepe island',
    distinctiveTokens: ['ometepe'],
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

const GEO_NICARAGUA: MediaGeoContext = {
  city: null,
  region: null,
  country: 'Nicaragua',
  countryStrength: 'strong',
  countrySource: 'context_only_place',
};

/** Drive the real orchestrator with an injected provider — no network. */
async function run(args: {
  mentions: VenueMention[];
  geoContext?: MediaGeoContext;
  results?: PlacesCandidate[];
  providerError?: { reason: 'http_error' | 'api_error'; status?: string };
}) {
  return resolveVenueMentions({
    mentions: args.mentions,
    geoContext: args.geoContext ?? GEO_NICARAGUA,
    env: { googlePlacesKey: 'test-key' } as never,
    platform: 'instagram',
    deps: {
      search: async () =>
        args.providerError
          ? { ok: false as const, ...args.providerError }
          : { ok: true as const, results: args.results ?? [] },
      geocode: async () => null,
    },
  });
}

const traceFor = (r: { resolutionDiagnostics: { failureTraces: MentionFailureTrace[] } }, id = 'm1') =>
  r.resolutionDiagnostics.failureTraces.find((t) => t.mentionId === id);

async function main(): Promise<void> {

// ---------------------------------------------------------------------------
// 1. Provider empty  vs  provider error  (must never be conflated)
// ---------------------------------------------------------------------------

{
  const r = await run({ mentions: [mention()], results: [] });
  const t = traceFor(r)!;
  check('provider empty: outcome is no_match', r.noMatchCount === 1);
  check('provider empty: reason is provider_empty', t.noMatchReason === 'provider_empty');
  check('provider empty: search status is empty', t.providerSearchStatus === 'empty');
  check('provider empty: zero results recorded', t.providerResultCount === 0);
  check('provider empty: no rejection counts fabricated', Object.keys(t.rejectionCounts).length === 0);
  check('provider empty: no best candidate invented', t.bestCandidateScore === undefined);
}

{
  const r = await run({ mentions: [mention()], providerError: { reason: 'http_error', status: '503' } });
  const t = traceFor(r)!;
  check('provider error: outcome is provider_error, not no_match', r.providerErrorCount === 1 && r.noMatchCount === 0);
  check('provider error: search status is error', t.providerSearchStatus === 'error');
  check('provider error: error kind preserved', t.providerErrorKind === 'http_error');
  check('provider error: status code preserved', t.providerStatusCode === '503');
  check('provider error: never labelled provider_empty', t.noMatchReason === undefined);
}

// ---------------------------------------------------------------------------
// 2. Name-match failure — results survived, none carried name evidence
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Ometepe Island', distinctiveTokens: ['ometepe'] })],
    results: [cand('Completely Unrelated Diner'), cand('Another Random Cafe')],
  });
  const t = traceFor(r)!;
  check('name mismatch: outcome is no_match', r.noMatchCount === 1);
  check('name mismatch: reason is name_match_failed', t.noMatchReason === 'name_match_failed');
  check('name mismatch: provider results counted', t.providerResultCount >= 2);
  check('name mismatch: candidates survived the guards', t.survivingCandidates >= 2);
  check('name mismatch: none carried name evidence', t.survivingWithNameEvidence === 0);
  check('name mismatch: best candidate recorded as failing name', t.bestCandidatePassedName === false);
  check('name mismatch: best score is a bounded number', typeof t.bestCandidateScore === 'number');
}

// ---------------------------------------------------------------------------
// 3. Venue mode — every result was a locality (the ordinary-mode guard)
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Granada', distinctiveTokens: ['granada'] })],
    results: [
      cand('Granada', { types: ['locality', 'political'], primaryType: 'locality' }),
      cand('Granada', { googlePlaceId: 'p_granada2', types: ['locality', 'political'], primaryType: 'locality' }),
    ],
  });
  const t = traceFor(r)!;
  check('venue mode: locality-only results produce no_match', r.noMatchCount === 1);
  check('venue mode: reason is geographic_context_rejected', t.noMatchReason === 'geographic_context_rejected');
  check('venue mode: mode recorded as venue', t.resolutionMode === 'venue');
  check('venue mode: rejection counted under the real guard name', t.rejectionCounts['geographic_context_only'] === 2);
  check('venue mode: nothing survived', t.survivingCandidates === 0);
}

// ---------------------------------------------------------------------------
// 4. Geographic mode — a business can never satisfy a city (Rio / 7 Mares)
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({
      displayName: 'Rio de Janeiro',
      distinctiveTokens: ['rio', 'janeiro'],
      resolutionMode: 'geographic',
    })],
    results: [
      cand('7 Mares - Passeio de Lancha Rio de Janeiro', { types: ['travel_agency'], primaryType: 'travel_agency' }),
    ],
  });
  const t = traceFor(r)!;
  check('geographic mode: a same-named business is rejected', r.noMatchCount === 1);
  check(
    'geographic mode: reason is geographic_destination_type_rejected',
    t.noMatchReason === 'geographic_destination_type_rejected',
  );
  check('geographic mode: mode recorded as geographic', t.resolutionMode === 'geographic');
  check('geographic mode: 7 Mares never survives', t.survivingCandidates === 0);
  check(
    'geographic mode: rejection attributed to the geographic-entity guard',
    t.rejectionCounts['not_a_geographic_entity'] === 1,
  );
}

// ---------------------------------------------------------------------------
// 5. Geographic mode — right name, wrong country (Granada, Spain)
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Granada', distinctiveTokens: ['granada'], resolutionMode: 'geographic' })],
    results: [
      cand('Granada', { types: ['locality', 'political'], primaryType: 'locality', formattedAddress: 'Granada, Spain' }),
    ],
  });
  const t = traceFor(r)!;
  check('wrong country: rejected', r.noMatchCount === 1);
  check('wrong country: reason is distance_or_geo_rejected', t.noMatchReason === 'distance_or_geo_rejected');
  check('wrong country: country guard named', t.rejectionCounts['geographic_country_mismatch'] === 1);
  check('wrong country: shared country was applied to the query', t.sharedCountryApplied === true);
  check('wrong country: query carried a country', t.queryHadCountry === true);
}

// ---------------------------------------------------------------------------
// 6. Mixed rejections keep their detail
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Granada', distinctiveTokens: ['granada'], resolutionMode: 'geographic' })],
    results: [
      cand('Granada Bar', { types: ['bar'], primaryType: 'bar' }),
      cand('Granada', { googlePlaceId: 'p_gr_es', types: ['locality', 'political'], formattedAddress: 'Granada, Spain' }),
    ],
  });
  const t = traceFor(r)!;
  check('mixed: falls back to all_candidates_rejected', t.noMatchReason === 'all_candidates_rejected');
  check('mixed: both distinct guards preserved in counts', Object.keys(t.rejectionCounts).length === 2);
  check(
    'mixed: counts sum to the candidates considered',
    Object.values(t.rejectionCounts).reduce((a, b) => a + b, 0) === t.candidatesConsidered,
  );
}

// ---------------------------------------------------------------------------
// 7. Provider TYPE completeness (primaryType was seen missing in the wild)
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Ometepe', distinctiveTokens: ['ometepe'] })],
    results: [
      cand('Nowhere One', { primaryType: undefined, types: ['restaurant'] }),
      cand('Nowhere Two', { googlePlaceId: 'p_n2', primaryType: undefined, types: [] }),
      cand('Nowhere Three', { googlePlaceId: 'p_n3', primaryType: 'cafe', types: ['cafe'] }),
    ],
  });
  const t = traceFor(r)!;
  check('types: primaryType presence counted', t.candidatesWithPrimaryType === 1);
  check('types: types-array presence counted', t.candidatesWithTypesArray === 2);
  check('types: fully untyped candidates counted', t.candidatesWithoutAnyType === 1);
  check(
    'types: counts never exceed candidates considered',
    t.candidatesWithPrimaryType <= t.candidatesConsidered && t.candidatesWithTypesArray <= t.candidatesConsidered,
  );
}

// ---------------------------------------------------------------------------
// 8. Insufficient evidence — never attributed to the provider
// ---------------------------------------------------------------------------

{
  const r = await run({ mentions: [mention({ distinctiveTokens: [] })], results: [cand('Anything')] });
  const t = traceFor(r)!;
  check('insufficient evidence: outcome preserved', r.rejectedCount === 1);
  check('insufficient evidence: provider never blamed', t.providerSearchStatus === 'not_attempted');
  check('insufficient evidence: no no-match reason', t.noMatchReason === undefined);
  check('insufficient evidence: no provider request made', r.requestCount === 0);
}

// ---------------------------------------------------------------------------
// 9. Query-scoping facts, without the query
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Ometepe', geo: { city: null, region: null, country: null } })],
    results: [],
  });
  const t = traceFor(r)!;
  check('scoping: shared Nicaragua context recorded as applied', t.sharedCountryApplied === true);
  check('scoping: country did not come from the mention', t.countryFromMention === false);
  check('scoping: no city context', t.queryHadCity === false);
  check('scoping: no location bias without a city', t.locationBiasApplied === false);

  const own = await run({
    mentions: [mention({ displayName: 'Granada', geo: { city: null, region: null, country: 'Spain' } })],
    results: [],
  });
  const ot = traceFor(own)!;
  check('scoping: a mention country is recorded as its own', ot.countryFromMention === true);
  check('scoping: mention country is not credited to shared context', ot.sharedCountryApplied === false);
}

// ---------------------------------------------------------------------------
// 10. Aggregate counters for the 100-failure audit
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [
      mention({ id: 'm1', displayName: 'Ometepe', distinctiveTokens: ['ometepe'] }),
      mention({ id: 'm2', displayName: 'Granada', distinctiveTokens: ['granada'] }),
    ],
    results: [],
  });
  const d = r.resolutionDiagnostics;
  check('aggregate: attempts counted', d.attempts === 2);
  check('aggregate: no-match counted', d.noMatch === 2);
  check('aggregate: reason counts grouped', d.noMatchReasonCounts['provider_empty'] === 2);
  check('aggregate: one trace per failed mention', d.failureTraces.length === 2);
  check('aggregate: traces are per-slot ids, not source text', d.failureTraces.every((t) => /^m\d+$/.test(t.mentionId)));
}

// ---------------------------------------------------------------------------
// 11. Successful mentions are NOT traced (payload stays small)
// ---------------------------------------------------------------------------

{
  const r = await run({
    mentions: [mention({ displayName: 'Pho Bamboo', distinctiveTokens: ['pho', 'bamboo'] })],
    results: [cand('Pho Bamboo')],
  });
  check('success: mention resolved', r.verifiedCount + r.ambiguousCount === 1);
  check('success: no failure trace emitted', r.resolutionDiagnostics.failureTraces.length === 0);
  check('success: no no-match reasons recorded', Object.keys(r.resolutionDiagnostics.noMatchReasonCounts).length === 0);
}

// ---------------------------------------------------------------------------
// 12. Bounds and privacy
// ---------------------------------------------------------------------------

{
  const many = Array.from({ length: 14 }, (_, i) =>
    mention({ id: `m${i + 1}`, displayName: `Place ${i}`, distinctiveTokens: [`place${i}`] }),
  );
  const r = await run({ mentions: many, results: [] });
  check(
    `bounds: traces capped at ${MAX_FAILURE_TRACES}`,
    r.resolutionDiagnostics.failureTraces.length <= MAX_FAILURE_TRACES,
  );

  const json = JSON.stringify(r.resolutionDiagnostics);
  check('privacy: no candidate names in persisted diagnostics', !json.includes('Place 0'));
  check('privacy: no query text in persisted diagnostics', !json.toLowerCase().includes('nicaragua'));
  check('privacy: no address text', !json.includes('Somewhere'));
  check('privacy: no googlePlaceId leakage', !json.includes('p_'));
}

// A provider that returned far more than we persist must not inflate counts.
{
  const t = buildMentionFailureTrace({
    mentionId: 'm1',
    resolutionMode: 'venue',
    outcome: 'no_match',
    noMatchReason: 'provider_empty',
    providerSearchStatus: 'ok',
    providerResultCount: 9_999,
    scored: [],
    ranked: [],
    categoryBiasedSearchUsed: false,
    queryHadCity: false,
    queryHadRegion: false,
    queryHadCountry: false,
    countryFromMention: false,
    sharedCountryApplied: false,
    locationBiasApplied: false,
  });
  check(
    `bounds: provider result count capped at ${MAX_PERSISTED_PROVIDER_RESULTS}`,
    t.providerResultCount === MAX_PERSISTED_PROVIDER_RESULTS,
  );
}

// ---------------------------------------------------------------------------
// 13. Fault isolation — malformed provider data costs a trace, not the share
// ---------------------------------------------------------------------------

// Shapes a real provider response can actually take: fields absent, or present
// with the wrong type. `searchPlaces` builds typed objects, so a literally null
// entity cannot occur here — and note that one WOULD throw inside the
// pre-existing `scoreMentionCandidate`, well before diagnostics run. That is a
// robustness gap in scoring, not in observability, and is deliberately left
// alone by this task.
// Absent fields are the shape actually seen in production (primaryType came
// back undefined during the live Instagram-tag validation), and they must flow
// through the whole path untouched.
{
  let threw = false;
  let r: Awaited<ReturnType<typeof run>> | null = null;
  try {
    r = await run({
      mentions: [mention()],
      results: [{ googlePlaceId: 'p_bare', name: 'Bare Entity' } as PlacesCandidate],
    });
  } catch {
    threw = true;
  }
  check('fault isolation: absent provider fields never throw', !threw);
  check('fault isolation: resolution still completed', r !== null);
  const t = r ? traceFor(r) : undefined;
  check('fault isolation: a trace was still produced', !!t);
  check('fault isolation: absent types counted as untyped', (t?.candidatesWithoutAnyType ?? -1) === 1);
}

// The trace builder itself must tolerate field shapes the scorers would choke
// on. It is the last thing to run and the least important, so it degrades to a
// count rather than propagating. (A candidate whose `types` is a string throws
// inside the pre-existing `scoreMentionCandidate` long before this — a scoring
// robustness gap this observability task deliberately does not touch.)
{
  const hostile: ScoredMentionCandidate[] = [
    { candidate: { googlePlaceId: 'a', name: 'A', types: 'restaurant', primaryType: 7 } as never, rawScore: 1, reasons: [], rejected: false, rejectionReason: null },
    { candidate: { googlePlaceId: 'b', name: 'B', types: null, primaryType: null } as never, rawScore: 1, reasons: [], rejected: true, rejectionReason: null },
  ];
  let threw = false;
  let t: MentionFailureTrace | null = null;
  try {
    t = buildMentionFailureTrace({
      mentionId: 'm1',
      resolutionMode: 'venue',
      outcome: 'no_match',
      noMatchReason: 'all_candidates_rejected',
      providerSearchStatus: 'ok',
      providerResultCount: 2,
      scored: hostile,
      ranked: [],
      categoryBiasedSearchUsed: false,
      queryHadCity: false,
      queryHadRegion: false,
      queryHadCountry: false,
      countryFromMention: false,
      sharedCountryApplied: false,
      locationBiasApplied: false,
    });
  } catch {
    threw = true;
  }
  check('fault isolation: trace builder tolerates wrong-typed provider fields', !threw);
  check('fault isolation: non-array types counted as untyped', t?.candidatesWithTypesArray === 0);
  check('fault isolation: non-string primaryType counted as untyped', t?.candidatesWithPrimaryType === 0);
  check('fault isolation: an unnamed rejection still tallies', t?.rejectionCounts['unknown'] === 1);
}

// ---------------------------------------------------------------------------
// 14. classifyMention behavior is UNCHANGED (observability only)
// ---------------------------------------------------------------------------

function s(name: string, raw: number, reasons: string[]): ScoredMentionCandidate {
  return { candidate: cand(name), rawScore: raw, reasons, rejected: false, rejectionReason: null };
}
check(
  'unchanged: verified_single still verified',
  classifyMention([s('A', 57, ['business_type', 'strong_name_match', 'distinctive_token_match']), s('B', 10, ['business_type'])])
    .outcome === 'verified_single',
);
check(
  'unchanged: two close candidates still ambiguous',
  classifyMention([s('A', 55, ['strong_name_match', 'distinctive_token_match']), s('B', 54, ['strong_name_match', 'distinctive_token_match'])])
    .outcome === 'ambiguous_candidates',
);
check(
  'unchanged: business-only still no_match',
  classifyMention([s('A', 25, ['business_type'])]).outcome === 'no_match',
);
check('unchanged: empty still no_match', classifyMention([]).outcome === 'no_match');
check('unchanged: a resolved mention carries no reason', classifyMention([s('A', 57, ['strong_name_match', 'distinctive_token_match'])]).noMatchReason === null);
// The split of the old combined condition must keep BOTH halves at no_match.
check(
  'unchanged: name-evidence failure and floor failure are both no_match',
  classifyMention([s('A', 25, ['business_type'])]).outcome === 'no_match' &&
    classifyMention([s('A', -5, ['strong_name_match', 'distinctive_token_match'])]).outcome === 'no_match',
);
check(
  'split: low-scoring name match is score_below_acceptance, not name_match_failed',
  classifyMention([s('A', -5, ['strong_name_match', 'distinctive_token_match'])]).noMatchReason ===
    'score_below_acceptance',
);

}

main().then(() => {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
