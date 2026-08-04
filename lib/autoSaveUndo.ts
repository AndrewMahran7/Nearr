export function autoSaveUndoElapsedBucket(finalizedAt: string, now = Date.now()): string {
  const finalized = new Date(finalizedAt).getTime();
  if (!Number.isFinite(finalized)) return 'unknown';
  const elapsedSeconds = Math.max(0, Math.round((now - finalized) / 1000));
  if (elapsedSeconds < 10) return 'under_10s';
  if (elapsedSeconds < 60) return '10s_to_1m';
  if (elapsedSeconds < 5 * 60) return '1m_to_5m';
  if (elapsedSeconds < 60 * 60) return '5m_to_1h';
  return 'over_1h';
}