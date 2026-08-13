import assert from 'node:assert/strict';

import {
  clearsQueueOverlay,
  claimSaveCompletionSignal,
  executeSaveCompletionNavigation,
  navigationStepCount,
  planSaveCompletionNavigation,
  resetSaveCompletionSignalsForTests,
} from '../lib/saveCompletionNavigation';

// ---- manual save closes the queue -----------------------------------------
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-1'],
    canDismiss: true,
  });
  assert.equal(plan.steps[0]?.kind, 'dismissAll', 'the queue stack is dismissed first');
  assert.equal(plan.destination, 'single');
  assert.ok(clearsQueueOverlay(plan, true), 'no modal is left covering the map');
}

// ---- map focuses the saved place ------------------------------------------
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-1'],
    canDismiss: true,
  });
  const nav = plan.steps.find((s) => s.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace');
  assert.equal(nav.pathname, '/(tabs)/map');
  assert.equal(nav.params.savedPlaceId, 'sp-1');
  assert.equal(nav.params.placeSource, 'share_job_saved');
}

// ---- details open once / no double fire ------------------------------------
for (const canDismiss of [true, false]) {
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-1'],
    canDismiss,
  });
  assert.equal(navigationStepCount(plan), 1, 'exactly one navigation per save');
}

// A cold deep-link entry (nothing to dismiss) still navigates exactly once.
{
  const plan = planSaveCompletionNavigation({ createdSavedPlaceIds: ['sp-1'], canDismiss: false });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'replace');
  assert.ok(clearsQueueOverlay(plan, false));
}

// ---- auto-save navigation does not double fire -----------------------------
{
  const a = planSaveCompletionNavigation({ createdSavedPlaceIds: ['sp-1'], canDismiss: true });
  const b = planSaveCompletionNavigation({ createdSavedPlaceIds: ['sp-1'], canDismiss: true });
  assert.deepEqual(a, b, 'planning is pure and repeatable');
  assert.equal(navigationStepCount(a) + 0, 1);
}

// ---- multi-place save opens grouped map ------------------------------------
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-1', 'sp-2', 'sp-3'],
    canDismiss: true,
    mapGroupId: 'group-abc',
    failedCount: 1,
  });
  assert.equal(plan.destination, 'group');
  const nav = plan.steps.find((s) => s.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace');
  assert.equal(nav.params.mapGroupId, 'group-abc');
  assert.equal(nav.params.failedCount, '1');
  assert.equal(nav.params.savedPlaceId, undefined, 'group focus does not also pin one place');
  assert.equal(navigationStepCount(plan), 1);
  assert.ok(clearsQueueOverlay(plan, true));
}

// A multi-save without a usable group request still clears the queue.
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-1', 'sp-2'],
    canDismiss: true,
    mapGroupId: null,
  });
  assert.equal(plan.destination, 'group');
  assert.equal(plan.steps[0]?.kind, 'dismissAll');
  assert.equal(navigationStepCount(plan), 1);
  const nav = plan.steps.find((step) => step.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace');
  assert.equal(nav.params.savedPlaceId, undefined, 'multi-save never focuses an arbitrary place');
}

// ---- shared executor preserves order and navigates once -------------------
{
  const calls: string[] = [];
  const plan = planSaveCompletionNavigation({ createdSavedPlaceIds: ['sp-1'], canDismiss: true });
  executeSaveCompletionNavigation(plan, {
    dismissAll: () => calls.push('dismissAll'),
    replace: (destination) => calls.push(`replace:${destination.params.savedPlaceId}`),
  });
  assert.deepEqual(calls, ['dismissAll', 'replace:sp-1']);

  const duplicateCalls: string[] = [];
  executeSaveCompletionNavigation(plan, {
    dismissAll: () => duplicateCalls.push('dismissAll'),
    replace: () => duplicateCalls.push('replace'),
  }, false);
  assert.deepEqual(duplicateCalls, ['dismissAll'], 'duplicate signal still clears a stale modal');
}

// ---- save/realtime/notification duplicate signals navigate once -----------
resetSaveCompletionSignalsForTests();
assert.equal(claimSaveCompletionSignal(['sp-1'], 1_000), true);
assert.equal(claimSaveCompletionSignal(['sp-1'], 1_100), false, 'duplicate completion is rejected');
assert.equal(claimSaveCompletionSignal(['sp-1'], 9_001), true, 'a later deliberate open is allowed');
assert.equal(claimSaveCompletionSignal([], 9_002), false);

// ---- already saved returns to the existing place, never a duplicate --------
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: [],
    duplicateSavedPlaceIds: ['sp-existing'],
    canDismiss: true,
  });
  assert.equal(plan.destination, 'existing');
  const nav = plan.steps.find((s) => s.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace');
  assert.equal(nav.params.savedPlaceId, 'sp-existing');
  assert.equal(nav.params.placeSource, 'share_job_already_saved');
}

// A mixed new + existing multi-save still uses group focus.
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['sp-new'],
    duplicateSavedPlaceIds: ['sp-existing'],
    canDismiss: true,
    mapGroupId: 'group-mixed',
  });
  assert.equal(plan.destination, 'group');
  const nav = plan.steps.find((step) => step.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace' && nav.params.mapGroupId === 'group-mixed');
  assert.equal(nav && nav.kind === 'replace' ? nav.params.savedPlaceId : undefined, undefined);
}

// ---- nothing saved: keep the user where they are ---------------------------
{
  const plan = planSaveCompletionNavigation({ createdSavedPlaceIds: [], canDismiss: true });
  assert.equal(plan.destination, 'none');
  assert.equal(plan.steps.length, 0, 'a failed save never tears down context');
  assert.equal(navigationStepCount(plan), 0);
}

// Malformed / duplicate ids are normalised rather than navigated to.
{
  const plan = planSaveCompletionNavigation({
    createdSavedPlaceIds: ['  ', '', 'sp-1', 'sp-1'],
    canDismiss: true,
  });
  assert.equal(plan.destination, 'single');
  const nav = plan.steps.find((s) => s.kind === 'replace');
  assert.ok(nav && nav.kind === 'replace' && nav.params.savedPlaceId === 'sp-1');
}

console.log('PASS save completion navigation dismisses the queue and focuses the map exactly once');
