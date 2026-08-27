// services/media-worker/src/vayrin/visualGeolocationPrompt.ts
//
// Versioned prompt + JSON schema for Vayrin visual geolocation. The version is
// persisted into diagnostics so hypothesis quality can be correlated with
// prompt changes. Bump VAYRIN_PROMPT_VERSION on any wording change.
//
// This prompt asks a DIFFERENT question from placeEvidencePrompt.ts, and the
// difference is the point of the whole feature:
//
//   placeEvidencePrompt — "what place did this post NAME?" It is deliberately
//     anti-speculative ("If you cannot find explicit evidence of a specific
//     place, set insufficientEvidence = true. Do not guess."), which is right
//     for the cheap default pass and is exactly why it returns nothing on a
//     video where the creator is hiding the spot.
//
//   this prompt — "what place do these frames SHOW?" Recognizing a coastline
//     from its geology is not guessing; it is reading evidence the other prompt
//     was told to ignore. The safety property is preserved elsewhere: a
//     hypothesis from here is still just a hypothesis, still gets verified
//     against Places, and still cannot silently save without passing the
//     existing `safeToAutoSave` and `mediaEvidenceAutoSaveEligible` gates.
//
// NO GROUND TRUTH IN THIS FILE. Test answers live in the harness fixtures, never
// in the production prompt — a prompt that has been shown the answer key cannot
// be measured.

export const VAYRIN_PROMPT_VERSION = 'vayrin-hypothesis-first-2026-08-27.v1';

export const VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT = `
You are a visual geolocation investigator. You are given timestamped frames
from one short social video, plus whatever text evidence accompanied the post.
Your job is to identify the REAL-WORLD PLACE the video shows, as specifically
as the evidence responsibly permits.

HYPOTHESIS-FIRST BOUNDARY
You are blind to Google Places candidates, provider rankings, candidate
addresses, cached machine identities, and prior shortlists. None are supplied.
First determine WHAT KIND OF PLACE the source depicts. Only then propose up to
three independently supported identities. A person, athlete, creator, activity,
or generic scene phrase is not a place identity.

WHAT COUNTS AS A PLACE
A place is anywhere a person could travel to: a restaurant, cafe, bar, hotel,
shop, museum, or venue; a beach, cliff, cove, trail, waterfall, viewpoint,
swimming hole, park, or island; a named landmark or monument. Informal and
unofficial spots count. A place does not need a business listing to be real.

LOCATION METADATA IS A PRIOR, NOT THE ANSWER
Any location tag, caption city, or profile city you are given is CONTEXT. It is
frequently coarse ON PURPOSE: creators routinely tag a whole metropolitan area
or island while deliberately withholding the actual spot. Treat it as a search
region that makes some hypotheses more plausible.

  - Do NOT simply repeat the metadata back as your answer. "Los Angeles" is not
    an answer to "where is this" when the frames show a specific cliff.
  - A hypothesis MORE SPECIFIC than the metadata is the desired outcome,
    provided it plausibly sits inside that region.
  - A hypothesis OUTSIDE the metadata region is allowed, but say so in
    conflicting_clues so it can be checked.
  - If the visual evidence genuinely supports nothing more specific than the
    metadata, say that honestly rather than inventing precision.

HOW TO INSPECT
Look at EVERY frame before answering. Read them for:
  - signage, storefront lettering, menus, price boards, licence plates,
    street signs, transit markings, posters, and any partially legible text
  - architecture, roofing, window and balcony style, construction materials
  - geology: rock type, strata, cliff and headland shape, sand colour, reef
  - vegetation and climate cues
  - coastline and beach geometry, islands and sea stacks on the horizon
  - mountain and skyline profiles
  - road markings, kerbs, barriers, guardrails, driving side, utility poles
  - interior design, tableware, uniforms, and plating for venues
  - crowd, dress, and language cues
Text you can actually read in a frame is the strongest single clue. Use it.

SPECIFICITY
Report the most specific level your evidence supports, using exactly one of:
  exact_location, venue, landmark, natural_feature, neighborhood, city, region,
  country.
Prefer the most specific CREDIBLE level. Do not climb to a specific level on a
single ambiguous frame, and do not retreat to "city" when a sign in frame names
the venue.

MULTIPLE PLACES
Social videos often show several distinct places: a hotel then a beach then a
restaurant, or five restaurants in a row. If the frames show different places,
set multiple_distinct_places_visible = true and describe each one in
additional_place_segments with the frame timestamps it occupies. Do NOT merge
distinct places into one answer, and do not split one place into several just
because the camera moved.

SOURCE GEOGRAPHY
Extract explicit source geography separately from visual inference. Explicit
caption, hashtag, location metadata, transcript, or OCR geography must constrain
hypotheses. Do not propose a cross-country identity without listing the conflict.
Weak vegetation, architecture, or climate guesses are not hard geography.

HONESTY
  - Separate what is DIRECTLY VISIBLE from what you INFERRED.
  - Give several hypotheses when you are genuinely uncertain, ordered
    best-first, each with its own confidence.
  - Never invent coordinates, addresses, street numbers, or business names you
    did not read or recognize.
  - Report anything that argues AGAINST your own hypothesis in
    conflicting_clues. A hypothesis with no stated conflicts had better
    genuinely have none.
  - Returning zero hypotheses is a valid, useful answer when the frames carry
    no geographic signal at all.
  - Set no_exact_hypothesis=true when only a truthful region/category/activity
    result is defensible. Do not force a POI to avoid an empty hypothesis list.

IDENTITY EVIDENCE BASIS
For every hypothesis classify evidence_basis using exactly one value:
  - direct_visible_identity: readable name/sign/address or another direct
    visual identifier in the supplied frames.
  - distinctive_visual_match: independently distinctive observable geography,
    architecture, skyline, or spatial configuration supports the identity.
  - contextual_or_memory_prior: the identity mainly comes from recognizing a
    famous/viral clip, title, dialogue, caption, metadata, or general model
    memory; the supplied pixels do not independently distinguish the place.
  - insufficient: the observations do not responsibly support this identity.
Do not call viral-clip familiarity a visual clue. Put it in reasoning_summary
and use contextual_or_memory_prior. A contextual prior can be a lead, never
observable proof.

reasoning_summary must be a short statement of the OBSERVABLE evidence that led
to the hypothesis — for example "layered sandstone cliff over a flat wave-cut
platform, graffiti on collapsed concrete slabs, Pacific horizon". Do not
describe your thought process, and do not output hidden reasoning.

Return only the structured object requested.
`.trim();

/**
 * Candidate verification is intentionally a smaller task than open-ended
 * geolocation. Keeping its instructions and schema separate avoids paying for
 * unused hypothesis/segment fields on every shortlisted candidate call.
 */
export const VAYRIN_CANDIDATE_VERIFICATION_SYSTEM_PROMPT = `
You verify a supplied shortlist of real-world places against timestamped video
frames and text context. Evaluate EVERY candidateId exactly once.

For each candidate return at most three short, non-duplicate OBSERVATIONAL
evidence claims. Do not repeat supplied retrieval rank or retrieval evidence;
Nearr records that deterministically. Classify each claim SUPPORTS,
CONTRADICTS, or UNKNOWN.

"Not visible" defaults to UNKNOWN. Missing landmarks, waterfalls, enclosures,
facades, mountains, beaches, or skylines may be behind the camera, cropped,
occluded, distant, seasonal, poorly lit, or outside the selected frames. They
CONTRADICT only when the observed viewpoint necessarily would show them and
visible identity or geometry is genuinely incompatible. Never invent a camera
position. Weather, season, lighting, drone/ground angle, partial occlusion, and
viewpoint differences are UNKNOWN.

Use strong CONTRADICTS only for a directly visible identity_conflict,
geographic_conflict, or impossible_geometry. Preserve SUPPORTS + UNKNOWN and
credible UNKNOWN-only retrievals. Weak generic model opinion cannot override
strong retrieval evidence.

Only propose an outside place if every shortlist candidate is weak or every
candidate has strong direct contradiction. Otherwise return no outside
proposal. Return only the requested structured object; reasonCode must be a
short machine-readable label, not prose.
`.trim();

/**
 * Structured Outputs schema. Strict mode requires `additionalProperties:false`
 * and every property listed in `required` — optional-by-nullability, never
 * optional-by-absence, which is why nullable fields are typed as unions.
 */
export const VAYRIN_GEOLOCATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'scene_category',
    'activity',
    'source_geography',
    'identity_clues',
    'no_exact_hypothesis',
    'place_hypotheses',
    'multiple_distinct_places_visible',
    'additional_place_segments',
    'metadata_was_sufficient',
    'retrieved_candidate_evaluations',
    'outside_candidate_proposals',
  ],
  properties: {
    scene_category: {
      type: 'string',
      description: 'Candidate-independent kind of scene/place shown, established before exact identity.',
    },
    activity: { type: ['string', 'null'] },
    source_geography: {
      type: 'object',
      additionalProperties: false,
      required: ['country', 'region', 'city', 'confidence_class', 'evidence_provenance'],
      properties: {
        country: { type: ['string', 'null'] },
        region: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        confidence_class: {
          type: 'string',
          enum: ['explicit_source_geo', 'strong_inferred_geo', 'weak_inferred_geo', 'none'],
        },
        evidence_provenance: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'source_location_metadata', 'source_caption', 'source_hashtags',
              'source_transcript', 'source_ocr', 'source_visual',
            ],
          },
        },
      },
    },
    identity_clues: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clue', 'kind', 'provenance', 'strength'],
        properties: {
          clue: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['exact_visible_name', 'alias', 'natural_feature', 'architectural', 'geological', 'activity', 'other'],
          },
          provenance: {
            type: 'string',
            enum: [
              'source_location_metadata', 'source_caption', 'source_hashtags',
              'source_transcript', 'source_ocr', 'source_visual',
            ],
          },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        },
      },
    },
    no_exact_hypothesis: { type: 'boolean' },
    place_hypotheses: {
      type: 'array',
      maxItems: 3,
      description: 'Hypotheses for the PRIMARY place, best first. Empty when the frames carry no geographic signal.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'place_type',
          'city',
          'region',
          'country',
          'specificity',
          'confidence',
          'reasoning_summary',
          'supporting_visual_clues',
          'supporting_textual_clues',
          'conflicting_clues',
          'needs_external_verification',
          'evidence_basis',
        ],
        properties: {
          name: { type: 'string', description: 'The most specific credible name. Empty string if only an area is known.' },
          place_type: { type: 'string', description: 'Free-text kind of place, e.g. "beach", "taqueria", "sea cliff".' },
          city: { type: ['string', 'null'] },
          region: { type: ['string', 'null'] },
          country: { type: ['string', 'null'] },
          specificity: {
            type: 'string',
            enum: [
              'exact_location',
              'venue',
              'landmark',
              'natural_feature',
              'neighborhood',
              'city',
              'region',
              'country',
            ],
          },
          confidence: { type: 'number', description: '0..1 confidence in THIS hypothesis.' },
          reasoning_summary: { type: 'string', description: 'Observable evidence only. Not a thought process.' },
          supporting_visual_clues: { type: 'array', items: { type: 'string' } },
          supporting_textual_clues: { type: 'array', items: { type: 'string' } },
          conflicting_clues: { type: 'array', items: { type: 'string' } },
          needs_external_verification: { type: 'boolean' },
          evidence_basis: {
            type: 'string',
            enum: [
              'direct_visible_identity',
              'distinctive_visual_match',
              'contextual_or_memory_prior',
              'insufficient',
            ],
          },
        },
      },
    },
    multiple_distinct_places_visible: { type: 'boolean' },
    additional_place_segments: {
      type: 'array',
      description: 'One entry per ADDITIONAL distinct place beyond the primary one.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['frame_timestamps_seconds', 'hypotheses'],
        properties: {
          frame_timestamps_seconds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Timestamps of the frames showing this place.',
          },
          hypotheses: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'name',
                'place_type',
                'city',
                'region',
                'country',
                'specificity',
                'confidence',
                'reasoning_summary',
                'supporting_visual_clues',
                'supporting_textual_clues',
                'conflicting_clues',
                'needs_external_verification',
                'evidence_basis',
              ],
              properties: {
                name: { type: 'string' },
                place_type: { type: 'string' },
                city: { type: ['string', 'null'] },
                region: { type: ['string', 'null'] },
                country: { type: ['string', 'null'] },
                specificity: {
                  type: 'string',
                  enum: [
                    'exact_location',
                    'venue',
                    'landmark',
                    'natural_feature',
                    'neighborhood',
                    'city',
                    'region',
                    'country',
                  ],
                },
                confidence: { type: 'number' },
                reasoning_summary: { type: 'string' },
                supporting_visual_clues: { type: 'array', items: { type: 'string' } },
                supporting_textual_clues: { type: 'array', items: { type: 'string' } },
                conflicting_clues: { type: 'array', items: { type: 'string' } },
                needs_external_verification: { type: 'boolean' },
                evidence_basis: {
                  type: 'string',
                  enum: [
                    'direct_visible_identity',
                    'distinctive_visual_match',
                    'contextual_or_memory_prior',
                    'insufficient',
                  ],
                },
              },
            },
          },
        },
      },
    },
    metadata_was_sufficient: {
      type: 'boolean',
      description: 'True only when the supplied metadata already named the specific place shown.',
    },
    retrieved_candidate_evaluations: {
      type: 'array',
      description: 'Exactly one structured evaluation for every supplied candidateId.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidateId',
          'evidence',
          'visualCompatibility',
          'regionCompatibility',
          'overallVerdict',
          'reasonCode',
        ],
        properties: {
          candidateId: { type: 'string' },
          evidence: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['statement', 'state', 'basis', 'strength', 'visibility', 'contradictionKind'],
              properties: {
                statement: { type: 'string' },
                state: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'UNKNOWN'] },
                basis: { type: 'string', enum: ['visual', 'textual', 'region', 'canonical_identity', 'retrieval'] },
                strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
                visibility: { type: 'string', enum: ['visible', 'necessarily_visible', 'not_visible', 'unknown'] },
                contradictionKind: {
                  type: 'string',
                  enum: [
                    'identity_conflict',
                    'geographic_conflict',
                    'impossible_geometry',
                    'visible_feature_conflict',
                    'expected_feature_absent',
                    'viewpoint_uncertain',
                    'appearance_variation',
                    'none',
                  ],
                },
              },
            },
          },
          visualCompatibility: { type: 'string', enum: ['strong', 'moderate', 'weak', 'unknown'] },
          regionCompatibility: { type: 'string', enum: ['strong', 'moderate', 'weak', 'unknown'] },
          overallVerdict: { type: 'string', enum: ['promote', 'preserve', 'demote', 'reject'] },
          reasonCode: { type: 'string' },
        },
      },
    },
    outside_candidate_proposals: {
      type: 'array',
      maxItems: 2,
      description: 'Allowed only after every retrieved candidate is weak or directly contradicted.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['placeName', 'supportingEvidence', 'contradictingEvidence'],
        properties: {
          placeName: { type: 'string' },
          supportingEvidence: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          contradictingEvidence: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        },
      },
    },
  },
} as const;

export const VAYRIN_CANDIDATE_VERIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['retrieved_candidate_evaluations', 'outside_candidate_proposals'],
  properties: {
    retrieved_candidate_evaluations: {
      type: 'array',
      description: 'Exactly one evaluation for every supplied candidateId.',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidateId',
          'evidence',
          'visualCompatibility',
          'regionCompatibility',
          'overallVerdict',
          'reasonCode',
        ],
        properties: {
          candidateId: { type: 'string' },
          evidence: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['statement', 'state', 'basis', 'strength', 'visibility', 'contradictionKind'],
              properties: {
                statement: { type: 'string', maxLength: 160 },
                state: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'UNKNOWN'] },
                basis: { type: 'string', enum: ['visual', 'textual', 'region', 'canonical_identity'] },
                strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
                visibility: { type: 'string', enum: ['visible', 'necessarily_visible', 'not_visible', 'unknown'] },
                contradictionKind: {
                  type: 'string',
                  enum: [
                    'identity_conflict',
                    'geographic_conflict',
                    'impossible_geometry',
                    'visible_feature_conflict',
                    'expected_feature_absent',
                    'viewpoint_uncertain',
                    'appearance_variation',
                    'none',
                  ],
                },
              },
            },
          },
          visualCompatibility: { type: 'string', enum: ['strong', 'moderate', 'weak', 'unknown'] },
          regionCompatibility: { type: 'string', enum: ['strong', 'moderate', 'weak', 'unknown'] },
          overallVerdict: { type: 'string', enum: ['promote', 'preserve', 'demote', 'reject'] },
          reasonCode: { type: 'string', maxLength: 80 },
        },
      },
    },
    outside_candidate_proposals: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['placeName', 'supportingEvidence', 'contradictingEvidence'],
        properties: {
          placeName: { type: 'string', maxLength: 120 },
          supportingEvidence: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 2 },
          contradictingEvidence: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 2 },
        },
      },
    },
  },
} as const;

export type VayrinTextContext = {
  platform?: string | null;
  durationSeconds?: number | null;
  sourceCreatorHandle?: string | null;
  sourceCreatorName?: string | null;
  caption?: string | null;
  transcript?: string | null;
  /** The platform's location tag / metadata, verbatim. */
  locationMetadata?: string | null;
  visibleText?: string | null;
  otherText?: string | null;
  /** Bounded machine-generated shortlist. */
  retrievedCandidatesJson?: string | null;
  /** True only when a SEPARATE OCR pass ran. See placeEvidencePrompt.ts for why
   *  this distinction matters: an empty OCR result must never be presented as
   *  "there is no visible text" when nothing has looked yet. */
  visibleTextExtracted?: boolean;
};

/** Build the text half of the request. Frames are attached separately. */
export function buildVayrinUserContext(ctx: VayrinTextContext): string {
  const parts: string[] = [];
  if (ctx.platform) parts.push(`platform: ${ctx.platform}`);
  if (typeof ctx.durationSeconds === 'number' && Number.isFinite(ctx.durationSeconds)) {
    parts.push(`video_duration_seconds: ${Math.max(0, ctx.durationSeconds).toFixed(1)}`);
  }
  if (ctx.sourceCreatorHandle || ctx.sourceCreatorName) {
    parts.push(`source_creator_provenance (a person/account, NEVER a place identity): ${[
      ctx.sourceCreatorHandle,
      ctx.sourceCreatorName,
    ].filter(Boolean).join(' / ')}`);
  }

  parts.push(
    ctx.locationMetadata
      ? `location_metadata (A PRIOR, possibly deliberately coarse — do not simply repeat it):\n${ctx.locationMetadata}`
      : 'location_metadata: (none supplied)',
  );

  parts.push(`caption:\n${ctx.caption?.trim() || '(none)'}`);
  parts.push(`transcript:\n${ctx.transcript?.trim() || '(none)'}`);

  if (ctx.visibleText?.trim()) {
    parts.push(`visible_text (from a separate OCR pass):\n${ctx.visibleText.trim()}`);
  } else if (ctx.visibleTextExtracted) {
    parts.push('visible_text: (an OCR pass ran and found none)');
  } else {
    parts.push(
      'visible_text: not separately extracted — read any signage or text directly from the frames',
    );
  }

  if (ctx.otherText?.trim()) parts.push(`other_textual_evidence:\n${ctx.otherText.trim()}`);

  parts.push(
    ctx.retrievedCandidatesJson?.trim()
      ? `retrieved_places_candidates (verification-only legacy tool; never used by the hypothesis-first hard path):\n${ctx.retrievedCandidatesJson.trim()}`
      : 'places_candidates: deliberately withheld for independent hypothesis generation',
  );

  parts.push(
    'The frames follow in chronological order, each preceded by its timestamp in seconds.',
  );
  return parts.join('\n\n');
}
