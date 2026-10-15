/** Preserve original-post imagery before a candidate exists, without a fetch. */
export function activitySourceFrameUri(
  candidate: { sourceFrameUrl?: string | null } | null | undefined,
  extraction: Record<string, unknown> | null | undefined,
): string | undefined {
  const candidateFrame = typeof candidate?.sourceFrameUrl === 'string' ? candidate.sourceFrameUrl.trim() : undefined;
  if (candidateFrame) return candidateFrame;
  return typeof extraction?.sourceFrameUrl === 'string'
    ? extraction.sourceFrameUrl.trim() || undefined
    : undefined;
}
