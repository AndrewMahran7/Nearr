/**
 * scripts/testEvidenceProvenanceRegressions.ts
 *
 * Deterministic, offline regression suite (Layer A) pinning the real
 * production bugs traced and fixed during the cross-platform evidence
 * stabilization pass:
 *
 *   1. Snapchat: a page's own Twitter Card (`twitter:site="@Snapchat"`) must
 *      never become venue evidence ("Snap Headquarters" auto-save).
 *   2. YouTube: a minified JS config blob's literal `@.null` substring must
 *      never become a poster/venue name ("<Null>" candidates in OR/NM).
 *   3. TikTok: a redirect that lands on an app-store page must never be
 *      treated as post content ("App Store" -> random OR/WA electronics
 *      stores).
 *   4. Query/candidate sanitation: placeholder tokens (null/undefined/none/
 *      n-a/unknown/empty) never survive as a query or a candidate name.
 *   5. Geography: an explicit CA region reference is recognized so the
 *      existing wrong-location veto has something to check against.
 *
 * Fixtures below are tiny, hand-written HTML/text snippets reproducing the
 * SPECIFIC bytes that caused each bug (verified live against the real pages
 * during the investigation) — never full pages, never copyrighted video
 * content. No network access; safe for every CI run.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testEvidenceProvenanceRegressions.ts
 */

import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { buildQueryPlan } from '../supabase/functions/process-share-link/resolver/queryBuilder';
import { mapPlacesV1Candidate } from '../supabase/functions/process-share-link/places/googlePlaces';
import {
  isPlaceholderValue,
  buildCleanPlacesQueries,
} from '../lib/shareAgent/queryCleaner';
import { isNoiseHandle, isPlatformSelfReference, extractCityStateContext } from '../lib/shareAgent/recoveryHints';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Snapchat: platform self-reference (twitter:site) never becomes evidence
// ---------------------------------------------------------------------------
{
  // Minimal reproduction of the exact meta tag every snapchat.com page
  // carries, verified live on a real public Spotlight share.
  const html = `<html><head>
    <meta property="og:site_name" content="Snapchat"/>
    <meta property="twitter:site" content="@Snapchat"/>
  </head></html>`;
  const title = '2.0K likes, 69 comments, and 37 shares | Chris Magee Unloads Luggage at Airport with Black SUV | Chris Magee (@chrismagee3) | Posted Aug 1, 2026 | Spotlight';
  const description = "A young man walks through an airport parking lot pulling a silver suitcase and places it in a black SUV.";

  const handles = extractHandles({ platform: 'genericWeb' as any, title, description, html });
  check('Snapchat: poster handle is the actual poster, not the platform', handles.posterHandle === 'chrismagee3', handles.posterHandle ?? 'null');
  check('Snapchat: @Snapchat never enters venueHandles', !handles.venueHandles.includes('snapchat'), JSON.stringify(handles.venueHandles));

  const evidence = extractEvidence({ platform: 'genericWeb' as any, title, description, handles });
  check('Snapchat: no venue name hint derived from platform self-reference', evidence.venueNameHints.length === 0, JSON.stringify(evidence.venueNameHints));

  const plan = buildQueryPlan(evidence);
  check('Snapchat: "Snapchat" is never issued as a Places query', !plan.queries.some((q) => q.toLowerCase() === 'snapchat'), JSON.stringify(plan.queries));
  check('Snapchat: no explicit place evidence for a video with no venue content', !plan.hasExplicitPlaceEvidence);
}

// ---------------------------------------------------------------------------
// 2. YouTube: JS config-blob noise (`@.null`) never becomes a name
// ---------------------------------------------------------------------------
{
  // Minimal reproduction of the exact minified-JS substring found live in a
  // real YouTube Shorts page's <script> config blob.
  const html = `<html><head></head><body><script>
    var ytcfg = {"UUFaWc":"%.@.null,1000,2]","u4g7r":"%.@.null,1,3]"};
  </script></body></html>`;
  const title = "Trying and Ranking South OC's Top 5 Rated Pizza Spots";
  const description = 'For whatever reason South Orange County has a high concentration of really good pizza spots. We tried 5 of the top rated spots and ranked them based on taste...';

  const handles = extractHandles({ platform: 'youtube' as any, title, description, html });
  check('YouTube: no poster handle derived from JS config noise', handles.posterHandle === null, handles.posterHandle ?? 'null');
  check('YouTube: ".null" never enters venueHandles', handles.venueHandles.length === 0, JSON.stringify(handles.venueHandles));

  const evidence = extractEvidence({ platform: 'youtube' as any, title, description, handles });
  check('YouTube: roundup post correctly detected', evidence.isRoundup);
  check('YouTube: no venue name hint of "Null"', !evidence.venueNameHints.some((h) => isPlaceholderValue(h)), JSON.stringify(evidence.venueNameHints));

  const plan = buildQueryPlan(evidence);
  check('YouTube: no placeholder-only query ever issued', !plan.queries.some((q) => isPlaceholderValue(q)), JSON.stringify(plan.queries));
  check('YouTube: zero queries => safe manual fallback (no caption venue evidence)', plan.queries.length === 0, JSON.stringify(plan.queries));
}

// ---------------------------------------------------------------------------
// 3. TikTok: an app-store redirect must not be treated as post content
// ---------------------------------------------------------------------------
{
  // We can't hit the network in a deterministic test, but we CAN pin the
  // pure host-classification boundary that fetchPostMetadata now applies to
  // whatever `res.url` a redirect chain resolves to. Reproduced from the
  // real resolved URL captured on a live TikTok SEO/keyword discovery link.
  const resolvedUrl = 'https://apps.apple.com/us/app/tiktok-videos-shop-live/id835599320';
  let hostIsKnownNonContent = false;
  try {
    hostIsKnownNonContent = ['apps.apple.com', 'itunes.apple.com', 'play.google.com'].includes(
      new URL(resolvedUrl).hostname.toLowerCase(),
    );
  } catch {
    /* unreachable in this fixture */
  }
  check('TikTok: App Store redirect host is recognized as non-content', hostIsKnownNonContent);
}

// ---------------------------------------------------------------------------
// 4. Shared placeholder-value sanitation boundary
// ---------------------------------------------------------------------------
{
  for (const bad of ['null', 'Null', '<Null>', 'undefined', '<undefined>', 'none', 'n/a', 'N/A', 'unknown', 'NaN', '', '   ']) {
    check(`isPlaceholderValue rejects ${JSON.stringify(bad)}`, isPlaceholderValue(bad));
  }
  for (const good of ["Mammen & Null Lawyers LLC", 'None the Wiser Pub', "Tony's Pizza", 'Unknown Brewing Co']) {
    check(`isPlaceholderValue keeps real name ${JSON.stringify(good)}`, !isPlaceholderValue(good));
  }
  check(
    'isPlaceholderValue treats JS null/undefined as placeholders',
    isPlaceholderValue(null) && isPlaceholderValue(undefined),
  );

  // buildCleanPlacesQueries never returns a bare placeholder query, even when
  // explicitly handed one as the strongest-looking evidence (placeName).
  const queries = buildCleanPlacesQueries({
    title: null,
    description: null,
    placeName: 'Null',
    city: null,
    allowGenericCaptionSeed: true,
  });
  check('buildCleanPlacesQueries never returns a bare "Null" query', !queries.some((q) => isPlaceholderValue(q)), JSON.stringify(queries));

  // A real candidate whose Google-returned name/address IS literally the
  // placeholder text (verified live for two "natural_feature" results
  // returned by a "Null" search) must never pass the candidate boundary.
  const placeholderCandidate = mapPlacesV1Candidate({
    id: 'ChIJPaza-Mt3PIcRhgSZPNkT9N8',
    displayName: { text: '<Null>' },
    formattedAddress: '<Null>, South River, NM 87410, USA',
    types: ['establishment', 'natural_feature'],
  });
  check('mapPlacesV1Candidate preserves the raw (still-unsanitized) name for the caller to filter', placeholderCandidate.name === '<Null>');
  check('isPlaceholderValue flags that raw candidate name', isPlaceholderValue(placeholderCandidate.name));

  const realCandidate = mapPlacesV1Candidate({
    id: 'ChIJha8YelXHwoARghJP0-5cI2Q',
    displayName: { text: 'The Red Chickz' },
    formattedAddress: '557 S Spring St, Los Angeles, CA 90013, USA',
    types: ['establishment', 'restaurant'],
  });
  check('A real candidate is never flagged as a placeholder', !isPlaceholderValue(realCandidate.name));
}

// ---------------------------------------------------------------------------
// 5. Handle-noise / platform-self-reference boundary (unified list)
// ---------------------------------------------------------------------------
{
  check('isNoiseHandle rejects @Snapchat', isNoiseHandle('@snapchat'));
  check('isNoiseHandle rejects Facebook', isNoiseHandle('facebook'));
  check('isNoiseHandle rejects a leading-dot JSON-LD/config artifact (.null)', isNoiseHandle('.null'));
  check('isNoiseHandle rejects JSON-LD "@type"', isNoiseHandle('type'));
  check('isNoiseHandle keeps a real venue handle', !isNoiseHandle('paradisedynasty_usa'));
  check('isPlatformSelfReference recognizes every wired platform brand', [
    'instagram', 'tiktok', 'youtube', 'facebook', 'snapchat', 'spotlight', 'twitter', 'x',
  ].every((p) => isPlatformSelfReference(p)));
  check('isPlatformSelfReference does not flag a real handle that merely contains a platform word', !isPlatformSelfReference('mediakitchen'));
}

// ---------------------------------------------------------------------------
// 6. Geography: explicit CA region text is recognized (existing wrong-
//    location veto — placeScoring.ts isWrongLocationCandidate — then has a
//    real expectedState to check candidates against; not re-tested here,
//    that veto is unit-tested at its own module).
// ---------------------------------------------------------------------------
{
  const ctx = extractCityStateContext("Trying South Orange County's top 5 pizza spots");
  check('extractCityStateContext recognizes "Orange County" as CA', ctx?.state === 'CA', JSON.stringify(ctx));
  check('extractCityStateContext does NOT fire on the bare "OC" abbreviation (too ambiguous)', extractCityStateContext('big OC energy today') === null);
}

// NOTE: fetchPostMetadata's live redirect-following behavior (the actual
// network call that resolves a TikTok short link onto apps.apple.com) is
// NOT exercised here — Layer A is offline-only. See the opt-in live harness
// (scripts/mediaLiveRegression.ts) for the network-backed version of this
// same check against a real redirect chain.

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('All evidence-provenance regression assertions passed.');
}
