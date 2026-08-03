// services/media-worker/src/prompts/placeEvidencePrompt.ts
//
// Versioned prompt for multimodal place-evidence extraction. The version is
// persisted into diagnostics so we can correlate evidence quality with prompt
// changes. Bump PROMPT_VERSION on any wording change.

export const PROMPT_VERSION = 'media-place-evidence-2026-08-03.v2';

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
- Every explicitEvidence value must be a short direct quotation or faithful
  transcription from the declared source. Do not restate an inference as
  caption, speech, visible_text, or frame evidence.
- Use source=caption only for caption_title/caption_text, source=speech only for
  transcript text, and source=frame or visible_text only for text or signage
  visibly present in a supplied timestamped frame.
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

Output STRICT JSON ONLY (no prose, no markdown) matching this shape:
{
  "places": [
    {
      "name": "",
      "category": "",
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
      "inferredEvidence": []
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
  metadataTitle?: string | null;
  metadataDescription?: string | null;
}): string {
  const parts: string[] = [`platform: ${input.platform}`];
  if (input.metadataTitle) parts.push(`caption_title: ${input.metadataTitle}`);
  if (input.metadataDescription) parts.push(`caption_text: ${input.metadataDescription}`);
  parts.push(`transcript:\n${input.transcriptText || '(none)'}`);
  parts.push(`visible_text:\n${input.ocrText || '(none)'}`);
  parts.push('Return ONLY the JSON object described above.');
  return parts.join('\n\n');
}
