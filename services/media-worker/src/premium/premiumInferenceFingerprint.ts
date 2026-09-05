import { createHash } from 'node:crypto';
import type { SolCallResult } from '../solParity/model.js';
import {
  SOL_PARITY_INSTRUCTIONS,
  SOL_PARITY_SCHEMA,
  buildBoundedSolSourceContext,
} from '../solParity/prompt.js';
import {
  SOL_PARITY_MODEL,
  SOL_PARITY_PROMPT_VERSION,
  SOL_PARITY_SCHEMA_VERSION,
  type ModelArm,
  type SourceEvidence,
} from '../solParity/types.js';

export const PREMIUM_FINGERPRINT_VERSION = 'premium-inference-fingerprint.v1';
export const PREMIUM_EVIDENCE_VERSION = 'premium-evidence-2026-09-05.v1';
export const PREMIUM_ENGINE_VERSION = 'simple-sol-premium.v2';
export const PREMIUM_SAFETY_VERSION = 'premium-recognition-safety.v2';
export const PREMIUM_EVIDENCE_POLICY = Object.freeze({
  frameExtraction: 'worker-uniform-up-to-24-768px-jpeg-q3',
  frameSelection: 'current-nearr-diverse-up-to-6',
  resize: 'max-width-768-preserve-aspect-even-height',
  dedup: 'average-hash-interior-near-duplicate-suppression',
  textBounds: 'caption-4000_transcript-8000_ocr-3000_location-300_creator-300',
});

export type PremiumEvidenceReuseState =
  | 'EVIDENCE_REUSE_VALID'
  | 'EVIDENCE_REUSE_INCOMPLETE'
  | 'EVIDENCE_REUSE_VERSION_MISMATCH'
  | 'EVIDENCE_REGENERATED';

export type PremiumEvidenceBundleDescriptor = {
  version?: string | null;
  frameCount?: number | null;
  frameHashes?: string[] | null;
};

export type PremiumEvidenceReuseDecision = {
  state: PremiumEvidenceReuseState;
  mustRegenerate: boolean;
  reason: 'compatible' | 'missing_bundle' | 'missing_frame' | 'version_mismatch';
};

export function premiumEvidenceReuseDecision(
  bundle: PremiumEvidenceBundleDescriptor | null | undefined,
): PremiumEvidenceReuseDecision {
  if (!bundle) {
    return { state: 'EVIDENCE_REGENERATED', mustRegenerate: true, reason: 'missing_bundle' };
  }
  if (bundle.version !== PREMIUM_EVIDENCE_VERSION) {
    return { state: 'EVIDENCE_REUSE_VERSION_MISMATCH', mustRegenerate: true, reason: 'version_mismatch' };
  }
  const hashes = Array.isArray(bundle.frameHashes) ? bundle.frameHashes : [];
  if (!bundle.frameCount || hashes.length !== bundle.frameCount || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    return { state: 'EVIDENCE_REUSE_INCOMPLETE', mustRegenerate: true, reason: 'missing_frame' };
  }
  return { state: 'EVIDENCE_REUSE_VALID', mustRegenerate: false, reason: 'compatible' };
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function canonicalContentIdentity(url: string): { platform: string; contentId: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('instagram.com')) {
      const match = /^\/(?:reel|p|tv)\/([^/?#]+)/i.exec(parsed.pathname);
      return { platform: 'instagram', contentId: match?.[1] ?? parsed.pathname };
    }
    if (host === 'youtu.be') return { platform: 'youtube', contentId: parsed.pathname.replace(/^\//, '') };
    if (host.endsWith('youtube.com')) return { platform: 'youtube', contentId: parsed.searchParams.get('v') ?? parsed.pathname };
    if (host.endsWith('tiktok.com')) {
      const match = /\/video\/(\d+)/.exec(parsed.pathname);
      return { platform: 'tiktok', contentId: match?.[1] ?? parsed.pathname };
    }
    if (host.endsWith('facebook.com') || host === 'fb.watch') {
      return { platform: 'facebook', contentId: parsed.searchParams.get('v') ?? parsed.pathname };
    }
    return { platform: host || 'unknown', contentId: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { platform: 'unknown', contentId: url.trim() };
  }
}

export type PremiumInferenceFingerprint = {
  version: typeof PREMIUM_FINGERPRINT_VERSION;
  fingerprintId: string;
  evidenceVersion: typeof PREMIUM_EVIDENCE_VERSION;
  evidenceReuse: PremiumEvidenceReuseState;
  sourceIdentity: {
    platform: string;
    canonicalContentIdHash: string;
    canonicalUrlHash: string;
  };
  prompt: {
    promptVersion: string;
    promptHash: string;
    schemaVersion: string;
    schemaHash: string;
    model: string;
    reasoningConfig: { effort: 'high' };
  };
  frames: Array<{
    timestampMs: number;
    imageSha256: string;
    width: number;
    height: number;
    byteLength: number;
  }>;
  sourceContext: {
    captionHash: string;
    captionLength: number;
    transcriptHash: string;
    transcriptLength: number;
    ocrHash: string;
    ocrLength: number;
    sourceLocationHash: string;
    sourceLocationLength: number;
    sourceLocationPresent: boolean;
    creatorHash: string;
    creatorLength: number;
  };
  request: {
    imageCount: number;
    inputTextHash: string;
    requestPayloadHash: string;
  };
};

export function buildPremiumInferenceFingerprint(args: {
  platform: string;
  canonicalUrl: string;
  evidence: SourceEvidence;
  modelArm: ModelArm;
  frameManifest: SolCallResult['frame_manifest'];
  inputText: string;
  requestPayload: unknown;
  evidenceReuse?: PremiumEvidenceReuseState;
}): PremiumInferenceFingerprint {
  const source = canonicalContentIdentity(args.canonicalUrl);
  const context = buildBoundedSolSourceContext({ modelArm: args.modelArm, evidence: args.evidence });
  const withoutId: Omit<PremiumInferenceFingerprint, 'fingerprintId'> = {
    version: PREMIUM_FINGERPRINT_VERSION,
    evidenceVersion: PREMIUM_EVIDENCE_VERSION,
    evidenceReuse: args.evidenceReuse ?? 'EVIDENCE_REGENERATED',
    sourceIdentity: {
      platform: args.platform || source.platform,
      canonicalContentIdHash: sha256(source.contentId),
      canonicalUrlHash: sha256(args.canonicalUrl.trim()),
    },
    prompt: {
      promptVersion: SOL_PARITY_PROMPT_VERSION,
      promptHash: sha256(SOL_PARITY_INSTRUCTIONS),
      schemaVersion: SOL_PARITY_SCHEMA_VERSION,
      schemaHash: sha256(stableStringify(SOL_PARITY_SCHEMA)),
      model: SOL_PARITY_MODEL,
      reasoningConfig: { effort: 'high' as const },
    },
    frames: args.frameManifest.map((frame) => ({
      timestampMs: Math.round(frame.timestamp_seconds * 1_000),
      imageSha256: frame.sha256,
      width: frame.width,
      height: frame.height,
      byteLength: frame.byte_length ?? 0,
    })),
    sourceContext: {
      captionHash: sha256(context.caption),
      captionLength: context.caption.length,
      transcriptHash: sha256(context.transcript),
      transcriptLength: context.transcript.length,
      ocrHash: sha256(context.ocr),
      ocrLength: context.ocr.length,
      sourceLocationHash: sha256(context.location),
      sourceLocationLength: context.location.length,
      sourceLocationPresent: context.location.length > 0,
      creatorHash: sha256(context.creator),
      creatorLength: context.creator.length,
    },
    request: {
      imageCount: args.frameManifest.length,
      inputTextHash: sha256(args.inputText),
      requestPayloadHash: sha256(JSON.stringify(args.requestPayload)),
    },
  };
  return { ...withoutId, fingerprintId: sha256(stableStringify(withoutId)) };
}

export function structuredSolBoundary(args: {
  premiumRequestId?: string | null;
  shareJobId?: string | null;
  call: SolCallResult;
}) {
  const payload = args.call.payload;
  return {
    version: 'premium-sol-boundary.v1',
    premiumRequestId: args.premiumRequestId ?? null,
    shareJobId: args.shareJobId ?? null,
    fingerprintId: args.call.fingerprint?.fingerprintId ?? null,
    model: args.call.model,
    responseId: args.call.response_id,
    latencyMs: args.call.latency_ms,
    usage: args.call.usage,
    structuredResultHash: payload ? sha256(stableStringify(payload)) : null,
    destinationCount: payload?.results.length ?? 0,
    hypotheses: (payload?.results ?? []).slice(0, 10).map((result) => ({
      name: result.name.slice(0, 200),
      entityType: result.entity_type,
      confidence: result.confidence,
      evidenceBasis: result.supporting_clues.some((clue) => /famous|well[- ]known|viral|memory/i.test(clue))
        ? 'CONTEXTUAL_OR_MEMORY_PRIOR'
        : 'MODEL_OBSERVED',
      alternatives: result.alternatives.slice(0, 2).map((alternative) => alternative.name.slice(0, 200)),
    })),
    parseSuccess: !!payload && !args.call.failure,
    parseFailureCode: args.call.failure?.code ?? null,
  };
}
