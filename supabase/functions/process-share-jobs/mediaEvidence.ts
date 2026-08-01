// supabase/functions/process-share-jobs/mediaEvidence.ts
//
// PURE adapter between the containerized media worker's structured
// place-evidence output and Nearr's EXISTING deterministic resolver.
//
// The media worker (and its multimodal model) PROPOSES evidence. It never
// picks a Google Place ID, never decides safeToAutoSave, and never saves. This
// module renders that evidence into a synthetic post caption (title +
// description) that the existing `extractEvidence` → `resolveSharedPlace`
// pipeline consumes UNCHANGED — so verification, address matching, Places
// lookup, scoring, and the safeToAutoSave gate are byte-identical to Phase 1.
//
// FABRICATION GUARD: only places that carry at least one EXPLICIT evidence
// item (spoken / visible_text / caption / frame) are rendered. Inferred-only
// places are dropped — a model guess never becomes a verifiable venue on its
// own. No coordinates are forwarded (a model must not fabricate a location).
//
// No Deno globals, no I/O — unit-tested from Node (scripts/testMediaEvidenceAdapter.ts).

export type PlaceEvidenceSource = 'caption' | 'speech' | 'visible_text' | 'frame';

export type PlaceEvidenceItem = {
  timestampSeconds: number | null;
  source: PlaceEvidenceSource;
  value: string;
};

export type PlaceRole = 'primary' | 'secondary' | 'passing_mention';

export type PlaceCandidateEvidence = {
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  coordinates: { lat: number; lng: number } | null;
  role: PlaceRole;
  confidence: number;
  explicitEvidence: PlaceEvidenceItem[];
  inferredEvidence: PlaceEvidenceItem[];
};

export type MediaPlaceEvidence = {
  places: PlaceCandidateEvidence[];
  multipleIntentionalPlaces: boolean;
  insufficientEvidence: boolean;
  warnings: string[];
};

export type ParseResult =
  | { ok: true; value: MediaPlaceEvidence }
  | { ok: false; error: string };

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'caption',
  'speech',
  'visible_text',
  'frame',
]);
const VALID_ROLES: ReadonlySet<string> = new Set([
  'primary',
  'secondary',
  'passing_mention',
]);

// Bounds so a malformed / oversized model payload can never blow up the worker
// finalizer. These mirror the worker-side Zod caps (defense in depth).
const MAX_PLACES = 12;
const MAX_EVIDENCE_PER_PLACE = 24;
const MAX_STRING = 400;
const MAX_WARNINGS = 24;

function str(v: unknown, max = MAX_STRING): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseEvidenceItem(raw: unknown): PlaceEvidenceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const value = str(r.value);
  if (!value) return null;
  const source = typeof r.source === 'string' && VALID_SOURCES.has(r.source)
    ? (r.source as PlaceEvidenceSource)
    : null;
  if (!source) return null;
  const ts = num(r.timestampSeconds);
  return { timestampSeconds: ts, source, value };
}

function parsePlace(raw: unknown): PlaceCandidateEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null; // a place with no name is not verifiable.

  const role = typeof r.role === 'string' && VALID_ROLES.has(r.role)
    ? (r.role as PlaceRole)
    : 'primary';

  const explicit = Array.isArray(r.explicitEvidence)
    ? r.explicitEvidence
        .slice(0, MAX_EVIDENCE_PER_PLACE)
        .map(parseEvidenceItem)
        .filter((x): x is PlaceEvidenceItem => x !== null)
    : [];
  const inferred = Array.isArray(r.inferredEvidence)
    ? r.inferredEvidence
        .slice(0, MAX_EVIDENCE_PER_PLACE)
        .map(parseEvidenceItem)
        .filter((x): x is PlaceEvidenceItem => x !== null)
    : [];

  let confidence = num(r.confidence) ?? 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return {
    name,
    category: str(r.category),
    address: str(r.address),
    city: str(r.city),
    region: str(r.region),
    country: str(r.country),
    // Coordinates are intentionally NOT trusted from the model — never
    // forwarded into verification (no fabricated location bias).
    coordinates: null,
    role,
    confidence,
    explicitEvidence: explicit,
    inferredEvidence: inferred,
  };
}

/**
 * Defensively parse/normalize the media worker's evidence JSON. The heavy
 * schema validation lives in the worker (Zod); this is defense-in-depth so a
 * malformed payload safely degrades to "insufficient evidence" rather than
 * throwing inside the finalizer.
 */
export function parseMediaEvidence(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'evidence_not_object' };
  }
  const r = raw as Record<string, unknown>;

  const places = Array.isArray(r.places)
    ? r.places
        .slice(0, MAX_PLACES)
        .map(parsePlace)
        .filter((x): x is PlaceCandidateEvidence => x !== null)
    : [];

  const warnings = Array.isArray(r.warnings)
    ? r.warnings
        .slice(0, MAX_WARNINGS)
        .map((w) => str(w))
        .filter((x): x is string => x !== null)
    : [];

  return {
    ok: true,
    value: {
      places,
      multipleIntentionalPlaces: r.multipleIntentionalPlaces === true,
      insufficientEvidence: r.insufficientEvidence === true,
      warnings,
    },
  };
}

/** A place is renderable only if it carries at least one explicit evidence
 *  item. Inferred-only places are model guesses and are never rendered. */
export function hasExplicitEvidence(place: PlaceCandidateEvidence): boolean {
  return place.explicitEvidence.length > 0;
}

const ROLE_ORDER: Record<PlaceRole, number> = {
  primary: 0,
  secondary: 1,
  passing_mention: 2,
};

export type RenderedCaption = {
  title: string;
  description: string;
  /** How many places were actually rendered (0 → nothing verifiable). */
  renderedPlaces: number;
};

/**
 * The SINGLE source of truth for "which places may influence the outcome":
 * explicit-evidence, non-passing places in render order (primary first).
 * Secondary places are included only when the model flagged multiple
 * intentional places. Inferred-only places and passing mentions are always
 * dropped here — before anything reaches the resolver or the auto-save gate.
 */
export function selectRenderablePlaces(
  evidence: MediaPlaceEvidence,
): PlaceCandidateEvidence[] {
  if (evidence.insufficientEvidence) return [];
  return evidence.places
    .filter(hasExplicitEvidence)
    .filter((p) => p.role !== 'passing_mention')
    .filter((p) => p.role === 'primary' || evidence.multipleIntentionalPlaces)
    .sort((a, b) => {
      const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (r !== 0) return r;
      return b.confidence - a.confidence;
    });
}

/**
 * Render structured evidence into a synthetic post caption for
 * `extractEvidence`. Only explicit-evidence places are included; passing
 * mentions are always excluded; secondary places are included only when the
 * model flagged multiple intentional places. Fields are joined the way a
 * normal caption reads ("Name, 123 St, City, Region") so the existing
 * deterministic address/venue extractors pick them up unchanged.
 */
export function renderMediaEvidenceCaption(
  evidence: MediaPlaceEvidence,
): RenderedCaption {
  const renderable = selectRenderablePlaces(evidence);
  if (renderable.length === 0) {
    return { title: '', description: '', renderedPlaces: 0 };
  }

  const lines = renderable.map((p) =>
    [p.name, p.address, p.city, p.region, p.country]
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(', '),
  );

  const primary = renderable[0]!;
  return {
    title: primary.name,
    description: lines.join('\n'),
    renderedPlaces: renderable.length,
  };
}

// A street-address pattern (number + street type, incl. Spanish/French types
// the resolver already understands). Media auto-save requires a concretely
// shown/spoken street address — a name-only or city-only mention is never
// enough for a SILENT save (it can still become needs_help for confirmation).
const ADDRESS_LIKE_RE =
  /\b\d{1,6}\s+[^,]*\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place|cir|circle|plaza|sq|square|paseo|camino|calle|avenida|via|rue)\b/i;

export const DEFAULT_MEDIA_AUTOSAVE_MIN_CONFIDENCE = 0.7;

/**
 * Whether media evidence is strong enough to permit a SILENT auto-save. This is
 * an EXTRA gate ON TOP OF the resolver's `safeToAutoSave` — it can only make
 * media auto-save STRICTER, never looser. Because a video is a less reliable
 * source than an owner-written caption, we additionally require the primary
 * place to carry an EXPLICIT street address at high model confidence, and we
 * never silent-save multi-intentional content. Model coordinates and Place IDs
 * are never trusted (the schema has no Place ID; coordinates are dropped).
 *
 * Adversarial inputs (inferred-only, passing mentions, creator handles, dish /
 * product / cuisine names, city-as-context, low-confidence text) all fail this
 * gate because none of them carry an explicit high-confidence street address.
 */
export function mediaEvidenceAutoSaveEligible(
  evidence: MediaPlaceEvidence,
  minConfidence: number = DEFAULT_MEDIA_AUTOSAVE_MIN_CONFIDENCE,
): boolean {
  if (evidence.insufficientEvidence) return false;
  // Multiple intentional places are inherently a confirmation case.
  if (evidence.multipleIntentionalPlaces) return false;

  const primary = selectRenderablePlaces(evidence)[0];
  if (!primary) return false;
  if (!(primary.confidence >= minConfidence)) return false;

  // Require an EXPLICIT street address: both a populated address field AND an
  // explicit-evidence item that actually shows/speaks a street address.
  const addressInField = !!primary.address && ADDRESS_LIKE_RE.test(primary.address);
  const addressInExplicit = primary.explicitEvidence.some((e) => ADDRESS_LIKE_RE.test(e.value));
  return addressInField && addressInExplicit;
}

/** Small, size-bounded summary for diagnostics logging (no raw evidence). */
export function summarizeMediaEvidence(evidence: MediaPlaceEvidence): {
  placeCount: number;
  explicitPlaceCount: number;
  multiple: boolean;
  insufficient: boolean;
} {
  return {
    placeCount: evidence.places.length,
    explicitPlaceCount: evidence.places.filter(hasExplicitEvidence).length,
    multiple: evidence.multipleIntentionalPlaces,
    insufficient: evidence.insufficientEvidence,
  };
}
