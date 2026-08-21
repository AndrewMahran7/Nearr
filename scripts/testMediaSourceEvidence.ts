/**
 * scripts/testMediaSourceEvidence.ts
 *
 * Media fallback must carry forward the strongest PUBLIC first-party identity
 * evidence from the post instead of degrading a named place into an
 * address-only guess.
 *
 * The failure this pins (production job e1f1eb37, Instagram reel Db60wxqvvOI):
 * Instagram's metadata endpoint failed, the job fell back to media, and the
 * finalize path handed the resolver an EMPTY handle set plus only the
 * model-rendered place lines. The caption naming the venue was used to prompt
 * the model and then discarded, so:
 *
 *   caption_venue_hint    ❌      (no venue text in the rendered caption)
 *   venue_handle_tagged   ❌      (handles were hardcoded empty)
 *   → addressVerification strategy = address_only
 *   → 12430 Seal Beach Blvd is a multi-tenant center → no single business
 *   → manual_fallback
 *
 * The two halves are individually insufficient and jointly decisive: the
 * caption carries the venue but NO street address, the video carries the
 * street address but no venue name.
 *
 * Fixtures below are grounded in the real `yt-dlp -j` output for that reel
 * (captured 2026-08-16, read-only). Nothing is invented:
 *   description: "This classic Italian deli has been around since 1947! 🍝
 *                 @santafeimporters1947 with locations in Long Beach and Seal
 *                 Beach, serves up huge sandwiches from the deli using Italian
 *                 meat and cheeses, salads, and hot pastas!"
 *   title:       "Video by ocfoodandview"
 *   channel:     "ocfoodandview"
 *   uploader:    "OC Food | Christine☀️"
 *   uploader_id: "5366978089"
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMediaSourceEvidence.ts
 */
import assert from 'node:assert/strict';

import {
  parseMediaSourceMetadata,
  mergeMediaCaption,
} from '../supabase/functions/process-share-jobs/mediaSourceMetadata';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- Grounded Santa Fe fixture ---------------------------------------------
const SANTA_FE_DESCRIPTION =
  'This classic Italian deli has been around since 1947! 🍝 @santafeimporters1947 ' +
  'with locations in Long Beach and Seal Beach, serves up huge sandwiches from the ' +
  'deli using Italian meat and cheeses, salads, and hot pastas!';
const SANTA_FE_SOURCE = {
  title: 'Video by ocfoodandview',
  description: SANTA_FE_DESCRIPTION,
  creatorHandle: 'ocfoodandview',
};
/** What the model read off the video: the street address, no venue name. */
const SANTA_FE_RENDERED = {
  title: '12430 Seal Beach Blvd',
  description: '12430 Seal Beach Blvd, Seal Beach, CA',
  renderedPlaces: 1,
};

/** Reproduce exactly what finalizeMediaTask now does. */
function resolveMediaEvidence(
  rawSourceMetadata: unknown,
  rendered: { title: string; description: string },
  platform: any = 'instagram',
) {
  const source = parseMediaSourceMetadata(rawSourceMetadata);
  const handles = source
    ? extractHandles({
        platform,
        title: source.title,
        description: source.description,
        html: null,
        knownPosterHandle: source.creatorHandle,
      })
    : { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
  const merged = mergeMediaCaption(source, rendered);
  const evidence = extractEvidence({
    platform,
    title: merged.title,
    description: merged.description,
    handles,
    taggedLocation: null,
  });
  return { source, handles, merged, evidence };
}

// ---------------------------------------------------------------------------
// 1. Santa Fe — the regression. Venue identity AND address both survive.
// ---------------------------------------------------------------------------
{
  const { handles, evidence } = resolveMediaEvidence(SANTA_FE_SOURCE, SANTA_FE_RENDERED);
  check('1a: venue_handle_tagged emitted',
    evidence.keys.includes('venue_handle_tagged'), evidence.keys.join(','));
  check('1b: caption_venue_hint emitted',
    evidence.keys.includes('caption_venue_hint'), evidence.keys.join(','));
  check('1c: caption_explicit_address survives the merge',
    evidence.keys.includes('caption_explicit_address'), evidence.keys.join(','));
  check('1d: venue handle is santafeimporters1947',
    handles.venueHandles.includes('santafeimporters1947'), handles.venueHandles.join(','));
  check('1e: creator ocfoodandview is the poster, NOT a venue',
    handles.posterHandle === 'ocfoodandview' &&
      !handles.venueHandles.includes('ocfoodandview'),
    `poster=${handles.posterHandle} venues=${handles.venueHandles.join(',')}`);
  check('1f: a venue hint derived from the tagged handle exists',
    evidence.venueNameHints.some((h) => /santafe/i.test(h)),
    evidence.venueNameHints.join(' | '));
  check('1g: the Seal Beach street address is present',
    !!evidence.address && /12430 seal beach blvd/i.test(evidence.address.raw),
    evidence.address?.raw ?? 'none');
  // The whole point: the resolver can now build a venue+address query, which
  // is the rung that identifies one tenant in a multi-tenant center.
  check('1h: address is paired with the venue (enables venue_plus_address)',
    !!evidence.address?.venue && /santafe/i.test(evidence.address.venue),
    evidence.address?.venue ?? 'null');
  check('1i: no venue hint is the creator',
    !evidence.venueNameHints.some((h) => /ocfoodandview|oc food/i.test(h)),
    evidence.venueNameHints.join(' | '));
}

// ---------------------------------------------------------------------------
// 2. THE OLD BEHAVIOR. Without source metadata, the same reel degrades to
//    address-only — the safe-but-wrong outcome we are fixing. Proves the
//    fixture actually depends on the new evidence rather than passing anyway.
// ---------------------------------------------------------------------------
{
  const { evidence } = resolveMediaEvidence(null, SANTA_FE_RENDERED);
  check('2a: without source metadata there is no venue handle',
    !evidence.keys.includes('venue_handle_tagged'), evidence.keys.join(','));
  check('2b: without source metadata there is no venue hint',
    !evidence.keys.includes('caption_venue_hint'), evidence.keys.join(','));
  check('2c: the address alone still survives (unchanged behavior)',
    evidence.keys.includes('caption_explicit_address'), evidence.keys.join(','));
}

// ---------------------------------------------------------------------------
// 3. METADATA ↔ MEDIA PARITY. The same caption through the ordinary metadata
//    path and through the media source-metadata path must preserve the same
//    identity concepts. This is the central contract.
// ---------------------------------------------------------------------------
{
  // Ordinary metadata path: Instagram's og:title carries "Name (@handle)".
  const metadataTitle =
    'OC Food | Christine☀️ (@ocfoodandview) on Instagram: "' + SANTA_FE_DESCRIPTION + '"';
  const metaHandles = extractHandles({
    platform: 'instagram',
    title: metadataTitle,
    description: SANTA_FE_DESCRIPTION,
    html: null,
  });
  const metaEvidence = extractEvidence({
    platform: 'instagram',
    title: metadataTitle,
    description: SANTA_FE_DESCRIPTION + '\n12430 Seal Beach Blvd, Seal Beach, CA',
    handles: metaHandles,
    taggedLocation: null,
  });
  const { evidence: mediaEvidence, handles: mediaHandles } = resolveMediaEvidence(
    SANTA_FE_SOURCE,
    SANTA_FE_RENDERED,
  );

  for (const key of ['caption_venue_hint', 'venue_handle_tagged', 'caption_explicit_address']) {
    check(`3-${key}: present on BOTH paths`,
      metaEvidence.keys.includes(key) && mediaEvidence.keys.includes(key),
      `metadata=${metaEvidence.keys.includes(key)} media=${mediaEvidence.keys.includes(key)}`);
  }
  check('3a: both paths agree the venue handle is santafeimporters1947',
    metaHandles.venueHandles.includes('santafeimporters1947') &&
      mediaHandles.venueHandles.includes('santafeimporters1947'),
    `meta=${metaHandles.venueHandles.join(',')} media=${mediaHandles.venueHandles.join(',')}`);
  check('3b: both paths agree the creator is the poster',
    metaHandles.posterHandle === 'ocfoodandview' && mediaHandles.posterHandle === 'ocfoodandview',
    `meta=${metaHandles.posterHandle} media=${mediaHandles.posterHandle}`);
  check('3c: both paths keep the same street address',
    metaEvidence.address?.raw === mediaEvidence.address?.raw,
    `meta=${metaEvidence.address?.raw} media=${mediaEvidence.address?.raw}`);
  check('3d: both paths keep the multi-location context (Long Beach + Seal Beach)',
    /long beach/i.test(metaEvidence.captionText) && /long beach/i.test(mediaEvidence.captionText),
    'multi-location text missing');
}

// ---------------------------------------------------------------------------
// 4. CREATOR vs VENUE. A creator handle must never become a venue.
// ---------------------------------------------------------------------------
{
  // 4a. Creator + tagged venue.
  const { handles } = resolveMediaEvidence(
    {
      title: 'Video by atlbucketlist',
      description: 'check out @santafeimporters1947',
      creatorHandle: 'atlbucketlist',
    },
    { title: '', description: '' },
  );
  check('4a: creator atlbucketlist excluded from venues',
    !handles.venueHandles.includes('atlbucketlist'), handles.venueHandles.join(','));
  check('4b: tagged venue still recognized',
    handles.venueHandles.includes('santafeimporters1947'), handles.venueHandles.join(','));
}
{
  // 4c. Creator only, no venue anywhere — must not fabricate one.
  const { handles, evidence } = resolveMediaEvidence(
    {
      title: 'Video by atlbucketlist',
      description: 'you need to try this',
      creatorHandle: 'atlbucketlist',
    },
    { title: '', description: '' },
  );
  check('4c: no venue handles invented from the creator',
    handles.venueHandles.length === 0, handles.venueHandles.join(','));
  check('4d: no venue hint invented from the creator',
    !evidence.venueNameHints.some((h) => /atlbucketlist|atl bucket/i.test(h)),
    evidence.venueNameHints.join(' | '));
  check('4e: venue_handle_tagged NOT emitted',
    !evidence.keys.includes('venue_handle_tagged'), evidence.keys.join(','));
}
{
  // 4f. Creator tags themselves — still not a venue.
  const { handles } = resolveMediaEvidence(
    {
      title: 'Video by atlbucketlist',
      description: 'posted by @atlbucketlist today',
      creatorHandle: 'atlbucketlist',
    },
    { title: '', description: '' },
  );
  check('4f: self-tagged creator is not a venue',
    !handles.venueHandles.includes('atlbucketlist'), handles.venueHandles.join(','));
}

// ---------------------------------------------------------------------------
// 5. PLATFORM NOISE. Preserve the existing contamination guards.
// ---------------------------------------------------------------------------
{
  const { handles, evidence } = resolveMediaEvidence(
    {
      title: 'Video by someone',
      description: 'follow us @instagram @tiktok @media — TikTok and Instagram',
      creatorHandle: 'someone',
    },
    { title: '', description: '' },
  );
  for (const noise of ['instagram', 'tiktok', 'media']) {
    check(`5-${noise}: not a venue handle`,
      !handles.venueHandles.includes(noise), handles.venueHandles.join(','));
  }
  check('5a: no platform-name venue hint',
    !evidence.venueNameHints.some((h) => /^(tiktok|instagram|media)$/i.test(h.trim())),
    evidence.venueNameHints.join(' | '));
}

// ---------------------------------------------------------------------------
// 6. MULTI-PLACE. Several tagged venues stay several — never first-handle-wins.
// ---------------------------------------------------------------------------
{
  const { handles } = resolveMediaEvidence(
    {
      title: 'Video by atlbucketlist',
      description: '5 spots: @venueaaa @venuebbb @venueccc',
      creatorHandle: 'atlbucketlist',
    },
    { title: '', description: '' },
  );
  check('6a: all three venue handles retained',
    ['venueaaa', 'venuebbb', 'venueccc'].every((h) => handles.venueHandles.includes(h)),
    handles.venueHandles.join(','));
  check('6b: multiplicity not collapsed to one',
    handles.venueHandles.length === 3, String(handles.venueHandles.length));
  check('6c: creator still excluded',
    !handles.venueHandles.includes('atlbucketlist'), handles.venueHandles.join(','));
}

// ---------------------------------------------------------------------------
// 7. ADDITIVE BEHAVIOR. Missing / malformed payloads degrade to today's
//    behavior, never to an error.
// ---------------------------------------------------------------------------
{
  check('7a: undefined parses to null', parseMediaSourceMetadata(undefined) === null);
  check('7b: empty object parses to null', parseMediaSourceMetadata({}) === null);
  check('7c: garbage parses to null', parseMediaSourceMetadata('nope') === null);
  check('7d: all-null fields parse to null',
    parseMediaSourceMetadata({ title: null, description: null, creatorHandle: null }) === null);
  // A numeric account id is not a handle.
  check('7e: numeric creator id rejected',
    parseMediaSourceMetadata({ description: 'x', creatorHandle: '5366978089' })?.creatorHandle === null,
    String(parseMediaSourceMetadata({ description: 'x', creatorHandle: '5366978089' })?.creatorHandle));
  // A display name is not a handle.
  check('7f: display-name creator rejected',
    parseMediaSourceMetadata({ description: 'x', creatorHandle: 'OC Food | Christine' })?.creatorHandle === null);
  check('7g: merge with no source returns the rendered caption unchanged',
    mergeMediaCaption(null, SANTA_FE_RENDERED).description === SANTA_FE_RENDERED.description);
  // Bounds are re-enforced at the trust boundary.
  const long = parseMediaSourceMetadata({ description: 'x'.repeat(12_000) });
  check('7h: oversized description is bounded at the source-retention limit',
    (long?.description?.length ?? 0) === 10_000, String(long?.description?.length));
  check('7i: stable numeric post id is preserved as provenance',
    parseMediaSourceMetadata({ postId: '7433811014237326622' })?.postId === '7433811014237326622');
  check('7j: non-numeric post id is rejected',
    parseMediaSourceMetadata({ description: 'x', postId: 'not-a-post' })?.postId === null);
}

// ---------------------------------------------------------------------------
// 8. MERGE ORDER. The source caption must precede the rendered address lines,
//    otherwise venue↔address pairing cannot fire.
// ---------------------------------------------------------------------------
{
  const merged = mergeMediaCaption(
    parseMediaSourceMetadata(SANTA_FE_SOURCE),
    SANTA_FE_RENDERED,
  );
  const venueIdx = merged.description.toLowerCase().indexOf('@santafeimporters1947');
  const addrIdx = merged.description.toLowerCase().indexOf('12430 seal beach blvd');
  check('8a: both halves present after merge', venueIdx >= 0 && addrIdx >= 0,
    `venue=${venueIdx} addr=${addrIdx}`);
  check('8b: source caption precedes rendered address', venueIdx < addrIdx,
    `venue=${venueIdx} addr=${addrIdx}`);
  check('8c: rendered evidence is enriched, not replaced',
    merged.description.includes(SANTA_FE_RENDERED.description),
    merged.description);
  check('8d: creator-naming source title excluded from caption text',
    !merged.description.includes('Video by ocfoodandview'), merged.description);
}

// ---------------------------------------------------------------------------
// 9. TikTok parity — the same normalization, platform-neutral.
// ---------------------------------------------------------------------------
{
  const { handles, evidence } = resolveMediaEvidence(
    {
      title: 'Video by satexasfoodies',
      description: "Hidden gem coffee shop @tuxedocatscoffee in Northwest San Antonio",
      creatorHandle: 'satexasfoodies',
    },
    { title: "Tuxedo Cat's Coffee", description: "Tuxedo Cat's Coffee, 6075 Heath Rd, San Antonio, TX" },
    'tiktok',
  );
  check('9a: TikTok creator excluded from venues',
    !handles.venueHandles.includes('satexasfoodies'), handles.venueHandles.join(','));
  check('9b: TikTok tagged venue retained',
    handles.venueHandles.includes('tuxedocatscoffee'), handles.venueHandles.join(','));
  check('9c: TikTok address still extracted',
    !!evidence.address && /6075 heath rd/i.test(evidence.address.raw),
    evidence.address?.raw ?? 'none');
}

assert.ok(failures === 0, `${failures} assertion(s) failed`);
console.log('\nAll media source-evidence assertions passed.');
