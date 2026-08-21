/** Derived model-context contract used by targeted video AI-note generation. */
export const MODEL_DESCRIPTION_CONTEXT_MAX = 4_000;

function sliceWithoutSplittingSurrogate(value: string, max: number): string {
  let bounded = value.slice(0, Math.max(0, max));
  const last = bounded.charCodeAt(bounded.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

/** Derive a bounded prompt excerpt without mutating the retained source value. */
export function sourceDescriptionForModel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > MODEL_DESCRIPTION_CONTEXT_MAX
    ? sliceWithoutSplittingSurrogate(value, MODEL_DESCRIPTION_CONTEXT_MAX)
    : value;
}
