// Service-role recognition-cache boundary. Cache persistence and telemetry are
// auxiliary: every public helper fails open so the established Vayrin path is
// still authoritative when the cache is unavailable.

import {
  RECOGNITION_VERSION,
  canonicalContentIdentity,
  type CanonicalContentIdentity,
} from '../../../lib/shareAgent/contentIdentity.ts';

export type RecognitionTrust = 'USER_CONFIRMED' | 'VERIFIED_AUTO_SAVE' | 'CANDIDATE_SET';

export type RecognitionCacheRow = {
  id: string;
  identity_key: string;
  platform: string;
  content_id: string;
  canonical_url: string;
  identity_version: number;
  recognition_version: string;
  result_type: 'verified_place' | 'candidate_set';
  trust_level: RecognitionTrust;
  canonical_place_id: string | null;
  candidate_payload: Record<string, unknown> | null;
  evidence_summary?: Record<string, unknown> | null;
  invalidated_at: string | null;
  confirmed_at?: string | null;
};

export type RecognitionRejection = {
  user_id: string;
  identity_key: string;
  canonical_place_id: string;
  google_place_id: string | null;
  rejected_at: string;
};

export type RecognitionCacheDecision =
  | { kind: 'trusted_place'; row: RecognitionCacheRow }
  | { kind: 'candidate_set'; row: RecognitionCacheRow }
  | {
      kind: 'disputed';
      row: RecognitionCacheRow;
      candidatePayload: Record<string, unknown> | null;
      suppressedCandidateCount: number;
      reusableEvidence: boolean;
      reason: 'user_rejected_result';
    }
  | { kind: 'miss'; reason: string };

export function recognitionCacheDecision(
  row: RecognitionCacheRow | null | undefined,
  recognitionVersion = RECOGNITION_VERSION,
): RecognitionCacheDecision {
  if (!row) return { kind: 'miss', reason: 'not_found' };
  if (row.invalidated_at) return { kind: 'miss', reason: 'invalidated' };
  if (row.trust_level === 'USER_CONFIRMED' && row.canonical_place_id) {
    return { kind: 'trusted_place', row };
  }
  if (row.recognition_version !== recognitionVersion) {
    return { kind: 'miss', reason: 'recognition_version_changed' };
  }
  if (row.trust_level === 'VERIFIED_AUTO_SAVE' && row.canonical_place_id) {
    return { kind: 'trusted_place', row };
  }
  if (row.trust_level === 'CANDIDATE_SET' && row.candidate_payload) {
    return { kind: 'candidate_set', row };
  }
  return { kind: 'miss', reason: 'not_reusable' };
}

function suppressRejectedCandidates(
  value: unknown,
  rejectedGoogleIds: ReadonlySet<string>,
): { value: unknown; suppressed: number } {
  if (Array.isArray(value)) {
    let suppressed = 0;
    const output: unknown[] = [];
    for (const item of value) {
      const googleId = item && typeof item === 'object' &&
          typeof (item as any).googlePlaceId === 'string'
        ? (item as any).googlePlaceId
        : null;
      if (googleId && rejectedGoogleIds.has(googleId)) {
        suppressed += 1;
        continue;
      }
      const nested = suppressRejectedCandidates(item, rejectedGoogleIds);
      suppressed += nested.suppressed;
      output.push(nested.value);
    }
    return { value: output, suppressed };
  }
  if (!value || typeof value !== 'object') return { value, suppressed: 0 };
  let suppressed = 0;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nested = suppressRejectedCandidates(child, rejectedGoogleIds);
    output[key] = nested.value;
    suppressed += nested.suppressed;
  }
  return { value: output, suppressed };
}

export function recognitionCacheDecisionForUser(
  row: RecognitionCacheRow | null | undefined,
  rejections: readonly RecognitionRejection[],
  recognitionVersion = RECOGNITION_VERSION,
): RecognitionCacheDecision {
  const base = recognitionCacheDecision(row, recognitionVersion);
  if (!row || rejections.length === 0 || base.kind === 'miss') return base;
  const confirmedAt = row.confirmed_at ? Date.parse(row.confirmed_at) : Number.NEGATIVE_INFINITY;
  const active = rejections.filter((rejection) =>
    rejection.identity_key === row.identity_key && Date.parse(rejection.rejected_at) > confirmedAt
  );
  if (active.length === 0) return base;
  const rejectedPlaceIds = new Set(active.map((entry) => entry.canonical_place_id));
  const rejectedGoogleIds = new Set(
    active.map((entry) => entry.google_place_id).filter((value): value is string => !!value),
  );
  const trustedRejected = !!row.canonical_place_id && rejectedPlaceIds.has(row.canonical_place_id);
  const filtered = suppressRejectedCandidates(row.candidate_payload, rejectedGoogleIds);
  if (!trustedRejected && filtered.suppressed === 0) return base;
  return {
    kind: 'disputed',
    row,
    candidatePayload: filtered.value && typeof filtered.value === 'object'
      ? filtered.value as Record<string, unknown>
      : null,
    suppressedCandidateCount: filtered.suppressed + (trustedRejected ? 1 : 0),
    reusableEvidence: !!row.evidence_summary || !!row.candidate_payload,
    reason: 'user_rejected_result',
  };
}

export async function lookupRecognition(
  admin: any,
  identity: CanonicalContentIdentity,
  userId?: string | null,
): Promise<RecognitionCacheDecision> {
  try {
    const { data, error } = await admin
      .from('recognition_cache')
      .select('id,identity_key,platform,content_id,canonical_url,identity_version,recognition_version,result_type,trust_level,canonical_place_id,candidate_payload,evidence_summary,invalidated_at,confirmed_at')
      .eq('identity_key', identity.key)
      .maybeSingle();
    if (error) throw error;
    let rejections: RecognitionRejection[] = [];
    if (userId && data) {
      const rejectionResult = await admin
        .from('recognition_rejections')
        .select('user_id,identity_key,canonical_place_id,google_place_id,rejected_at')
        .eq('user_id', userId)
        .eq('identity_key', identity.key);
      if (!rejectionResult.error && Array.isArray(rejectionResult.data)) {
        rejections = rejectionResult.data as RecognitionRejection[];
      }
    }
    const decision = recognitionCacheDecisionForUser(data as RecognitionCacheRow | null, rejections);
    if (data?.id) {
      void admin.from('recognition_cache').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
    }
    return decision;
  } catch (error) {
    console.log(`[recognition-cache] lookup_failed code=${(error as any)?.code ?? 'unknown'}`);
    return { kind: 'miss', reason: 'lookup_failed' };
  }
}

export async function claimRecognition(
  admin: any,
  identity: CanonicalContentIdentity,
  ownerToken: string,
  leaseSeconds = 600,
): Promise<'owner' | 'joined' | 'unavailable'> {
  try {
    const { data, error } = await admin.rpc('claim_recognition_identity', {
      p_identity_key: identity.key,
      p_owner_token: ownerToken,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.claimed === true ? 'owner' : 'joined';
  } catch (error) {
    console.log(`[recognition-cache] claim_failed code=${(error as any)?.code ?? 'unknown'}`);
    return 'unavailable';
  }
}

export async function releaseRecognition(
  admin: any,
  identityKey: string | null | undefined,
  ownerToken: string,
): Promise<void> {
  if (!identityKey) return;
  try {
    await admin.rpc('release_recognition_identity', {
      p_identity_key: identityKey,
      p_owner_token: ownerToken,
    });
  } catch {
    // Lease expiry remains the recovery path.
  }
}

function boundedJson(value: unknown, maxBytes: number): unknown {
  if (value == null) return null;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length <= maxBytes ? value : null;
  } catch {
    return null;
  }
}

export function sanitizeGlobalPayload(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeGlobalPayload(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  const privateKeys = new Set([
    'userId', 'user_id', 'savedPlaceId', 'saved_place_id', 'savedPlaceIds',
    'shareJobId', 'share_job_id', 'notification_payload',
    // Evidence objects are deliberately user/job scoped. A global cache row
    // must never hand one user's private Storage paths to another user; cache
    // hits degrade to the existing honest missing-frame UI instead.
    'evidenceFrames', 'storagePath',
  ]);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (privateKeys.has(key)) continue;
    output[key] = sanitizeGlobalPayload(child, depth + 1);
  }
  return output;
}

export async function persistRecognition(args: {
  admin: any;
  identity: CanonicalContentIdentity;
  trust: RecognitionTrust;
  canonicalPlaceId?: string | null;
  candidatePayload?: unknown;
  evidenceSummary?: unknown;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    const payload = {
      identity_key: args.identity.key,
      platform: args.identity.platform,
      content_id: args.identity.contentId,
      canonical_url: args.identity.canonicalUrl,
      identity_version: args.identity.identityVersion,
      recognition_version: RECOGNITION_VERSION,
      result_type: args.canonicalPlaceId ? 'verified_place' : 'candidate_set',
      trust_level: args.trust,
      canonical_place_id: args.canonicalPlaceId ?? null,
      candidate_payload: boundedJson(sanitizeGlobalPayload(args.candidatePayload), 64_000),
      evidence_summary: boundedJson(sanitizeGlobalPayload(args.evidenceSummary), 16_000),
      last_seen_at: now,
      last_verified_at: args.canonicalPlaceId ? now : null,
      invalidated_at: null,
      invalidation_reason: null,
    };
    const { error } = await args.admin
      .from('recognition_cache')
      .upsert(payload, { onConflict: 'identity_key' });
    if (error) throw error;
  } catch (error) {
    console.log(`[recognition-cache] persist_failed code=${(error as any)?.code ?? 'unknown'}`);
  }
}

export async function recordRecognitionEvent(
  admin: any,
  event: string,
  identity: CanonicalContentIdentity | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await admin.from('recognition_cache_events').insert({
      event_name: event,
      identity_key: identity?.key ?? null,
      platform: identity?.platform ?? null,
      media_download_avoided: details.mediaDownloadAvoided === true,
      gemini_calls_avoided: Number(details.geminiCallsAvoided) || 0,
      sol_calls_avoided: Number(details.solCallsAvoided) || 0,
      estimated_latency_ms_saved: Number(details.estimatedLatencyMsSaved) || 0,
      detail: boundedJson(details, 4_000) ?? {},
    });
  } catch {
    // Diagnostics never affect recognition or saving.
  }
}

export async function recordIdentityOnJob(
  admin: any,
  jobId: string,
  identity: CanonicalContentIdentity,
): Promise<void> {
  try {
    await admin.from('share_jobs').update({
      recognition_identity_key: identity.key,
      recognition_identity_version: identity.identityVersion,
      recognition_content_id: identity.contentId,
      canonical_url: identity.canonicalUrl,
      source_platform: identity.platform,
    }).eq('id', jobId).eq('status', 'processing_metadata');
  } catch {
    // Cache linkage is auxiliary.
  }
}

export async function attachSavedPlaceSource(args: {
  admin: any;
  userId: string;
  savedPlaceId: string;
  sourceUrl: string;
  sourceType: string;
  resolvedUrl?: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  caption?: string | null;
  aiNote?: string | null;
  thumbnailUrl?: string | null;
}): Promise<{ attached: boolean; deduped: boolean }> {
  const identity = canonicalContentIdentity(args.sourceUrl, args.resolvedUrl);
  if (!identity) return { attached: false, deduped: false };
  try {
    const { data, error } = await args.admin.rpc('attach_saved_place_source', {
      p_user_id: args.userId,
      p_saved_place_id: args.savedPlaceId,
      p_identity_key: identity.key,
      p_identity_version: identity.identityVersion,
      p_platform: args.sourceType || identity.platform,
      p_content_id: identity.contentId,
      p_canonical_url: identity.canonicalUrl,
      p_original_url: args.sourceUrl,
      p_creator_handle: args.creatorHandle ?? null,
      p_creator_name: args.creatorName ?? null,
      p_caption_excerpt: typeof args.caption === 'string' ? args.caption.slice(0, 1000) : null,
      p_ai_note: typeof args.aiNote === 'string' ? args.aiNote.slice(0, 1000) : null,
      p_thumbnail_url: args.thumbnailUrl ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const attached = row?.attached === true;
    const deduped = row?.deduped === true;
    await recordRecognitionEvent(
      args.admin,
      deduped ? 'source_deduped' : 'source_attached_existing_place',
      identity,
      { attached, deduped },
    );
    return { attached, deduped };
  } catch (error) {
    console.log(`[saved-place-source] attach_failed code=${(error as any)?.code ?? 'unknown'}`);
    return { attached: false, deduped: false };
  }
}
