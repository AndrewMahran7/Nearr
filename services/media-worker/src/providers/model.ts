// services/media-worker/src/providers/model.ts
//
// Place-evidence analysis provider. Default `heuristic` is deterministic and
// offline-safe (builds explicit evidence from transcript + visible text). An
// optional multimodal `gemini` provider sends selected frames + transcript +
// caption and returns the same structured evidence. The provider is REPLACEABLE
// and never the final authority — Nearr's deterministic resolver decides.

import { readFile } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import type { OcrSegment, SelectedFrame, TranscriptSegment } from '../types/media.js';
import {
  type EvidenceItem,
  type MediaPlaceEvidence,
  type PlaceCandidateEvidence,
  emptyEvidence,
  safeParseEvidence,
  parseEvidenceWithDiagnostics,
  type EvidenceParseDiagnostics,
} from '../types/evidence.js';
import {
  PLACE_EVIDENCE_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserContext,
} from '../prompts/placeEvidencePrompt.js';
import { log } from '../util/logger.js';
import { MediaError } from '../types/media.js';
import { parseRetryAfterSeconds } from '../util/backoff.js';
import { withVayrinFallback } from '../vayrin/visualGeolocationProvider.js';

export type AnalyzeInput = {
  platform: string;
  canonicalUrl: string;
  transcript: TranscriptSegment[];
  ocr: OcrSegment[];
  /** True only when a separate OCR pass actually ran (see OcrProvider
   *  .extractsVisibleText). Absent/false means reading is delegated to this
   *  model, so an empty `ocr` must NOT be presented as "no visible text". */
  ocrExtracted?: boolean;
  frames: SelectedFrame[];
  metadataTitle?: string | null;
  metadataDescription?: string | null;
  metadataLocation?: string | null;
  targetPlace?: {
    name: string;
    category?: string | null;
    formattedAddress?: string | null;
  } | null;
  /** Place-scoped evidence retained from an earlier recognition pass. */
  retainedEvidence?: EvidenceItem[];
  signal: AbortSignal;
};

export type AnalyzeOutput = {
  provider: string;
  /** Optional for custom/test providers; production providers always set it. */
  modelName?: string;
  promptVersion: string;
  evidence: MediaPlaceEvidence;
  /** Size-bounded raw preview for diagnostics (never the full response). */
  modelRawPreview?: string;
  /** Structured record of what schema validation kept vs dropped. */
  parseDiagnostics?: EvidenceParseDiagnostics;
  /** Bounded, secret-free record of the Vayrin visual-geolocation escalation:
   *  whether it ran, why, what it cost, and what it produced. Absent when the
   *  provider is not wrapped. Typed loosely so this module does not have to
   *  depend on the vayrin module, which already depends on this one. */
  vayrin?: Record<string, unknown>;
  /** Content-free account of what the baseline model actually received. */
  modelInput?: {
    model: string;
    frameCount: number;
    timestampsSeconds: number[];
    textContextCategories: string[];
  };
};

export interface ModelProvider {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

function groundingText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function groundClaimedEvidence(
  evidence: MediaPlaceEvidence,
  input: Pick<AnalyzeInput, 'transcript' | 'metadataTitle' | 'metadataDescription' | 'retainedEvidence'> & {
    ocr?: AnalyzeInput['ocr'];
    ocrExtracted?: AnalyzeInput['ocrExtracted'];
  },
): MediaPlaceEvidence {
  const retained = input.retainedEvidence ?? [];
  const retainedFor = (source: EvidenceItem['source']): string =>
    retained.filter((item) => item.source === source).map((item) => item.value).join(' ');
  const speech = groundingText([
    input.transcript.map((segment) => segment.text).join(' '),
    retainedFor('speech'),
  ].join(' '));
  const caption = groundingText([
    input.metadataTitle,
    input.metadataDescription,
    retainedFor('caption'),
  ].filter(Boolean).join(' '));
  const visibleText = groundingText([
    (input.ocr ?? []).map((segment) => segment.text).join(' '),
    retainedFor('visible_text'),
  ].join(' '));
  // Corroborating a visible-text claim requires a text stream to corroborate it
  // AGAINST. `ocrExtracted` is false whenever reading frames is delegated to
  // this same multimodal step (today: always — selectOcrProvider returns the
  // noop provider for every configured value), so `visibleText` is empty for
  // the trivial reason that no separate pass looked. Checking a claim against
  // it then fails every time, which is not a stricter test — it is an
  // unconditional one. Same reasoning as buildUserContext: an empty OCR result
  // means "nothing looked yet", never "there is no visible text".
  const canCorroborateVisibleText = input.ocrExtracted === true;
  let dropped = 0;
  const groundedItems = (
    items: PlaceCandidateEvidence['explicitEvidence'],
    validateVisibleText: boolean,
  ) =>
    items.filter((item) => {
      // Preserve the resolver's existing explicit-evidence behavior. The cue
      // path additionally corroborates visible text, but only once a real OCR
      // pass exists to corroborate against; a sign the model read off a frame
      // is otherwise exactly as observed as the frame itself.
      if (item.source === 'frame') return true;
      if (item.source === 'visible_text' && !(validateVisibleText && canCorroborateVisibleText)) return true;
      const claim = groundingText(item.value);
      const source = item.source === 'speech'
        ? speech
        : item.source === 'caption'
          ? caption
          : visibleText;
      const grounded = claim.length >= 3 && source.includes(claim);
      if (!grounded) dropped += 1;
      return grounded;
    });
  const places = evidence.places.map((place) => {
    const memoryCueEvidence = groundedItems(place.memoryCueEvidence, true);
    return {
      ...place,
      explicitEvidence: groundedItems(place.explicitEvidence, false),
      memoryCue: memoryCueEvidence.length > 0 ? place.memoryCue : null,
      memoryCueEvidence,
    };
  });
  return {
    ...evidence,
    places,
    insufficientEvidence:
      evidence.insufficientEvidence || places.every((place) => place.explicitEvidence.length === 0),
    warnings: dropped > 0
      ? [...evidence.warnings, 'ungrounded_explicit_evidence_dropped']
      : evidence.warnings,
  };
}

// ---------------------------------------------------------------------------
// Deterministic heuristic (default). Surfaces explicit spoken / visible strings
// as evidence; the downstream resolver does the real Places verification.
// ---------------------------------------------------------------------------

const STREET_RE =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+){0,4}\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place|cir|circle|plaza|sq|square)\b\.?/i;

const NAME_CUE_RE =
  /\b(?:we(?:'re| are)|here|i'?m|welcome to|this is|check out|visiting|came to|at)\s+(?:at\s+)?([A-Z][A-Za-z0-9'&.\-]*(?:\s+[A-Z][A-Za-z0-9'&.\-]*){0,4})/;

function collectText(
  transcript: TranscriptSegment[],
  ocr: OcrSegment[],
): { source: 'speech' | 'visible_text'; ts: number | null; text: string }[] {
  const out: { source: 'speech' | 'visible_text'; ts: number | null; text: string }[] = [];
  for (const s of transcript) out.push({ source: 'speech', ts: s.startSeconds, text: s.text });
  for (const o of ocr) out.push({ source: 'visible_text', ts: o.timestampSeconds, text: o.text });
  return out;
}

export function heuristicEvidence(input: AnalyzeInput): MediaPlaceEvidence {
  const items = collectText(input.transcript, input.ocr);
  if (items.length === 0) return emptyEvidence(['heuristic_no_text']);

  let address: { value: string; ts: number | null; source: 'speech' | 'visible_text' } | null = null;
  let name: { value: string; ts: number | null; source: 'speech' | 'visible_text' } | null = null;

  for (const it of items) {
    if (!address) {
      const m = it.text.match(STREET_RE);
      if (m) address = { value: m[0].replace(/\s+/g, ' ').trim(), ts: it.ts, source: it.source };
    }
    if (!name) {
      const m = it.text.match(NAME_CUE_RE);
      if (m && m[1]) {
        const cand = m[1].replace(/\s+/g, ' ').trim();
        if (cand.length >= 3) name = { value: cand, ts: it.ts, source: it.source };
      }
    }
  }

  if (!address && !name) return emptyEvidence(['heuristic_no_place_signal']);

  const explicit: PlaceCandidateEvidence['explicitEvidence'] = [];
  if (name) explicit.push({ timestampSeconds: name.ts, source: name.source, value: name.value });
  if (address) explicit.push({ timestampSeconds: address.ts, source: address.source, value: address.value });

  const place: PlaceCandidateEvidence = {
    logicalPlaceId: null,
    identityEvidenceKind: 'observable',
    hypothesisRank: 0,
    name: name?.value ?? address?.value ?? 'Unknown place',
    category: null,
    categoryConfidence: 0,
    categoryEvidenceTags: [],
    address: address?.value ?? null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: name && address ? 0.6 : 0.4,
    explicitEvidence: explicit,
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
  };

  return {
    places: [place],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: ['heuristic_provider'],
  };
}

class HeuristicModel implements ModelProvider {
  readonly name = 'heuristic';
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    return { provider: this.name, modelName: 'heuristic-v1', promptVersion: 'heuristic-v1', evidence: heuristicEvidence(input) };
  }
}

// ---------------------------------------------------------------------------
// Multimodal Gemini (optional). Sends frames + transcript + caption and asks
// for the structured JSON evidence. Any failure degrades to insufficient
// evidence with a warning — never a fabricated result.
// ---------------------------------------------------------------------------

class GeminiModel implements ModelProvider {
  readonly name = 'gemini';
  constructor(private cfg: WorkerConfig) {}

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    if (!this.cfg.geminiApiKey) {
      if (input.targetPlace) throw new MediaError('provider_unavailable', 'gemini_missing_key');
      return { provider: this.name, modelName: this.cfg.geminiModel, promptVersion: PROMPT_VERSION, evidence: emptyEvidence(['gemini_missing_key']) };
    }
    const transcriptText = input.transcript
      .map((s) => `[${s.startSeconds.toFixed(1)}] ${s.text}`)
      .join('\n');
    const ocrText = input.ocr
      .map((o) => `[${o.timestampSeconds.toFixed(1)}] ${o.text}`)
      .join('\n');
    const userText = buildUserContext({
      platform: input.platform,
      transcriptText,
      ocrText,
      ocrExtracted: input.ocrExtracted === true,
      metadataTitle: input.metadataTitle,
      metadataDescription: input.metadataDescription,
      targetPlace: input.targetPlace,
      retainedEvidence: input.retainedEvidence,
    });

    const parts: unknown[] = [{ text: `${PLACE_EVIDENCE_SYSTEM_PROMPT}\n\n${userText}` }];
    const sentTimestampsSeconds: number[] = [];
    for (const frame of input.frames.slice(0, this.cfg.maxSelectedFrames)) {
      try {
        const bytes = await readFile(frame.path);
        parts.push({ text: `frame_timestamp_seconds: ${frame.timestampSeconds.toFixed(3)}` });
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') } });
        sentTimestampsSeconds.push(frame.timestampSeconds);
      } catch {
        /* skip unreadable frame */
      }
    }
    const modelInput: NonNullable<AnalyzeOutput['modelInput']> = {
      model: this.cfg.geminiModel,
      frameCount: sentTimestampsSeconds.length,
      timestampsSeconds: sentTimestampsSeconds,
      textContextCategories: [
        'platform',
        ...([input.metadataTitle, input.metadataDescription].some(Boolean) ? ['caption'] : []),
        ...(input.transcript.length > 0 ? ['transcript'] : []),
        ...(input.ocr.length > 0 ? ['visible_text'] : []),
      ],
    };

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.cfg.geminiModel,
      )}:generateContent?key=${encodeURIComponent(this.cfg.geminiApiKey)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        signal: input.signal,
      });
      if (!res.ok) {
        const warning = `gemini_http_${res.status}`;
        const fallback = heuristicEvidence(input);
        // Recognition may retain deterministic identity evidence during a
        // provider outage. Targeted note generation cannot: the heuristic does
        // not generate notes, so accepting it would turn a transient provider
        // failure into a terminal blank. Requeue instead.
        if (!input.targetPlace && !fallback.insufficientEvidence && fallback.places.length > 0) {
          return {
            provider: `${this.name}+heuristic`,
            modelName: this.cfg.geminiModel,
            promptVersion: PROMPT_VERSION,
            evidence: { ...fallback, warnings: [...fallback.warnings, warning] },
            modelInput,
          };
        }
        if (res.status === 429 || res.status >= 500) {
          throw new MediaError(
            res.status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
            warning,
            parseRetryAfterSeconds(res.headers.get('retry-after')),
          );
        }
        return { provider: this.name, modelName: this.cfg.geminiModel, promptVersion: PROMPT_VERSION, evidence: emptyEvidence([warning]), modelInput };
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { provider: this.name, modelName: this.cfg.geminiModel, promptVersion: PROMPT_VERSION, evidence: emptyEvidence(['gemini_json_parse_failed']), modelRawPreview: text.slice(0, 500), modelInput };
      }
      const { evidence: validated, diagnostics: parseDiag } = parseEvidenceWithDiagnostics(parsed);
      const evidence = groundClaimedEvidence(validated, input);
      // Bounded, structured record of what validation kept vs dropped. This is
      // what makes a future schema regression diagnosable WITHOUT storing the
      // full model response: paths and codes only, never model text.
      if (parseDiag.rejected > 0 || parseDiag.topLevelInvalid) {
        log.warn('evidence_validation_rejected', {
          emitted: parseDiag.emitted,
          accepted: parseDiag.accepted,
          rejected: parseDiag.rejected,
          topLevelInvalid: parseDiag.topLevelInvalid,
          paths: parseDiag.rejectionPaths,
        });
      }
      return {
        provider: this.name,
        modelName: this.cfg.geminiModel,
        promptVersion: PROMPT_VERSION,
        evidence,
        modelRawPreview: text.slice(0, 500),
        parseDiagnostics: parseDiag,
        modelInput,
      };
    } catch (err) {
      if (err instanceof MediaError) throw err;
      if (input.signal.aborted) throw new MediaError('download_timeout', 'gemini_timeout');
      log.warn('gemini_error', { model: this.cfg.geminiModel });
      const fallback = heuristicEvidence(input);
      if (!input.targetPlace && !fallback.insufficientEvidence && fallback.places.length > 0) {
        return {
          provider: `${this.name}+heuristic`,
          modelName: this.cfg.geminiModel,
          promptVersion: PROMPT_VERSION,
          evidence: { ...fallback, warnings: [...fallback.warnings, 'gemini_exception'] },
          modelInput,
        };
      }
      throw new MediaError('provider_unavailable', 'gemini_exception');
    }
  }
}

export function selectModelProvider(cfg: WorkerConfig): ModelProvider {
  const base = cfg.analysisProvider === 'gemini' ? new GeminiModel(cfg) : new HeuristicModel();
  // Vayrin WRAPS the configured provider rather than replacing it: the cheap
  // pass still runs first on every share and still decides every case it can
  // already decide. With VAYRIN_VISUAL_GEOLOCATION_ENABLED off (the default)
  // this returns `base` untouched — no wrapper, no OpenAI call, no behavior
  // change of any kind.
  return withVayrinFallback(base, cfg);
}
