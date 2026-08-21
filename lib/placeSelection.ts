/**
 * Place-result selection semantics.
 *
 * A result can contain several independent logical places while each logical
 * place can still contain several mutually-exclusive provider identities.
 * Candidate count is deliberately not used as the semantic signal.
 */
export type SelectionMode = 'single_identity' | 'multi_independent';

export type PlaceSelectionSemanticsInput = {
  explicitMode?: unknown;
  decision?: unknown;
  mentionSlots?: readonly unknown[] | null;
  diagnostics?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeSelectionMode(value: unknown): SelectionMode | null {
  return value === 'single_identity' || value === 'multi_independent' ? value : null;
}

function diagnosticMentionMode(value: unknown): 'single' | 'multi' | null {
  const diagnostics = record(value);
  const nameDriven = record(diagnostics?.nameDrivenMultiPlace);
  return nameDriven?.mode === 'single' || nameDriven?.mode === 'multi'
    ? nameDriven.mode
    : null;
}

/**
 * Classify the whole result. Persisted logical mention slots are authoritative:
 * several slots are independent places; one slot is one identity question.
 * Legacy multi-address results predate slots, so their explicit multi decision
 * remains the compatibility fallback.
 */
export function selectionModeForPlaceResult(
  input: PlaceSelectionSemanticsInput,
): SelectionMode {
  const explicit = normalizeSelectionMode(input.explicitMode);
  if (explicit) return explicit;

  const slotCount = Array.isArray(input.mentionSlots) ? input.mentionSlots.length : 0;
  if (slotCount > 1) return 'multi_independent';
  if (slotCount === 1) return 'single_identity';

  if (input.decision === 'multi_candidate_confirmation') {
    // The legacy decision name is overloaded. Name-driven diagnostics preserve
    // whether it meant one ambiguous mention or several independent mentions.
    return diagnosticMentionMode(input.diagnostics) === 'single'
      ? 'single_identity'
      : 'multi_independent';
  }

  return 'single_identity';
}

/** Alternatives within one logical mention always answer "which one is it?". */
export function candidateIdentitySelectionMode(): SelectionMode {
  return 'single_identity';
}
