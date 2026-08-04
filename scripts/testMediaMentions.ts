/**
 * scripts/testMediaMentions.ts
 *
 * Unit tests for the Phase 2 explicit-venue-mention builder
 * (supabase/functions/process-share-jobs/mediaMentions.ts). Pure module.
 *
 * Covers: explicit-only eligibility; generic-cuisine / vague / CTA rejection;
 * malformed inferred evidence never becomes a mention; non-destructive
 * normalization (apostrophes, ampersands); grouping of repeated spoken+visual
 * mentions; distinct chain locations staying separate; geo context built ONLY
 * from explicit fields (never inferred); stable mention ids.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMediaMentions.ts
 */

import {
  buildVenueMentions,
  isEligibleVenueName,
  normalizeVenueName,
  distinctiveTokensOf,
  normalizePhrase,
  detectRelationshipPhrase,
} from '../supabase/functions/process-share-jobs/mediaMentions';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceItem,
  PlaceEvidenceSource,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function ev(source: PlaceEvidenceSource, value: string, ts: number | null = null): PlaceEvidenceItem {
  return { source, value, timestampSeconds: ts };
}

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Test Venue',
    category: null,
    address: null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: 0.8,
    explicitEvidence: [ev('visible_text', 'Test Venue')],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return {
    places,
    multipleIntentionalPlaces: places.length > 1,
    insufficientEvidence: false,
    warnings: [],
    ...over,
  };
}

// ---- normalization (non-destructive) --------------------------------------
check("normalizeVenueName preserves ampersand", normalizeVenueName('B&C Pizzas') === 'b&c pizzas');
check("normalizeVenueName preserves apostrophe", normalizeVenueName("Lunita's Pizza") === "lunita's pizza");
check('normalizeVenueName collapses whitespace', normalizeVenueName('  Parlor   Woodfire ') === 'parlor woodfire');

// ---- eligibility ----------------------------------------------------------
check('eligible: proper venue name', isEligibleVenueName('Parlor Woodfire') === true);
check('eligible: ampersand brand', isEligibleVenueName('B&C Pizzas') === true);
check('eligible: apostrophe brand', isEligibleVenueName("Lunita's Pizza") === true);
check('eligible: single-letter brand (X Eats)', isEligibleVenueName('X Eats') === true);
check('eligible: region-tagged name', isEligibleVenueName('Orange Co NY Pizzeria') === true);
check('NOT eligible: bare cuisine "Pizza"', isEligibleVenueName('Pizza') === false);
check('NOT eligible: "best pizza"', isEligibleVenueName('best pizza') === false);
check('NOT eligible: vague "this pizza place"', isEligibleVenueName('this pizza place') === false);
check('NOT eligible: "the spot"', isEligibleVenueName('the spot') === false);
check('NOT eligible: CTA "Subscribe now"', isEligibleVenueName('Subscribe now') === false);
check('NOT eligible: platform noise', isEligibleVenueName('TikTok') === false);
check('distinctiveTokensOf drops generic', distinctiveTokensOf('Pizza Restaurant').length === 0);
check('distinctiveTokensOf keeps brand', distinctiveTokensOf('Parlor Woodfire').length === 2);

// ---- five explicit mentions -----------------------------------------------
{
  const names = ['Parlor Woodfire', 'B&C Pizzas', "Lunita's Pizza", 'X Eats', 'Orange Co NY Pizzeria'];
  const r = buildVenueMentions(
    evidence(
      names.map((n) =>
        place({ name: n, category: 'restaurant', region: 'California', explicitEvidence: [ev('visible_text', n, 3)] }),
      ),
      { multipleIntentionalPlaces: true },
    ),
  );
  check('five explicit names => five mentions', r.mentions.length === 5, `got ${r.mentions.length}`);
  check('mention ids are stable m1..m5', r.mentions.map((m) => m.id).join(',') === 'm1,m2,m3,m4,m5');
  check('geoContext region from explicit field', r.geoContext.region === 'California');
  check('geoContext city null (not inferred)', r.geoContext.city === null);
}

// ---- grouping repeated spoken + visual ------------------------------------
{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'Parlor Woodfire', explicitEvidence: [ev('visible_text', 'PARLOR WOODFIRE', 2)] }),
      place({ name: 'parlor woodfire', explicitEvidence: [ev('speech', 'we love parlor woodfire', 10)] }),
    ]),
  );
  check('repeated visual+audio => one grouped mention', r.mentions.length === 1, `got ${r.mentions.length}`);
  const m = r.mentions[0]!;
  check('grouped mention combines sources', m.sources.includes('visible_text') && m.sources.includes('speech'));
  check('grouped mention records both name evidence sources', m.nameEvidenceSources.includes('visible_text') && m.nameEvidenceSources.includes('speech'));
  check('grouped mention marked repeated', m.repeated === true);
  check('grouped mention keeps both timestamps', m.timestamps.length === 2 && m.timestamps[0] === 2 && m.timestamps[1] === 10);
}

// ---- punctuation-bearing brand names retain channel evidence -------------
{
  const r = buildVenueMentions(
    evidence([
      place({ name: "Capone's Italian Cucina", explicitEvidence: [ev('speech', "Capone's has been a staple", 1), ev('frame', 'CAPONES ITALIAN CUCINA', 2)] }),
      place({ name: 'B&C Pizzas', explicitEvidence: [ev('speech', 'B&C Pizzas is a favorite', 3), ev('frame', 'B+C PIZZAS', 4)] }),
    ]),
  );
  check('apostrophe brand keeps speech name evidence', r.mentions[0]!.nameEvidenceSources.includes('speech'));
  check('apostrophe variant keeps frame name evidence', r.mentions[0]!.nameEvidenceSources.includes('frame'));
  check('ampersand brand keeps speech name evidence', r.mentions[1]!.nameEvidenceSources.includes('speech'));
  check('ampersand variant keeps frame name evidence', r.mentions[1]!.nameEvidenceSources.includes('frame'));
}

// ---- distinct chain locations stay separate -------------------------------
{
  const r = buildVenueMentions(
    evidence([
      place({ name: "Joe's Pizza", region: 'New York', explicitEvidence: [ev('visible_text', "Joe's Pizza")] }),
      place({ name: "Joe's Pizza", region: 'California', explicitEvidence: [ev('visible_text', "Joe's Pizza")] }),
    ]),
  );
  check('same name different region => two mentions', r.mentions.length === 2, `got ${r.mentions.length}`);
}

// ---- inferred-only + malformed never becomes a mention --------------------
{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'Guessed Spot', explicitEvidence: [], inferredEvidence: [ev('frame', 'maybe a cafe')] }),
      place({ name: 'Real Venue Woodfire', explicitEvidence: [ev('visible_text', 'REAL VENUE WOODFIRE')] }),
    ]),
  );
  check('inferred-only place dropped', r.mentions.length === 1 && r.mentions[0]!.displayName === 'Real Venue Woodfire');
  check('droppedInferredOnly counted', r.droppedInferredOnly === 1);
}

// ---- generic cuisine + passing mention never searched ---------------------
{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'Pizza', explicitEvidence: [ev('visible_text', 'Pizza')] }),
      place({ name: 'Best Tacos', explicitEvidence: [ev('speech', 'best tacos ever')] }),
      place({ name: 'Featured Grille', role: 'passing_mention', explicitEvidence: [ev('visible_text', 'Featured Grille')] }),
      place({ name: 'Distinct Diner Woodfire', explicitEvidence: [ev('visible_text', 'DISTINCT DINER WOODFIRE')] }),
    ]),
  );
  check('generic-only names + passing dropped, real kept', r.mentions.length === 1 && r.mentions[0]!.displayName === 'Distinct Diner Woodfire', `got ${r.mentions.map((m) => m.displayName).join('|')}`);
  check('droppedIneligibleName counted', r.droppedIneligibleName === 2);
  check('droppedPassingMention counted', r.droppedPassingMention === 1);
}

// ---- insufficient evidence => no mentions ---------------------------------
check('insufficientEvidence => no mentions', buildVenueMentions(evidence([place()], { insufficientEvidence: true })).mentions.length === 0);

// ---- venue↔host relationship grouping (§2-6) ------------------------------
check('normalizePhrase converts @ to at', normalizePhrase('X Eats @ Brewery X') === 'x eats at brewery x');
check('detectRelationshipPhrase finds "at"', detectRelationshipPhrase('x eats', 'brewery x', ['x eats located at brewery x'])?.type === 'located_at');
check('detectRelationshipPhrase finds @ (normalized)', detectRelationshipPhrase('x eats', 'brewery x', [normalizePhrase('X Eats @ Brewery X')])?.type === 'located_at');
check('detectRelationshipPhrase: no connector => null', detectRelationshipPhrase('x eats', 'brewery x', ['x eats and brewery x are both good']) === null);

function xEatsBreweryX(hostEvidenceValue: string, phrase: string) {
  return evidence([
    place({ name: 'X Eats', city: 'Anaheim', explicitEvidence: [ev('speech', phrase, 32)] }),
    place({ name: 'Brewery X', city: 'Anaheim', role: 'secondary', confidence: 0.9, explicitEvidence: [ev('visible_text', hostEvidenceValue, 32)] }),
  ]);
}

{
  const r = buildVenueMentions(xEatsBreweryX('Brewery X', 'Out in Anaheim are the pizzas from X Eats located at Brewery X.'));
  check('"X Eats located at Brewery X" => one mention', r.mentions.length === 1, `got ${r.mentions.length}`);
  const m = r.mentions[0]!;
  check('merged displayName is "X Eats at Brewery X"', m.displayName === 'X Eats at Brewery X');
  check('merged primaryVenueName', m.primaryVenueName === 'X Eats');
  check('merged hostVenueName', m.hostVenueName === 'Brewery X');
  check('merged relationshipType located_at', m.relationshipType === 'located_at');
  check('host retained as supportingEvidence', (m.supportingEvidence ?? []).some((e) => e.value === 'Brewery X'));
  check('merged distinctiveTokens include host+primary', m.distinctiveTokens.includes('brewery') && m.distinctiveTokens.includes('x'));
  check('relationship diagnostic recorded', r.relationships.length === 1 && r.relationships[0]!.hostIndependentlyFeatured === false);
}

{
  const r = buildVenueMentions(xEatsBreweryX('Brewery X', 'Out in Anaheim are the pizzas from X Eats @ Brewery X.'));
  check('"X Eats @ Brewery X" => one mention', r.mentions.length === 1, `got ${r.mentions.length}`);
}

{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'X Eats', city: 'Anaheim', explicitEvidence: [ev('speech', 'Out in Anaheim are the pizzas from X Eats', 34)] }),
      place({ name: 'Brewery X', city: 'Anaheim', role: 'secondary', confidence: 0.9, explicitEvidence: [ev('speech', 'located at Brewery X.', 35)] }),
    ]),
  );
  check('adjacent split relationship => one mention', r.mentions.length === 1, `got ${r.mentions.length}`);
  check('adjacent split relationship groups host', r.mentions[0]!.displayName === 'X Eats at Brewery X');
}

{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'X Eats', city: 'Anaheim', explicitEvidence: [ev('speech', 'The pizzas from X Eats', 34)] }),
      place({ name: 'Brewery X', city: 'Anaheim', role: 'secondary', confidence: 0.9, explicitEvidence: [ev('speech', 'located at Brewery X.', 36)] }),
    ]),
  );
  check('split relationship outside one-second window stays separate', r.mentions.length === 2);
}

// host independently featured elsewhere => stays a separate mention
{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'X Eats', city: 'Anaheim', explicitEvidence: [ev('speech', 'the pizzas from X Eats located at Brewery X', 32)] }),
      place({ name: 'Brewery X', city: 'Anaheim', explicitEvidence: [ev('speech', 'located at Brewery X', 32), ev('speech', 'Brewery X is also a must-visit brewery on its own', 50)] }),
    ]),
  );
  check('independently-featured host stays separate', r.mentions.length === 2, `got ${r.mentions.length}`);
  check('relationship marked hostIndependentlyFeatured', r.relationships.some((x) => x.hostIndependentlyFeatured === true));
}

// two unrelated consecutive / same-city venues do NOT merge
{
  const r = buildVenueMentions(
    evidence([
      place({ name: "Joe's Woodfire", city: 'Los Angeles', explicitEvidence: [ev('speech', "First up is Joe's Woodfire in Los Angeles", 5)] }),
      place({ name: "Mary's Bistro", city: 'Los Angeles', explicitEvidence: [ev('speech', "Next is Mary's Bistro in Los Angeles", 12)] }),
    ]),
  );
  check('two unrelated same-city venues stay separate', r.mentions.length === 2);
  check('no relationship recorded for unrelated venues', r.relationships.length === 0);
}

// five-pizza fixture => exactly five mention slots (X Eats@Brewery X merged)
{
  const r = buildVenueMentions(
    evidence([
      place({ name: 'Parlor Woodfire Kitchen', city: 'San Clemente', explicitEvidence: [ev('speech', 'First in San Clemente is Parlor Woodfire Kitchen', 6)] }),
      place({ name: 'B&C Pizzas', city: 'Laguna Niguel', explicitEvidence: [ev('speech', 'in Laguna Niguel is one of my favorites B&C Pizzas', 11)] }),
      place({ name: "Lunita's Pizza", city: 'San Juan Capistrano', explicitEvidence: [ev('speech', "in San Juan Capistrano is Lunita's Pizza", 21)] }),
      place({ name: 'X Eats', city: 'Anaheim', explicitEvidence: [ev('speech', 'Out in Anaheim are the pizzas from X Eats located at Brewery X', 32)] }),
      place({ name: 'Brewery X', city: 'Anaheim', role: 'secondary', confidence: 0.9, explicitEvidence: [ev('speech', 'located at Brewery X', 32)] }),
      place({ name: 'Patrini Pizza', city: 'Los Alamitos', explicitEvidence: [ev('speech', 'in Los Alamitos is Patrini Pizza', 44)] }),
    ], { multipleIntentionalPlaces: true }),
  );
  check('five-pizza fixture => exactly 5 mention slots', r.mentions.length === 5, `got ${r.mentions.length}: ${r.mentions.map((m) => m.displayName).join(' | ')}`);
  check('one merged X Eats at Brewery X slot', r.mentions.some((m) => m.displayName === 'X Eats at Brewery X'));
  check('no standalone Brewery X slot', !r.mentions.some((m) => m.displayName === 'Brewery X'));
}

// single-place fixture unchanged (no relationship)
{
  const r = buildVenueMentions(evidence([place({ name: 'dPlace Steak', city: 'Fullerton', explicitEvidence: [ev('speech', 'dPlace in Fullerton', 3)] })]));
  check('single name => one mention, no relationship', r.mentions.length === 1 && r.relationships.length === 0 && !r.mentions[0]!.hostVenueName);
}

if (failures > 0) {
  console.error(`\n${failures} media-mentions assertion(s) failed`);
  process.exit(1);
}
console.log('\nALL MEDIA MENTIONS TESTS PASSED');
