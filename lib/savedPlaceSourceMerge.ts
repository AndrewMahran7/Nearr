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
 * `saved_places` is a SINGLE-source model today. Two facts follow, and both
 * are enforced here rather than at each call site:
 *
 * 1. `source_url` + `source_type` are ONE logical source identity, never two
 *    independently mergeable fields. They are only ever written together, and
 *    a different incoming post may not mutate either half. A per-field merge
 *    could otherwise produce `source_url = <Reel A>, source_type = 'tiktok'`,
 *    which describes a post that does not exist.
 *
 * 2. An `ai_note` describes a specific post, but the place page renders it as
 *    "why you saved it" next to whichever source IS attached. So a note may
 *    only be stored when the incoming post is the source the saved place
 *    actually represents. A note from a post we declined to attach would read
 *    as a description of the attached post — misleading provenance.
 *
 * Every patch below therefore travels WITH the precondition that makes it
 * safe, expressed as the row state the writer must still observe. That is what
 * keeps two racing jobs coherent: whoever loses the source slot also fails the
 * precondition on the type and the note, so no job can describe another job's
 * source.
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
  /** The save had no post attached; the incoming pair was attached. */
  | 'attached'
  /** The same post is already attached — identity unchanged. */
  | 'already_attached'
  /** A DIFFERENT post is attached; it stays, whole. Single-source limitation. */
  | 'existing_source_preserved'
  /** Nothing to attach (manual re-save, or no URL). */
  | 'no_incoming_source';

export type AiNoteMergeOutcome =
  | 'attached'
  /** The represented source already has a cue; an earlier one is never rewritten. */
  | 'existing_note_preserved'
  /** The note describes a post this place does NOT represent. Provenance rule. */
  | 'withheld_unrepresented_source'
  | 'no_incoming_note';

/**
 * A write plus the row state the writer must still observe for it to be
 * correct. `expectSourceUrl`/`expectSourceType` are OBSERVED values, applied as
 * `.is(col, null)` when null and `.eq(col, value)` otherwise, so a row that
 * moved underneath us simply matches zero rows instead of being corrupted.
 */
export type GuardedPatch<T> = {
  patch: T;
  /** Row must still hold this `source_url` (null = still unattached). */
  expectSourceUrl: string | null;
  /** Row must still hold this `source_type`. Only set for the type backfill. */
  expectSourceType?: string | null;
};

export type SavedPlaceEnrichmentPlan = {
  source: SourceMergeOutcome;
  aiNote: AiNoteMergeOutcome;
  /** The COMPLETE source identity, written as one update. Attach only. */
  sourcePatch: GuardedPatch<{ source_type: string; source_url: string }> | null;
  /** Backfill of a missing/`manual` type for the post ALREADY stored. Only
   *  ever emitted when the incoming URL is provably that same post, so it can
   *  never describe someone else's URL. */
  sourceTypePatch: GuardedPatch<{ source_type: string }> | null;
  /** Only emitted when the incoming post IS the represented source. */
  aiNotePatch: GuardedPatch<{ ai_note: string }> | null;
  /** The post this saved place represents once this plan is applied, or null
   *  when the incoming post is not (and will not become) that source. */
  representedSourceUrl: string | null;
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
 *  with no URL carries no post and must not block the first real one. */
export function hasAttachedSource(state: SavedPlaceSourceState | null | undefined): boolean {
  return cleaned(state?.source_url) !== null;
}

/** `null`, blank, and `manual` all mean "this does not name a social post".
 *  Legacy rows carry `manual` beside a real URL; that type may be corrected,
 *  but ONLY by the post whose URL is already stored. */
function describesNoPost(sourceType: unknown): boolean {
  const type = cleaned(sourceType);
  return type === null || type === 'manual';
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
  // The RAW stored value, not the trimmed one — guards compare against what
  // the row actually holds.
  const storedUrl = typeof existing?.source_url === 'string' ? existing.source_url : null;
  const storedType = typeof existing?.source_type === 'string' ? existing.source_type : null;
  const existingUrl = cleaned(storedUrl);
  const incomingUrl = cleaned(incoming?.sourceUrl);
  const incomingType = cleaned(incoming?.sourceType);

  let source: SourceMergeOutcome;
  let sourcePatch: SavedPlaceEnrichmentPlan['sourcePatch'] = null;
  let sourceTypePatch: SavedPlaceEnrichmentPlan['sourceTypePatch'] = null;
  let representedSourceUrl: string | null = null;

  if (!incomingUrl || incomingType === 'manual') {
    // A manual save (re-)saving a place brings no post. Writing `manual` over
    // a real source_type would orphan a stored video URL behind the wrong
    // label, so this case touches nothing and represents nothing.
    source = 'no_incoming_source';
  } else if (!existingUrl) {
    // Case A. The pair is attached together, conditional on the slot still
    // being exactly as observed — a racing job that got there first wins it.
    source = 'attached';
    sourcePatch = {
      patch: { source_type: incomingType ?? 'link', source_url: incomingUrl },
      expectSourceUrl: storedUrl,
    };
    representedSourceUrl = incomingUrl;
  } else if (isSameSourceUrl(existingUrl, incomingUrl, normalizeUrl)) {
    // Case B. Identity is unchanged; this post IS what the place represents,
    // so its own missing metadata may be filled in.
    source = 'already_attached';
    representedSourceUrl = storedUrl;
    if (describesNoPost(storedType) && incomingType) {
      sourceTypePatch = {
        patch: { source_type: incomingType },
        expectSourceUrl: storedUrl,
        expectSourceType: storedType,
      };
    }
  } else {
    // Case C. A different post. The existing pair is preserved WHOLE, and this
    // place does not represent the incoming post — so nothing derived from it
    // may be written either.
    source = 'existing_source_preserved';
  }

  const existingNote = cleaned(existing?.ai_note);
  const incomingNote = cleaned(incoming?.aiNote);
  let aiNote: AiNoteMergeOutcome;
  let aiNotePatch: SavedPlaceEnrichmentPlan['aiNotePatch'] = null;
  if (!incomingNote) {
    aiNote = 'no_incoming_note';
  } else if (representedSourceUrl === null) {
    // The cue describes a post this saved place does not (and will not) show.
    // Storing it would caption the ATTACHED post with another post's words.
    aiNote = 'withheld_unrepresented_source';
  } else if (existingNote) {
    aiNote = 'existing_note_preserved';
  } else {
    aiNote = 'attached';
    aiNotePatch = {
      patch: { ai_note: incomingNote },
      // Only write while the row still represents this exact post: a job that
      // lost the source race fails here instead of mislabelling the winner.
      expectSourceUrl: representedSourceUrl,
    };
  }

  return {
    source,
    aiNote,
    sourcePatch,
    sourceTypePatch,
    aiNotePatch,
    representedSourceUrl,
    changed: sourcePatch !== null || sourceTypePatch !== null || aiNotePatch !== null,
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
  if (plan.source === 'existing_source_preserved') {
    return {
      action: 'View on map',
      note: 'Another post is already attached to this place, and Nearr keeps that one.',
    };
  }
  if (plan.source === 'attached') {
    return { action: 'Add this post', note: 'This post will be attached to the place you already saved.' };
  }
  if (plan.changed) {
    // Same post, but it can still complete what is stored about it.
    return { action: 'Add this post', note: null };
  }
  return { action: 'View on map', note: null };
}
