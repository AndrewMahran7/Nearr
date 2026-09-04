import type { CanonicalizedDestination, SimulatedDecision, SolParityPayload } from './types.js';

export function simulateDecision(payload: SolParityPayload | null, canonicalized: CanonicalizedDestination[]): SimulatedDecision {
  if (!payload || payload.scene_class === 'CONTEXT_ONLY' || payload.scene_class === 'UNKNOWN' || payload.results.length === 0) return 'WOULD_SHOW_FALLBACK';
  if (payload.scene_class === 'MULTIPLE_DESTINATIONS' || canonicalized.some((item) => item.status === 'AMBIGUOUS_CANONICAL')) return 'WOULD_SHOW_OPTIONS';
  const model = payload.results[0]!;
  const canonical = canonicalized[0];
  if (model.confidence === 'HIGH' && canonical && (canonical.status === 'CANONICAL_EXACT' || canonical.status === 'CANONICAL_ALIAS') && model.contradictions.length === 0) return 'WOULD_AUTO_SAVE';
  if (model.confidence === 'MEDIUM' && canonical && canonical.status !== 'NAMED_LEAD') return 'WOULD_REVIEW';
  if (canonical?.status === 'NAMED_LEAD') return 'WOULD_SHOW_NAMED_LEAD';
  return 'WOULD_SHOW_FALLBACK';
}
