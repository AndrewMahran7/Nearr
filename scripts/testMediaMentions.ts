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
        place({ name: n, category: 'Pizza Restaurant', region: 'California', explicitEvidence: [ev('visible_text', n, 3)] }),
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
  check('grouped mention marked repeated', m.repeated === true);
  check('grouped mention keeps both timestamps', m.timestamps.length === 2 && m.timestamps[0] === 2 && m.timestamps[1] === 10);
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

if (failures > 0) {
  console.error(`\n${failures} media-mentions assertion(s) failed`);
  process.exit(1);
}
console.log('\nALL MEDIA MENTIONS TESTS PASSED');
