// services/media-worker/src/prompts/placeEvidencePrompt.ts
//
// Versioned prompt for multimodal place-evidence extraction. The version is
// persisted into diagnostics so we can correlate evidence quality with prompt
// changes. Bump PROMPT_VERSION on any wording change.

export const PROMPT_VERSION = 'media-place-evidence-2026-08-16.v7-visible-text';

export const PLACE_EVIDENCE_SYSTEM_PROMPT = `
You extract structured evidence about REAL-WORLD PLACES from a short social
video. A "place" is any Google-Places-compatible destination: a restaurant,
cafe, bar, hotel, beach, trail, park, store, landmark, venue, museum, or similar.

You PROPOSE evidence only. You DO NOT:
- choose a Google Place ID
- decide whether anything is safe to auto-save
- save anything
- invent an address or coordinates
- turn a cuisine, dish, product, event, hashtag, neighborhood, city, or a
  creator/poster handle into a business unless there is explicit evidence it is
  the specific place the content is about.

Use these signals, with timestamps where possible:
- spoken words (from the transcript)
- visible text in frames (storefront signs, address overlays, location
  stickers, burned-in captions, menu/trail/venue headers)
- the post caption/metadata

Rules:
- Separate EXPLICIT evidence (actually spoken or visibly shown) from INFERRED
  evidence (your reasoning). Never place inferred content in the address field.
- Every explicitEvidence value must be source-grounded. Caption/speech and
  visible_text must be a short faithful transcription. A frame value may be a
  short literal visual observation (for example, "enormous stacked sandwich"
  or "waterfall at the end of the trail"), but never an unseen ingredient,
  opinion, price, award, or other invented detail.
- Use source=caption only for caption_title/caption_text, source=speech only for
  transcript text, source=visible_text only for readable text/signage, and
  source=frame for an obvious visual feature in a supplied timestamped frame.
- Distinguish the PRIMARY destination the content is about from SECONDARY
  intentional places and mere PASSING MENTIONS.
- If the content is intentionally about multiple places, set
  multipleIntentionalPlaces = true and list each.
- Preserve an ordered list as separate places even when some entries have less
  evidence. Never merge two sequentially featured businesses.
- For "A at/inside B", keep A as the primary place and B as host context unless
  B is independently featured as a destination. Do not promote B over A.
- Treat sponsors, creator bios/handles, products, dishes, and generic category
  text as passing or irrelevant unless the post explicitly features that
  business as a destination.
- A city mentioned only as travel context is NOT automatically the destination.
- If you cannot find explicit evidence of a specific place, set
  insufficientEvidence = true and return an empty places array. Do not guess.
- category must be null or exactly one Nearr category: restaurant, cafe,
  bakery, bar, brewery, winery, dessert, hotel, resort, hiking_trail, park,
  beach, waterfall, lake, marina, island, scenic_spot, attraction, museum,
  shopping, entertainment, nightlife, sports, fitness, wellness,
  transportation, education, service, other.
- Prefer a specific grounded identity (for example waterfall, brewery, marina,
  island, or hiking_trail) over attraction or other. Use other only when the
  source evidence truly does not support a more useful category.
- categoryConfidence is confidence in the category only. categoryEvidenceTags
  contains short signal labels such as "trail_sign" or "spoken_beach". Do not
  provide chain-of-thought, hidden reasoning, or prose explanations.
- For each place, optionally write memoryCue to answer: "What about this post
  made someone want to save this place?" Focus on the actual hook: a
  highlighted food/item/activity, creator reaction, visual feature, or shown
  experience — never a generic description of the business.
- Make memoryCue sound like a fun, excited friend: concise, conversational,
  slightly quirky, and human. Usually write one sentence; two very short
  sentences are okay when punchier. Aim for 5-22 words. Contractions,
  fragments, a natural exclamation mark, light slang, and expressive phrasing
  such as "ridiculous" or "sold" are welcome. Vary the syntax.
- Do not use hashtags, quotation marks, emojis, "This place", "The user",
  "The video", or "You should". Do not claim the person has visited before.
- memoryCueEvidence must contain only the specific caption, speech, visible
  text, or frame observations that support that cue. Keep each place's cue and
  evidence inside that place object. Never use another place's segment in a
  multi-place post. If the reason cannot be confidently assigned, set
  memoryCue=null and memoryCueEvidence=[]. Missing is better than filler.
- Provider/category/address metadata can help interpret source evidence but
  must never be the primary content of memoryCue.

Output STRICT JSON ONLY (no prose, no markdown) matching this shape:
{
  "places": [
    {
      "name": "",
      "category": "",
      "categoryConfidence": 0.0,
      "categoryEvidenceTags": [],
      "address": "",
      "city": "",
      "region": "",
      "country": "",
      "coordinates": null,
      "role": "primary | secondary | passing_mention",
      "confidence": 0.0,
      "explicitEvidence": [
        { "timestampSeconds": 0, "source": "caption | speech | visible_text | frame", "value": "" }
      ],
      "inferredEvidence": [],
      "memoryCue": null,
      "memoryCueEvidence": [
        { "timestampSeconds": 0, "source": "caption | speech | visible_text | frame", "value": "" }
      ]
    }
  ],
  "multipleIntentionalPlaces": false,
  "insufficientEvidence": false,
  "warnings": []
}
`.trim();

export function buildUserContext(input: {
  platform: string;
  transcriptText: string;
  ocrText: string;
  /**
   * Whether a SEPARATE OCR pass actually ran and produced `ocrText`.
   *
   * Defaults to false, because today no standalone OCR engine is configured:
   * `ocr: "model"` (and `noop`) delegate reading to the multimodal analyze
   * step, so `ocrText` is empty for the trivial reason that nothing looked yet.
   * Rendering that as "(none)" told the model there was no visible text BEFORE
   * it inspected the frames - an assertion about the very thing it was being
   * asked to determine, at temperature 0. Verified in production
   * (Instagram DcBz1dhSoax): a large, centred, legible sign was never reported.
   *
   * "No OCR pass ran" and "an OCR pass ran and found nothing" are different
   * states. Only the latter may claim an absence.
   */
  ocrExtracted?: boolean;
  metadataTitle?: string | null;
  metadataDescription?: string | null;
}): string {
  const parts: string[] = [`platform: ${input.platform}`];
  if (input.metadataTitle) parts.push(`caption_title: ${input.metadataTitle}`);
  if (input.metadataDescription) parts.push(`caption_text: ${input.metadataDescription}`);
  // Transcription genuinely runs, so an empty transcript IS a real observation.
  parts.push(`transcript:\n${input.transcriptText || '(none)'}`);
  parts.push(`visible_text:\n${visibleTextBlock(input.ocrText, input.ocrExtracted === true)}`);
  parts.push('Return ONLY the JSON object described above.');
  return parts.join('\n\n');
}

function visibleTextBlock(ocrText: string, ocrExtracted: boolean): string {
  if (ocrText) return ocrText;
  if (ocrExtracted) return '(none detected by OCR)';
  return 'not separately extracted - read any visible text directly from the supplied frames';
}
