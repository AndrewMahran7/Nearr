import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import {
  selectPlaceSourceEvidenceFrames,
  type PlaceSourceEvidenceResult,
} from '@/lib/placeSourcePreviews';
import type { PlaceSourceCard } from '@/lib/placeSources';
import { resolveShareEvidenceFramePreviews } from '@/lib/shareEvidenceFrames';
import { supabase } from '@/lib/supabase';

type ResultRow = {
  logical_result_id?: string | null;
  saved_place_id?: string | null;
  finalized_at?: string | null;
  share_job?: {
    source_url?: string | null;
    canonical_url?: string | null;
    candidate_payload?: unknown;
  } | Array<{
    source_url?: string | null;
    canonical_url?: string | null;
    candidate_payload?: unknown;
  }> | null;
};

function evidenceResult(row: ResultRow): PlaceSourceEvidenceResult | null {
  const relation = Array.isArray(row.share_job) ? row.share_job[0] : row.share_job;
  if (!relation) return null;
  return {
    sourceUrl: relation.canonical_url ?? relation.source_url ?? null,
    logicalResultId: row.logical_result_id ?? null,
    savedPlaceId: row.saved_place_id ?? null,
    candidatePayload: relation.candidate_payload ?? null,
    finalizedAt: row.finalized_at ?? null,
  };
}

/** Load retained source frames without blocking Place Detail's initial paint.
 * One result-ledger read and one batched private-Storage signing request cover
 * every source card for the saved place. */
export async function loadPlaceSourceEvidencePreviewUrls(
  savedPlaceId: string,
  sources: readonly Pick<PlaceSourceCard, 'key' | 'url'>[],
): Promise<Record<string, string>> {
  if (!savedPlaceId || sources.length === 0 || isDemoMode() || isMapPreviewMode()) return {};

  const { data, error } = await supabase
    .from('share_job_place_results')
    .select('logical_result_id, saved_place_id, finalized_at, share_job:share_jobs!inner(source_url, canonical_url, candidate_payload)')
    .eq('saved_place_id', savedPlaceId)
    .order('finalized_at', { ascending: false });
  if (error) throw new Error(error.message);

  const results = ((data ?? []) as ResultRow[])
    .map(evidenceResult)
    .filter((row): row is PlaceSourceEvidenceResult => !!row);
  const framesBySource = selectPlaceSourceEvidenceFrames(sources, results);
  const entries = Object.entries(framesBySource);
  if (entries.length === 0) return {};

  const resolved = await resolveShareEvidenceFramePreviews(entries.map(([, frame]) => frame));
  const urls: Record<string, string> = {};
  entries.forEach(([key], index) => {
    const uri = resolved[index]?.uri?.trim();
    if (uri) urls[key] = uri;
  });
  return urls;
}
