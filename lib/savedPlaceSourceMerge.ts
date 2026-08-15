/**
 * lib/savedPlaceSourceMerge.ts
 *
 * Deterministic merge policy for attaching a shared post to a saved place the
 * user ALREADY has.
 *
 * Nearr's point is remembering not just where you wanted to go but why. A
 * manual save carries no source; when a video for that same place arrives
 * later, "already saved" must mean "enrich the existing save", never "throw
 * the source away".
 *
 * `saved_places` is a SINGLE-source model today (`source_url`, `source_type`,
 * plus the separate generated `ai_note`). So the policy is fill-if-empty:
 *
 *   - no source yet          → attach the incoming post
 *   - byte/normalized match  → nothing to do (submitting the same video twice
 *                              converges instead of rewriting)
 *   - a different post       → the existing post is PRESERVED, never silently
 *                              replaced. A "latest source wins" rule would
 *                              destroy history and make real multi-source
 *                              support harder later.
 *
 * `ai_note` follows the same fill-if-empty rule and is independent of the
 * source decision — a place that keeps an older post can still gain its first
 * memory cue. `notes` is user-authored and is NEVER touched here.
 *
 * PURE + import-free on purpose: this module is shared verbatim by the React
 * Native client and the Deno edge functions, and is unit-tested from Node.
 * URL identity is delegated to the caller's normalizer (the app and the
 * functions both pass Nearr's existing `normalizeShareUrl`) so this file never
 * grows a social-URL canonicalizer of its own.
 */

export type SavedPlaceSourceType = 'manual' | 'tiktok' | 'instagram' | 'link';

/** The subset of an existing saved_places row this decision depends on. */
export type SavedPlaceSourceState = {
  source_url?: string | null;
  source_type?: string | null;
  ai_note?: string | null;
};

/** The context arriving with a newly resolved share. */
export type IncomingSourceContext = {
  sourceUrl?: string | null;
  sourceType?: string | null;
  aiNote?: string | null;
};

export type SourceMergeOutcome =
  /** The save had no source; the incoming post was attached. */
  | 'attached'
  /** The same post is already attached — idempotent no-op. */
  | 'already_attached'
  /** A DIFFERENT post is attached; it stays. Single-source limitation. */
  | 'existing_source_preserved'
  /** Nothing to attach (manual re-save, or no URL). */
  | 'no_incoming_source';

export type AiNoteMergeOutcome = 'attached' | 'existing_note_preserved' | 'no_incoming_note';

export type SavedPlaceEnrichmentPlan = {
  source: SourceMergeOutcome;
  aiNote: AiNoteMergeOutcome;
  /** Written only when `source === 'attached'`. */
  sourcePatch: { source_type: string; source_url: string } | null;
  /** Written only when `aiNote === 'attached'`. */
  aiNotePatch: { ai_note: string } | null;
  /** True when this share actually adds something to the existing save. */
  changed: boolean;
};

export type UrlNormalizer = (url: string) => string;

const trimNormalizer: UrlNormalizer = (url) => url.trim();

function cleaned(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A source is "present" only when a URL is stored — `source_type: 'manual'`
 *  with no URL carries no source information and must not block enrichment. */
export function hasAttachedSource(state: SavedPlaceSourceState | null | undefined): boolean {
  return cleaned(state?.source_url) !== null;
}

/** Same post? Compared through the caller's normalizer, so harmless tracking
 *  params never make one video look like two. Never throws. */
export function isSameSourceUrl(
  left: string | null | undefined,
  right: string | null | undefined,
  normalizeUrl: UrlNormalizer = trimNormalizer,
): boolean {
  const a = cleaned(left);
  const b = cleaned(right);
  if (!a || !b) return false;
  if (a === b) return true;
  let normalizedA = a;
  let normalizedB = b;
  try {
    normalizedA = cleaned(normalizeUrl(a)) ?? a;
    normalizedB = cleaned(normalizeUrl(b)) ?? b;
  } catch {
    return a === b;
  }
  return normalizedA === normalizedB ||
    normalizedA.toLowerCase() === normalizedB.toLowerCase();
}

/**
 * Decide what a resolved share may add to an existing saved place.
 *
 * The returned patches are additive only: no field that carries user state
 * (notes, radius, reminders, visit/archive, counts, timestamps, identity) is
 * ever part of a patch produced here.
 */
export function planSavedPlaceEnrichment(
  existing: SavedPlaceSourceState | null | undefined,
  incoming: IncomingSourceContext | null | undefined,
  normalizeUrl: UrlNormalizer = trimNormalizer,
): SavedPlaceEnrichmentPlan {
  const existingUrl = cleaned(existing?.source_url);
  const incomingUrl = cleaned(incoming?.sourceUrl);
  const incomingType = cleaned(incoming?.sourceType);

  let source: SourceMergeOutcome;
  let sourcePatch: SavedPlaceEnrichmentPlan['sourcePatch'] = null;

  if (!incomingUrl || incomingType === 'manual') {
    // A manual save (re-)saving a place brings no post. Writing `manual` over
    // a real source_type would orphan a stored video URL behind the wrong
    // label, so this case touches nothing.
    source = 'no_incoming_source';
  } else if (!existingUrl) {
    source = 'attached';
    sourcePatch = { source_type: incomingType ?? 'link', source_url: incomingUrl };
  } else if (isSameSourceUrl(existingUrl, incomingUrl, normalizeUrl)) {
    source = 'already_attached';
  } else {
    source = 'existing_source_preserved';
  }

  const existingNote = cleaned(existing?.ai_note);
  const incomingNote = cleaned(incoming?.aiNote);
  let aiNote: AiNoteMergeOutcome;
  let aiNotePatch: SavedPlaceEnrichmentPlan['aiNotePatch'] = null;
  if (!incomingNote) {
    aiNote = 'no_incoming_note';
  } else if (existingNote) {
    // An earlier source's cue is not rewritten by a later one.
    aiNote = 'existing_note_preserved';
  } else {
    aiNote = 'attached';
    aiNotePatch = { ai_note: incomingNote };
  }

  return {
    source,
    aiNote,
    sourcePatch,
    aiNotePatch,
    changed: sourcePatch !== null || aiNotePatch !== null,
  };
}

export type AlreadySavedActionCopy = {
  /** Primary button label on the already-saved confirmation. */
  action: string;
  /** Honest one-line explanation, or null when there is nothing to explain. */
  note: string | null;
};

/**
 * Copy for the share-queue confirmation when the resolved place is already on
 * the user's map. The action still runs the normal save (which enriches), so
 * the label has to describe what will actually happen — including the case
 * where a different post is already attached and this one cannot be.
 */
export function alreadySavedActionCopy(
  existing: SavedPlaceSourceState | null | undefined,
  incoming: IncomingSourceContext | null | undefined,
  normalizeUrl: UrlNormalizer = trimNormalizer,
): AlreadySavedActionCopy {
  const plan = planSavedPlaceEnrichment(existing, incoming, normalizeUrl);
  if (plan.source === 'attached') {
    return { action: 'Add this post', note: 'This post will be attached to the place you already saved.' };
  }
  if (plan.source === 'existing_source_preserved') {
    return {
      action: 'View on map',
      note: 'Another post is already attached to this place, and Nearr keeps that one.',
    };
  }
  if (plan.aiNote === 'attached') {
    return { action: 'Add this post', note: 'This post will be attached to the place you already saved.' };
  }
  return { action: 'View on map', note: null };
}
