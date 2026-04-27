/**
 * AI-based place extraction layer (server-side / Node only).
 *
 * Purpose:
 *   Given messy social media metadata (TikTok / Instagram / generic OG tags),
 *   ask Gemini to identify the SINGLE real-world business or place being
 *   referenced, ignoring creator names, captions, and hashtags. Returns a
 *   normalized search query plus a confidence rating that downstream code
 *   (e.g. Google Places text search) can act on.
 *
 * Architectural rules (do not violate):
 *   - This module MUST NOT be imported into React Native UI / client code.
 *     It is intended to run from a trusted server context (Supabase Edge
 *     Function, Node script, server route) where process.env.GEMINI_API_KEY
 *     is available. The Gemini key must NEVER ship in the mobile bundle.
 *   - This module MUST NOT throw. All failures degrade gracefully to the
 *     caller-provided fallbackQuery with confidence: "low".
 *   - This module is additive. It does not replace the existing local
 *     heuristic in lib/placeExtractor.ts. Callers can use the heuristic
 *     result as the fallbackQuery.
 *
 * Logging:
 *   Every critical step logs with a `[aiExtractPlace]` prefix so failures
 *   are visible in server logs without exposing secrets.
 */

export type AIExtractInput = {
  sourceType?: string;
  url?: string;
  title?: string;
  description?: string;
  fallbackQuery?: string;
  /**
   * Optional video transcript (audio -> text) for the shared post. When
   * present, the AI prompt should treat it as a HIGH-PRIORITY signal:
   * captions often omit the venue name ("this place SLAPS") while the
   * audio explicitly says it ("we're at Tacos Los Chulos"). Production
   * transcripts come from a server-side provider (see lib/transcription).
   */
  transcript?: string;
};

export type AIExtractConfidence = 'high' | 'medium' | 'low';

export type AIExtractResult = {
  query: string;
  confidence: AIExtractConfidence;
  reason: string;
  candidates?: string[];
};

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const LOG = '[aiExtractPlace]';

/**
 * Build the LLM prompt. We force STRICT JSON output and explicitly tell the
 * model what to ignore (creator handles, captions, hashtags) so it focuses
 * on the actual venue.
 */
function buildPrompt(input: AIExtractInput): string {
  const lines = [
    'You are a place-extraction assistant for a maps app.',
    'Given social media share metadata, identify the SINGLE real-world business or place being referenced.',
    '',
    'CRITICAL: distinguish between the BUSINESS NAME (what to save) and LOCATION CONTEXT (city / neighborhood / address / state).',
    'A neighborhood like "Highland Park" or "Sawtelle Japantown" is NEVER the answer by itself when an actual business is also mentioned.',
    '',
    'Priority for picking the business name (use the FIRST that applies):',
    '  1. A tagged business handle in the caption (e.g. @villastacoslosangeles, @lecoupe_friedchicken).',
    '     Convert the handle into readable words: @villastacoslosangeles -> "Villa\'s Tacos".',
    '  2. A business name written in the caption text immediately near the handle (e.g. "Villa\'s Tacos was no joke").',
    '  3. A clearly named restaurant / cafe / shop / venue in the caption.',
    '  4. ONLY if no business name can be found, fall back to the most specific location.',
    '',
    'Rules:',
    '  - If a TRANSCRIPT is provided, treat it as a HIGH-PRIORITY signal. Spoken phrases like',
    '      "we\'re at ___", "we went to ___", "this place is called ___", "today we\'re trying ___",',
    '      "welcome to ___", "I\'m at ___"  almost always reveal the actual venue name. Use the spoken',
    '      name PLUS any city/neighborhood from the caption/description for the final query.',
    '      Example transcript: "We\'re at Tacos Los Chulos." + caption mentions Los Angeles ->',
    '      query "Tacos Los Chulos Los Angeles".',
    '  - IGNORE creator / influencer handles, channel names, captions framing ("X on Instagram"), emojis, and hashtags.',
    '  - Prefer tagged BUSINESS handles over creator handles. Creator handles are usually the post author (the "X on Instagram" prefix); business handles appear inside the caption text.',
    '  - When you find a business name AND a location, return them combined: "<Business Name> <Neighborhood or City>".',
    '  - Pin emojis (\ud83d\udccd) usually mark LOCATION CONTEXT, not the venue name. Use the pin\'s text as the location half of the query, not as the whole answer.',
    '  - Never return JUST a neighborhood, city, state, address, or market name (e.g. "Highland Park", "Los Angeles", "Grand Central Market", "CA") when the post mentions a specific business.',
    '  - If you cannot confidently identify a specific business, set confidence to "low" and return your best guess.',
    '',
    'Examples (input -> output):',
    '',
    'Input title: "huANGRYfoodie on Instagram: @villastacoslosangeles Villa\u2019s Tacos was no joke"',
    'Input description: "\ud83d\udccd Highland Park, Los Angeles, CA also a location in Grand Central Market #tacos"',
    'Output: {"query": "Villa\'s Tacos Highland Park Los Angeles", "confidence": "high", "reason": "Tagged business handle @villastacoslosangeles plus business name Villa\'s Tacos; Highland Park used as location context only", "candidates": ["Villa\'s Tacos Highland Park", "Villa\'s Tacos Grand Central Market"]}',
    '',
    'Input title: "Jack\'s Dining Room on Instagram: amazing chicken sandwich"',
    'Input description: "@lecoupe_friedchicken, Los Angeles"',
    'Output: {"query": "Le Coupe Fried Chicken Los Angeles", "confidence": "high", "reason": "Tagged business handle plus city; creator name ignored", "candidates": []}',
    '',
    'Input title: "morning thoughts \u2615\ufe0f"',
    'Input description: "just vibing with my dog"',
    'Output: {"query": "", "confidence": "low", "reason": "No business or place referenced", "candidates": []}',
    '',
    'Return STRICT JSON ONLY (no markdown, no commentary) in this exact shape:',
    '{"query": string, "confidence": "high" | "medium" | "low", "reason": string, "candidates": string[]}',
    '',
    'Input metadata:',
    `sourceType: ${input.sourceType ?? ''}`,
    `url: ${input.url ?? ''}`,
    `title: ${input.title ?? ''}`,
    `description: ${input.description ?? ''}`,
    `transcript: ${input.transcript ?? ''}`,
    `fallbackQuery: ${input.fallbackQuery ?? ''}`,
  ];
  return lines.join('\n');
}

/**
 * Local heuristic that pulls a venue name out of a transcript using common
 * spoken-introduction patterns. Used as a no-LLM fallback so the eval
 * harness still benefits from transcripts even when GEMINI_API_KEY is not
 * configured. Returns null when nothing matches. Never throws.
 */
export function extractVenueFromTranscript(
  transcript: string | null | undefined,
): string | null {
  if (!transcript || typeof transcript !== 'string') return null;
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Order matters: more specific patterns first.
  const patterns: RegExp[] = [
    /\bthis place is called\s+([^.,!?\n]{2,80})/i,
    /\btoday we(?:'re| are)\s+(?:trying|at|visiting)\s+([^.,!?\n]{2,80})/i,
    /\bwelcome to\s+([^.,!?\n]{2,80})/i,
    /\bwe(?:'re| are)\s+at\s+([^.,!?\n]{2,80})/i,
    /\bwe went to\s+([^.,!?\n]{2,80})/i,
    /\bI(?:'m| am)\s+at\s+([^.,!?\n]{2,80})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1]
        .replace(/^the\s+/i, '')
        .replace(/["'`\u201C\u201D]/g, '')
        .trim();
      if (name.length >= 2) return name;
    }
  }
  return null;
}

/**
 * Build a guaranteed-valid fallback result. Never throws.
 */
function buildFallback(
  input: AIExtractInput,
  reason: string,
): AIExtractResult {
  // When Gemini is unavailable, try the transcript heuristic first — a
  // spoken "we're at X" is usually a stronger signal than a noisy caption.
  const fromTranscript = extractVenueFromTranscript(input.transcript);
  const query =
    (fromTranscript && fromTranscript.trim()) ||
    (input.fallbackQuery && input.fallbackQuery.trim()) ||
    (input.title && input.title.trim()) ||
    '';
  return {
    query,
    confidence: fromTranscript ? 'medium' : 'low',
    reason: fromTranscript ? `${reason}; used transcript heuristic` : reason,
  };
}

/**
 * Extract the first balanced JSON object substring from a string. Gemini
 * occasionally wraps JSON in ```json fences or trailing prose despite
 * instructions; this is defensive.
 */
function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Validate a parsed object loosely matches the AIExtractResult shape.
 */
function coerceResult(parsed: unknown): AIExtractResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const query = typeof obj.query === 'string' ? obj.query.trim() : '';
  if (!query) return null;
  const confRaw = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : '';
  const confidence: AIExtractConfidence =
    confRaw === 'high' || confRaw === 'medium' || confRaw === 'low'
      ? (confRaw as AIExtractConfidence)
      : 'low';
  const reason = typeof obj.reason === 'string' ? obj.reason : '';
  let candidates: string[] | undefined;
  if (Array.isArray(obj.candidates)) {
    candidates = obj.candidates.filter((c): c is string => typeof c === 'string');
  }
  return { query, confidence, reason, candidates };
}

/**
 * Main entry point. Never throws.
 */
export async function extractPlaceAI(
  input: AIExtractInput,
): Promise<AIExtractResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log(`${LOG} GEMINI_API_KEY missing -- falling back to heuristic query`);
    return buildFallback(input, 'GEMINI_API_KEY not configured');
  }

  const prompt = buildPrompt(input);
  console.log(`${LOG} calling Gemini for sourceType=${input.sourceType ?? 'unknown'}`);

  let responseText: string;
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) {
      console.log(`${LOG} Gemini HTTP ${res.status} -- fallback`);
      return buildFallback(input, `Gemini HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      .candidates;
    const text = candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      console.log(`${LOG} Gemini returned no text -- fallback`);
      return buildFallback(input, 'Gemini returned empty response');
    }
    responseText = text;
  } catch (err) {
    console.log(`${LOG} Gemini fetch failed:`, err);
    return buildFallback(input, 'Network or fetch error calling Gemini');
  }

  const jsonStr = extractJsonObject(responseText) ?? responseText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.log(`${LOG} Gemini response was not valid JSON -- fallback`);
    return buildFallback(input, 'Gemini returned invalid JSON');
  }

  const result = coerceResult(parsed);
  if (!result) {
    console.log(`${LOG} Gemini JSON missing required fields -- fallback`);
    return buildFallback(input, 'Gemini JSON missing required fields');
  }

  console.log(
    `${LOG} success query="${result.query}" confidence=${result.confidence}`,
  );
  return result;
}

/**
 * Convenience predicate for callers that only want to act on confident
 * results (e.g. auto-create a saved place vs. show a confirmation prompt).
 */
export function isHighConfidence(result: AIExtractResult): boolean {
  return result.confidence === 'high';
}
