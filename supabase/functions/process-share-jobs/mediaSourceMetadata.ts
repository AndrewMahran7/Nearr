// supabase/functions/process-share-jobs/mediaSourceMetadata.ts
//
// PURE normalization of the public post metadata the media worker already
// obtained while retrieving the video (yt-dlp's `-j` probe), so the media
// fallback path feeds the resolver the SAME first-party identity evidence the
// ordinary metadata path would have had.
//
// The failure this closes: when Instagram's metadata endpoint fails, the job
// falls back to media. The fallback used to hand the resolver only the model's
// structured places plus an empty handle set, so a caption that NAMES the
// venue was used to prompt the model and then thrown away. Verified live on
// the Santa Fe reel — yt-dlp returns
//   description: "This classic Italian deli has been around since 1947! 🍝
//                 @santafeimporters1947 with locations in Long Beach and
//                 Seal Beach…"
//   channel:     "ocfoodandview"
// while the model contributed only the street address read off the video.
// Neither half identifies the place alone: 12430 Seal Beach Blvd is a
// multi-tenant center, and the caption carries no street address. Together
// they resolve exactly one business.
//
// No imports on purpose — runs under Deno in the edge function and under
// ts-node in scripts/testMediaSourceMetadata.ts.

/** Source-retention bounds re-enforced at the worker callback trust boundary. */
const MAX_TITLE = 500;
export const SOURCE_DESCRIPTION_RETENTION_MAX = 10_000;

export type MediaSourceMetadata = {
  title: string | null;
  description: string | null;
  /** The post author's handle. Carried so it can be EXCLUDED from the venue
   *  set — never so it can become a venue name. */
  creatorHandle: string | null;
  postId: string | null;
  sourceId: string | null;
  creatorName: string | null;
  creatorId: string | null;
  /** Public extractor location label. Context only, never final place identity. */
  location: string | null;
};

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function boundedSourceDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  let bounded = normalized.slice(0, SOURCE_DESCRIPTION_RETENTION_MAX);
  const last = bounded.charCodeAt(bounded.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

function boundedHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9._]{2,30}$/.test(normalized)) return null;
  if (/^\d+$/.test(normalized)) return null;
  return normalized;
}

function boundedPostId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^\d{1,24}$/.test(normalized) ? normalized : null;
}

/**
 * Parse the worker's `sourceMetadata` block. Returns null when nothing usable
 * is present — an older worker, an extractor that exposes no caption, or a
 * malformed payload. Callers MUST treat null as "carry on exactly as before":
 * this evidence is additive and its absence is never a task failure.
 */
export function parseMediaSourceMetadata(raw: unknown): MediaSourceMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = boundedText(r.title, MAX_TITLE);
  const description = boundedSourceDescription(r.description);
  const creatorHandle = boundedHandle(r.creatorHandle);
  const postId = boundedPostId(r.postId);
  const sourceId = boundedText(r.sourceId, 120);
  const creatorName = boundedText(r.creatorName, 200);
  const creatorId = boundedText(r.creatorId, 120);
  const location = boundedText(r.location, 500);
  if (!title && !description && !creatorHandle && !postId && !sourceId && !creatorName && !creatorId && !location) return null;
  return { title, description, creatorHandle, postId, sourceId, creatorName, creatorId, location };
}

/**
 * Recover source metadata from either the canonical nested media shape or the
 * older synchronous extraction shape (`title` / `description` at top level).
 */
export function sourceMetadataFromExtractionPayload(raw: unknown): MediaSourceMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  return parseMediaSourceMetadata(payload.sourceMetadata ?? payload);
}

/**
 * Replay-safe enrichment. A retry may re-fetch a shorter provider caption;
 * keep the richer retained value instead of progressively replacing it.
 */
export function mergeRetainedSourceMetadata(
  existing: MediaSourceMetadata | null,
  incoming: MediaSourceMetadata | null,
): MediaSourceMetadata | null {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const richer = (left: string | null, right: string | null): string | null => {
    if (!left) return right;
    if (!right) return left;
    return right.length > left.length ? right : left;
  };
  return {
    title: richer(existing.title, incoming.title),
    description: richer(existing.description, incoming.description),
    creatorHandle: existing.creatorHandle ?? incoming.creatorHandle,
    postId: existing.postId ?? incoming.postId,
    sourceId: existing.sourceId ?? incoming.sourceId,
    creatorName: existing.creatorName ?? incoming.creatorName,
    creatorId: existing.creatorId ?? incoming.creatorId,
    location: existing.location ?? incoming.location,
  };
}

/**
 * Store the source caption once, in a canonical nested block, while retaining
 * non-caption diagnostics from the prior extraction payload.
 */
export function withRetainedSourceMetadata(
  prior: unknown,
  patch: Record<string, unknown>,
  source: MediaSourceMetadata | null,
): Record<string, unknown> {
  const previous = prior && typeof prior === 'object'
    ? { ...(prior as Record<string, unknown>) }
    : {};
  // Older metadata payloads kept these at top level. Remove them when the
  // nested source block is written so the same large caption is not duplicated.
  delete previous.title;
  delete previous.description;
  delete previous.sourceMetadata;
  return {
    ...previous,
    ...patch,
    ...(source ? { sourceMetadata: source } : {}),
  };
}

export type RenderedCaptionLike = { title: string; description: string };

/**
 * Combine source caption text with the model-rendered place lines into the
 * single caption blob `extractEvidence` consumes.
 *
 * ENRICHES, never replaces. The rendered lines are what the model saw in the
 * video (typically the street address); the source description is what the
 * post itself says (typically the venue name/handle). Dropping either one
 * loses a real place.
 *
 * The source caption goes FIRST on purpose: `pairVenuesToAddresses` pairs each
 * address with the nearest venue hint appearing BEFORE it, so a caption naming
 * the venue must precede the rendered address lines to pair with them.
 *
 * The source TITLE is deliberately excluded. Extractors put a generated label
 * there ("Video by ocfoodandview") that names the creator, not the place —
 * feeding it in would push a creator name toward the venue-hint heuristics for
 * no benefit, since the real caption already lives in `description`.
 */
export function mergeMediaCaption(
  source: MediaSourceMetadata | null,
  rendered: RenderedCaptionLike,
): RenderedCaptionLike {
  if (!source?.description) return rendered;
  return {
    title: rendered.title,
    description: [source.description, rendered.description]
      .filter((part) => !!part && part.trim())
      .join('\n'),
  };
}

/**
 * Low-cardinality diagnostics. Counts and booleans only — never caption text,
 * never the creator's identity — so a failure report can distinguish "the
 * extractor gave us no venue clue" from "it did and normalization dropped it".
 */
export function summarizeSourceMetadata(args: {
  source: MediaSourceMetadata | null;
  venueHandles: readonly string[];
  posterHandlePresent: boolean;
  venueNameHints: readonly string[];
  addressCount: number;
}): Record<string, unknown> {
  return {
    sourceMetadataPresent: !!args.source,
    sourceDescriptionPresent: !!args.source?.description,
    sourceTitlePresent: !!args.source?.title,
    creatorHandlePresent: !!args.source?.creatorHandle,
    sourcePostIdPresent: !!args.source?.postId,
    sourceIdentityPresent: !!args.source?.sourceId,
    creatorIdentityPresent: !!args.source?.creatorName || !!args.source?.creatorId,
    creatorExcludedFromVenues: !!args.source?.creatorHandle && args.posterHandlePresent,
    sourceVenueHandleCount: args.venueHandles.length,
    venueHintCount: args.venueNameHints.length,
    addressCount: args.addressCount,
  };
}
