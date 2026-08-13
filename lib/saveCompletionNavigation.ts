/**
 * lib/saveCompletionNavigation.ts
 *
 * PURE navigation policy for what happens after a share-job save succeeds.
 *
 * The production bug this fixes: the per-job Quick check screen called
 * `router.replace(map)`, which swaps only the TOP route. Both `/share-jobs` and
 * `/share-jobs/[jobId]` are `transparentModal` presentations, so the queue sheet
 * stayed mounted on top of the map and covered the place the user just saved.
 *
 * The plan below always dismisses the whole share-jobs modal stack first, then
 * navigates exactly once to the map destination.
 *
 * No React Native / expo-router imports and no I/O so it is unit-testable.
 */

export type SaveCompletionStep =
  | { kind: 'dismissAll' }
  | { kind: 'replace'; pathname: string; params: Record<string, string> };

export type SaveCompletionInput = {
  /** saved_places ids created by this save. */
  createdSavedPlaceIds: readonly string[];
  /** Existing saved_places ids matched instead of creating duplicates. */
  duplicateSavedPlaceIds?: readonly string[];
  /** Whether any modal is currently dismissable (router.canDismiss()). */
  canDismiss: boolean;
  /** Opaque id for a grouped map-fit request, when one was created. */
  mapGroupId?: string | null;
  /** How many candidates failed, so the group view can be honest. */
  failedCount?: number;
};

export type SaveCompletionNavigation = {
  steps: SaveCompletionStep[];
  destination: 'single' | 'group' | 'existing' | 'none';
};

export type SaveCompletionRouter = {
  dismissAll: () => void;
  replace: (destination: { pathname: string; params: Record<string, string> }) => void;
};

const COMPLETION_SIGNAL_TTL_MS = 8_000;
const recentCompletionSignals = new Map<string, number>();

function clean(ids: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of ids ?? []) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build the exact ordered navigation for a completed save.
 *
 * Guarantees:
 *   - the queue never remains over the map (dismissAll precedes navigation)
 *   - exactly one navigation step is emitted (no duplicate sheets)
 *   - a multi-place save uses the grouped-map request, never a single focus
 */
export function planSaveCompletionNavigation(
  input: SaveCompletionInput,
): SaveCompletionNavigation {
  const created = clean(input.createdSavedPlaceIds);
  const createdSet = new Set(created);
  const duplicates = clean(input.duplicateSavedPlaceIds).filter((id) => !createdSet.has(id));
  const successful = [...created, ...duplicates];
  const steps: SaveCompletionStep[] = [];
  if (input.canDismiss) steps.push({ kind: 'dismissAll' });

  if (successful.length > 1) {
    if (!input.mapGroupId) {
      // Never pretend a multi-save is a single save. A caller should normally
      // provide a group request; this defensive fallback opens the map without
      // selecting an arbitrary place.
      steps.push({
        kind: 'replace',
        pathname: '/(tabs)/map',
        params: { placeSource: 'share_job_saved' },
      });
      return { steps, destination: 'group' };
    }
    const params: Record<string, string> = {
      mapGroupId: input.mapGroupId,
      placeSource: 'share_job_saved',
    };
    if (input.failedCount && input.failedCount > 0) {
      params.failedCount = String(input.failedCount);
    }
    steps.push({ kind: 'replace', pathname: '/(tabs)/map', params });
    return { steps, destination: 'group' };
  }

  if (successful.length === 1 && created.length === 1) {
    steps.push({
      kind: 'replace',
      pathname: '/(tabs)/map',
      params: { savedPlaceId: created[0]!, placeSource: 'share_job_saved' },
    });
    return { steps, destination: 'single' };
  }

  if (successful.length === 1 && duplicates.length === 1) {
    steps.push({
      kind: 'replace',
      pathname: '/(tabs)/map',
      params: { savedPlaceId: duplicates[0]!, placeSource: 'share_job_already_saved' },
    });
    return { steps, destination: 'existing' };
  }

  // Nothing was saved: do not navigate, and do not tear down the user's context.
  return { steps: [], destination: 'none' };
}

/** Execute the planner's ordered modal teardown + one map replacement. */
export function executeSaveCompletionNavigation(
  plan: SaveCompletionNavigation,
  router: SaveCompletionRouter,
  navigate = true,
): void {
  for (const step of plan.steps) {
    if (step.kind === 'dismissAll') {
      try {
        router.dismissAll();
      } catch {
        // Cold entry: no modal exists, so the following replacement still runs.
      }
    } else if (navigate) {
      router.replace({ pathname: step.pathname, params: step.params });
    }
  }
}

/**
 * Cross-surface guard for a save mutation, Realtime event, and notification
 * response racing to open the same place. A later deliberate open remains
 * possible after the short completion window.
 */
export function claimSaveCompletionSignal(
  savedPlaceIds: readonly string[],
  now = Date.now(),
): boolean {
  const ids = clean(savedPlaceIds).sort();
  if (ids.length === 0) return false;
  for (const [key, claimedAt] of recentCompletionSignals) {
    if (now - claimedAt > COMPLETION_SIGNAL_TTL_MS) recentCompletionSignals.delete(key);
  }
  const key = ids.join(':');
  const previous = recentCompletionSignals.get(key);
  if (previous != null && now - previous <= COMPLETION_SIGNAL_TTL_MS) return false;
  recentCompletionSignals.set(key, now);
  return true;
}

export function resetSaveCompletionSignalsForTests(): void {
  recentCompletionSignals.clear();
}

/** True when the plan leaves no modal covering the map. */
export function clearsQueueOverlay(plan: SaveCompletionNavigation, canDismiss: boolean): boolean {
  if (plan.destination === 'none') return true;
  return !canDismiss || plan.steps[0]?.kind === 'dismissAll';
}

/** Exactly one navigation happens per completed save. */
export function navigationStepCount(plan: SaveCompletionNavigation): number {
  return plan.steps.filter((step) => step.kind === 'replace').length;
}
