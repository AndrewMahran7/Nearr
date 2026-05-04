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
  // ---- Structured evidence (v2). All optional for backward compat. ----
  /** The actual restaurant/place name the AI believes is the answer. */
  placeName?: string | null;
  /** Street address if explicitly present in caption / description / bio. */
  address?: string | null;
  /** City, neighborhood, or other locality referenced in source text. */
  city?: string | null;
  /** US state abbreviation when present. */
  state?: string | null;
  /** restaurant | influencer | unknown. "restaurant" requires bio evidence. */
  posterType?: 'restaurant' | 'influencer' | 'unknown';
  /** Tagged restaurant accounts that the AI corroborated. */
  taggedAccounts?: string[];
  /** True when the AI believes the user must confirm before saving. */
  needsUserConfirmation?: boolean;
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
    'You are a place-extraction assistant for a maps app called Nearr.',
    'Identify the PRIMARY real-world restaurant or place that the post is about.',
    'Wrong silent saves are worse than asking the user. When unsure, set needs_user_confirmation=true.',
    '',
    'EVIDENCE PRIORITY (highest to lowest). Use the FIRST that applies:',
    '  1. A street ADDRESS in the caption / description (e.g. "7 Carmine St, New York").',
    '  2. An explicit RESTAURANT / PLACE NAME written out in the caption text.',
    '  3. An explicit place name plus a CITY / STATE / neighborhood.',
    '  4. A POSTER profile that looks like a restaurant\'s own account (display name + bio confirms a real venue).',
    '  5. A TAGGED restaurant account that the caption clearly identifies as the venue.',
    '  6. A TRANSCRIPT line like "we\'re at ___" / "welcome to ___" / "this place is called ___".',
    '  7. Otherwise: no answer. Return placeName=null and needs_user_confirmation=true.',
    '',
    'CRITICAL @ HANDLE RULE:',
    '  Handles are EVIDENCE, not truth. Do NOT make a restaurant decision SOLELY from words after @.',
    '  Never invent a restaurant name from handle text alone. A handle helps only when corroborated by:',
    '    - the poster account looks like the restaurant itself (display name + bio match), OR',
    '    - the caption text near the handle names the venue (e.g. "@villastacos Villa\'s Tacos was no joke"), OR',
    '    - the bio classifies as a real business with an address or city.',
    '  Examples of handles you must NOT silently turn into restaurant names without corroboration:',
    '    @marysdiner, @nycfoodking, @madyolkskitchen, @joespizzanyc',
    '',
    'INFLUENCER / CREATOR RULE:',
    '  If the poster looks like a food blogger, reviewer, repost page, or media account',
    '  (handle contains "eats", "foodie", "hungry", "bites"; or display name says "Food Critic", "Eater LA", etc.):',
    '    - posterType MUST be "influencer".',
    '    - DO NOT treat the poster handle / display name as the restaurant.',
    '    - Use caption text, address, or tagged restaurant accounts instead.',
    '    - If no restaurant evidence exists, set needs_user_confirmation=true.',
    '',
    'ADDRESS RULE:',
    '  If an address exists, it is the strongest signal. Return it in the address field.',
    '  The query MUST include the address. The candidate must be at/near that address — never override an address with device location.',
    '',
    'POSTER TYPE:',
    '  posterType="restaurant" only when the poster account itself is a single physical venue (display name + caption tone match a real restaurant).',
    '  posterType="influencer" for reviewers, food bloggers, repost pages, media brands.',
    '  posterType="unknown" otherwise.',
    '',
    'OUTPUT (STRICT JSON, no markdown):',
    '{',
    '  "placeName": string | null,        // the actual restaurant/place name, or null',
    '  "address": string | null,          // street address from caption/bio, or null',
    '  "city": string | null,             // city or neighborhood, or null',
    '  "state": string | null,            // 2-letter US state, or null',
    '  "posterType": "restaurant" | "influencer" | "unknown",',
    '  "taggedAccounts": string[],        // tagged restaurant @handles you used as evidence',
    '  "query": string,                   // Places query: place name + address-or-city',
    '  "confidence": "high" | "medium" | "low",',
    '  "needsUserConfirmation": boolean,  // true unless evidence is corroborated',
    '  "reason": string                   // one short sentence',
    '}',
    '',
    'EXAMPLES:',
    '',
    'Input title: "hidden gem in nyc"',
    'Input description: "Joe\'s Pizza 7 Carmine St New York — still the best slice. #pizza #nyc"',
    'Output: {"placeName":"Joe\'s Pizza","address":"7 Carmine St","city":"New York","state":"NY","posterType":"unknown","taggedAccounts":[],"query":"Joe\'s Pizza 7 Carmine St New York","confidence":"high","needsUserConfirmation":false,"reason":"Address + name in caption"}',
    '',
    'Input title: "Sarah Eats LA on TikTok: you HAVE to try this taco spot"',
    'Input description: "@guerrilla_tacos slaps. Downtown LA vibes only. #tacos #dtla"',
    'Output: {"placeName":"Guerrilla Tacos","address":null,"city":"Downtown LA","state":"CA","posterType":"influencer","taggedAccounts":["guerrilla_tacos"],"query":"Guerrilla Tacos Downtown Los Angeles","confidence":"medium","needsUserConfirmation":false,"reason":"Influencer post tags restaurant by name; city corroborates"}',
    '',
    'Input title: "going here this weekend 😍"',
    'Input description: "check out @madyolkskitchen #brunch #eggs"',
    'Output: {"placeName":null,"address":null,"city":null,"state":null,"posterType":"unknown","taggedAccounts":[],"query":"","confidence":"low","needsUserConfirmation":true,"reason":"Handle text alone is not evidence; no caption name or address"}',
    '',
    'Input title: "follow @hungryjackie for the best food recs"',
    'Input description: "#foodblogger #lafood"',
    'Output: {"placeName":null,"address":null,"city":null,"state":null,"posterType":"influencer","taggedAccounts":[],"query":"","confidence":"low","needsUserConfirmation":true,"reason":"Influencer profile, no restaurant evidence"}',
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
  // v2 prompt may return placeName but no "query". Synthesize one from the
  // structured fields so older callers still work.
  let query = typeof obj.query === 'string' ? obj.query.trim() : '';
  const placeName =
    typeof obj.placeName === 'string' && obj.placeName.trim() ? obj.placeName.trim() : null;
  const address =
    typeof obj.address === 'string' && obj.address.trim() ? obj.address.trim() : null;
  const city =
    typeof obj.city === 'string' && obj.city.trim() ? obj.city.trim() : null;
  const state =
    typeof obj.state === 'string' && obj.state.trim() ? obj.state.trim() : null;
  if (!query && placeName) {
    query = [placeName, address ?? city, state].filter(Boolean).join(' ').trim();
  }
  if (!query && !placeName) return null;

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
  let taggedAccounts: string[] | undefined;
  if (Array.isArray(obj.taggedAccounts)) {
    taggedAccounts = obj.taggedAccounts.filter((c): c is string => typeof c === 'string');
  }
  const ptRaw = typeof obj.posterType === 'string' ? obj.posterType.toLowerCase() : '';
  const posterType: 'restaurant' | 'influencer' | 'unknown' =
    ptRaw === 'restaurant' || ptRaw === 'influencer' ? ptRaw : 'unknown';
  const needsUserConfirmation =
    typeof obj.needsUserConfirmation === 'boolean' ? obj.needsUserConfirmation : undefined;
  return {
    query,
    confidence,
    reason,
    candidates,
    placeName,
    address,
    city,
    state,
    posterType,
    taggedAccounts,
    needsUserConfirmation,
  };
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
