import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyEntity,
  classifyHashtags,
} from '../lib/vayrin/entitySemantics';
import { ENTITY_FIXTURES } from './fixtures/vayrinEntitySemanticsNaturalFeatures';
import {
  buildVenueMentions,
  type MediaGeoContext,
  type VenueMention,
} from '../supabase/functions/process-share-jobs/mediaMentions';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVayrinPartialResult } from '../supabase/functions/process-share-jobs/mediaEvidence';
import {
  buildMentionQuery,
  buildCategoryBiasedMentionQuery,
  classifyMention,
  resolveVenueMentions,
  scoreMentionCandidate,
} from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import {
  geographicContextTypeOf,
  normalizeProviderEntityKind,
} from '../supabase/functions/process-share-link/places/placeNormalization';
import type {
  PlacesCandidate,
  SearchPlacesResult,
} from '../supabase/functions/process-share-link/places/googlePlaces';

function place(over: Partial<PlaceCandidateEvidence> & Pick<PlaceCandidateEvidence, 'name'>): PlaceCandidateEvidence {
  return {
    category: null,
    address: null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [{ source: 'caption', value: over.name, timestampSeconds: null }],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[]): MediaPlaceEvidence {
  return {
    places,
    partialPlaces: [],
    multipleIntentionalPlaces: places.length > 1,
    insufficientEvidence: false,
    warnings: [],
  };
}

function candidate(over: Partial<PlacesCandidate> & Pick<PlacesCandidate, 'name' | 'googlePlaceId'>): PlacesCandidate {
  return {
    formattedAddress: '',
    latitude: -38.15,
    longitude: 176.34,
    types: [],
    ...over,
  };
}

function oneMention(p: PlaceCandidateEvidence): VenueMention {
  const built = buildVenueMentions(evidence([p]));
  assert.equal(built.mentions.length, 1, `expected one mention for ${p.name}`);
  return built.mentions[0]!;
}

async function main(): Promise<void> {
  for (const fixture of ENTITY_FIXTURES) {
    const actual = classifyEntity(fixture).entityType;
    assert.equal(actual, fixture.expected, `${fixture.id}: ${fixture.text}`);
  }
  assert.ok(ENTITY_FIXTURES.length >= 25, 'benchmark corpus must retain at least 25 fixtures');

  const hashtags = classifyHashtags(
    '#okerefalls #mokeshawaii #kailua #dods #newzealand',
    { city: 'Kailua', country: 'Hawaii', contextText: 'volcanic ocean cliffs Rotorua' },
  );
  assert.deepEqual(
    hashtags.map((item) => item.classification.entityType),
    ['NAMED_NATURAL_FEATURE', 'GEOGRAPHIC_ALIAS', 'CITY', 'ACTIVITY', 'COUNTRY'],
    'hashtags are typed independently',
  );

  // R07: person and activity strings form no logical Places mentions and cause
  // zero provider calls. Geography remains usable context in the evidence.
  const r07 = buildVenueMentions(evidence([
    place({
      name: 'Ken Stornes',
      country: 'Norway',
      explicitEvidence: [{ source: 'caption', value: 'Ken Stornes 40.5m Døds world record Norway', timestampSeconds: null }],
    }),
    place({
      name: 'Døds',
      country: 'Norway',
      explicitEvidence: [{ source: 'caption', value: '40.5m Døds world record', timestampSeconds: null }],
    }),
  ]));
  assert.equal(r07.mentions.length, 0);
  assert.equal(r07.droppedEntityTypeCounts.PERSON, 1);
  assert.equal(r07.droppedEntityTypeCounts.ACTIVITY, 1);
  let blockedSearchCalls = 0;
  await resolveVenueMentions({
    mentions: r07.mentions,
    geoContext: r07.geoContext,
    env: { googlePlacesKey: 'test' } as never,
    platform: 'instagram',
    deps: {
      search: async () => {
        blockedSearchCalls += 1;
        return { ok: true, results: [] };
      },
    },
  });
  assert.equal(blockedSearchCalls, 0, 'person/activity must never query Places');
  const personPartial = buildVayrinPartialResult({
    places: [],
    partialPlaces: [{
      nameHint: 'Ken Stornes', entityType: 'PERSON', category: 'sports',
      categoryConfidence: 0.9, categoryEvidenceTags: [], addressHint: null,
      city: null, region: null, country: 'Norway', role: 'primary', confidence: 0.8,
      explicitEvidence: [{ source: 'caption', value: 'Ken Stornes Døds world record Norway', timestampSeconds: null }],
      validationErrors: [],
    }],
    multipleIntentionalPlaces: false, insufficientEvidence: false, warnings: [],
  });
  assert.ok(personPartial?.searchQuery?.includes('Norway'));
  assert.doesNotMatch(personPartial?.searchQuery ?? '', /Ken\s+Stornes/i, 'Never-Dead-End keeps geo/activity context, not person identity');

  // R08: contextual alias becomes one natural-feature mention. The provider
  // query uses a canonical feature identity and a breakfast business is a hard
  // semantic mismatch even if lexical matching is tempting.
  const mokesMention = oneMention(place({
    name: 'Mokes',
    category: 'island',
    city: 'Kailua',
    region: 'Hawaii',
    country: 'United States',
    sceneSignature: {
      environmentType: 'natural_water',
      setting: 'outdoor',
      visualAnchors: ['volcanic ocean cliffs', 'offshore islands'],
      activity: 'cliff jumping',
    },
    explicitEvidence: [
      { source: 'caption', value: 'Kailua Hawaii #mokeshawaii #dods', timestampSeconds: null },
      { source: 'frame', value: 'volcanic ocean cliff-jumping inlet', timestampSeconds: 2 },
    ],
  }));
  assert.equal(mokesMention.entityType, 'GEOGRAPHIC_ALIAS');
  assert.equal(mokesMention.resolutionMode, 'natural_feature');
  assert.match(buildMentionQuery(mokesMention, { city: null, region: null, country: null }), /^Mokulua Islands\b/);

  const breakfast = scoreMentionCandidate(
    candidate({
      googlePlaceId: 'breakfast',
      name: "Moke's Bread & Breakfast",
      formattedAddress: 'Kailua, HI, USA',
      primaryType: 'restaurant',
      types: ['restaurant', 'establishment', 'point_of_interest'],
    }),
    mokesMention,
    { expectedState: 'HI', bias: null, platform: 'instagram' },
  );
  assert.equal(breakfast.rejected, true);
  assert.equal(breakfast.rejectionReason, 'entity_semantic_type_mismatch');

  const mokuNui = scoreMentionCandidate(
    candidate({
      googlePlaceId: 'moku-nui',
      name: 'Moku Nui',
      formattedAddress: 'Kailua, HI, USA',
      primaryType: 'island',
      types: ['island', 'natural_feature', 'point_of_interest'],
    }),
    mokesMention,
    { expectedState: 'HI', bias: null, platform: 'instagram' },
  );
  assert.equal(mokuNui.rejected, false);
  assert.notEqual(classifyMention([mokuNui]).outcome, 'no_match');

  // R05: a correctly named physical destination can canonicalize to a reserve
  // even though Google also supplies generic establishment/POI markers.
  const okereMention = oneMention(place({
    name: 'Okere Falls',
    entityType: 'NAMED_NATURAL_FEATURE',
    category: 'waterfall',
    city: 'Rotorua',
    country: 'New Zealand',
    explicitEvidence: [
      { source: 'visible_text', value: 'Okere Falls', timestampSeconds: 1 },
      { source: 'caption', value: 'Rotorua New Zealand', timestampSeconds: null },
    ],
  }));
  const okereCandidate = scoreMentionCandidate(
    candidate({
      googlePlaceId: 'okere-reserve',
      name: 'Okere Falls Scenic Reserve',
      formattedAddress: '103 Trout Pool Road, Okere Falls 3074, New Zealand',
      primaryType: 'park',
      types: ['park', 'tourist_attraction', 'establishment', 'point_of_interest'],
    }),
    okereMention,
    { expectedState: null, bias: null, platform: 'instagram', expectedCountry: 'New Zealand' },
  );
  assert.equal(okereCandidate.rejected, false);
  assert.equal(classifyMention([okereCandidate]).outcome, 'verified_single');
  assert.equal(
    buildCategoryBiasedMentionQuery(
      okereMention,
      buildMentionQuery(okereMention, { city: null, region: null, country: null }),
      'waterfall',
    ),
    'Okere Falls waterfall Rotorua New Zealand',
    'natural-feature category stays adjacent to the identity before geography',
  );

  const providerNatural = candidate({
    googlePlaceId: 'natural',
    name: 'Example Falls',
    primaryType: 'natural_feature',
    types: ['natural_feature', 'political', 'establishment'],
  });
  assert.equal(normalizeProviderEntityKind(providerNatural), 'named_natural_feature');
  assert.equal(geographicContextTypeOf(providerNatural), null, 'natural result is not admin context');
  assert.equal(
    normalizeProviderEntityKind(candidate({
      googlePlaceId: 'generic-establishment',
      name: 'Unknown typed place',
      primaryType: 'establishment',
      types: ['establishment', 'point_of_interest'],
    })),
    'unknown',
    'establishment alone is not business semantics',
  );

  const lakeMention = oneMention(place({ name: 'Lake Havasu', category: 'lake' }));
  const lakeCity = scoreMentionCandidate(
    candidate({
      googlePlaceId: 'lake-havasu-city',
      name: 'Lake Havasu City',
      types: ['locality', 'political'],
      primaryType: 'locality',
    }),
    lakeMention,
    { expectedState: null, bias: null, platform: 'instagram' },
  );
  assert.equal(lakeCity.rejected, true, 'admin locality cannot replace physical lake');

  // Multi-place and same-place grouping behavior remains owned by the existing
  // grouper; semantic typing only removes non-place inputs upstream.
  const multi = buildVenueMentions(evidence([
    place({ name: 'In-N-Out', category: 'restaurant' }),
    place({ name: 'Waterfall Cafe', category: 'cafe' }),
  ]));
  assert.equal(multi.mentions.length, 2, 'two genuine businesses remain two places');
  const same = buildVenueMentions(evidence([
    place({ name: 'Moku Nui', logicalPlaceId: 'scene-1', category: 'island', region: 'Hawaii', explicitEvidence: [{ source: 'frame', value: 'natural offshore island', timestampSeconds: 1 }] }),
    place({ name: 'Mokulua Islands', logicalPlaceId: 'scene-1', category: 'island', region: 'Hawaii', explicitEvidence: [{ source: 'frame', value: 'same natural offshore islands', timestampSeconds: 2 }] }),
  ]));
  assert.equal(same.mentions.length, 1, 'same-place alternatives still reconverge');

  // Manual search is intentionally outside the machine-to-Places semantic
  // boundary. Keep the user-entered hook on its existing direct Places path.
  const manualHook = readFileSync('hooks/usePlacesSearch.ts', 'utf8');
  assert.doesNotMatch(manualHook, /entitySemantics|classifyEntity/);
  assert.match(manualHook, /search/i);

  let placesCallCount = 0;
  const search = async (query: string): Promise<SearchPlacesResult> => {
    placesCallCount += 1;
    const results = query.startsWith('Mokulua Islands')
      ? [candidate({
          googlePlaceId: 'moku-nui', name: 'Moku Nui', formattedAddress: 'Kailua, HI, USA',
          primaryType: 'island', types: ['island', 'natural_feature'], latitude: 21.39, longitude: -157.69,
        })]
      : [candidate({
          googlePlaceId: 'okere-reserve', name: 'Okere Falls Scenic Reserve',
          formattedAddress: 'Okere Falls, New Zealand', primaryType: 'park',
          types: ['park', 'establishment'], latitude: -38.15, longitude: 176.34,
        })];
    return { ok: true, results, apiPath: 'places_new' };
  };
  const noGeo: MediaGeoContext = { city: null, region: null, country: null };
  await resolveVenueMentions({
    mentions: [mokesMention], geoContext: noGeo, env: { googlePlacesKey: 'test' } as never,
    platform: 'instagram', deps: { search, geocode: async () => null },
  });
  await resolveVenueMentions({
    mentions: [okereMention], geoContext: noGeo, env: { googlePlacesKey: 'test' } as never,
    platform: 'instagram', deps: { search, geocode: async () => null },
  });
  assert.equal(placesCallCount, 2, 'one neutral Places call per eligible frozen case');

  const metrics = {
    fixtureCount: ENTITY_FIXTURES.length,
    personToVenueFalseQueries: blockedSearchCalls,
    activityToVenueFalseQueries: blockedSearchCalls,
    aliasWrongBusinessVisible: breakfast.rejected ? 0 : 1,
    namedNaturalFeatureCanonicalizationSuccess: 1,
    businessNameRecall: ENTITY_FIXTURES.filter((f) => f.expected === 'BUSINESS_OR_VENUE')
      .filter((f) => classifyEntity(f).entityType === f.expected).length,
    naturalFeatureRecall: ENTITY_FIXTURES.filter((f) => f.expected === 'NAMED_NATURAL_FEATURE')
      .filter((f) => classifyEntity(f).entityType === f.expected).length,
    wrongCandidateCount: breakfast.rejected ? 0 : 1,
    placesCallCount,
    manualSearchRegression: 0,
  };
  console.log(`PASS Vayrin entity semantics + natural features ${JSON.stringify(metrics)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
