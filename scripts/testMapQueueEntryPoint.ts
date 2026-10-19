/** Activity entry-point visibility and route contract. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHARE_JOBS_ROUTE } from '../lib/shareRoutes';
import { canReachShareQueue } from '../lib/shareQueueAccess';
import { resolveFieldnotesMapPresentation } from '../lib/fieldnotesPresentation';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const map = read('app/(tabs)/map.tsx');
const button = read('components/map/ShareQueueButton.tsx');

assert.ok(map.includes('<ShareQueueButton />'));
assert.ok(button.includes(`router.push('${SHARE_JOBS_ROUTE}')`));
assert.ok(button.includes('useActiveQueueCount'));
assert.ok(button.includes('accessibilityLabel'));
assert.ok(!/^\s*if \(!isAsyncShareJobsEnabled\(\)\) return null;/m.test(button));
assert.ok(button.includes('canReachShareQueue'));

const real = { signedIn: true, isDevSession: false, isDemoMode: false };
assert.equal(canReachShareQueue(real), true);
assert.equal(canReachShareQueue({ ...real, signedIn: false }), false);
assert.equal(canReachShareQueue({ ...real, isDevSession: true }), false);
assert.equal(canReachShareQueue({ ...real, isDemoMode: true }), false);

const base = {
  searchVisible: false,
  nearbyExplorerActive: false,
  hasSelectedPlace: false,
  expandedPlace: false,
  savedLibraryExpanded: false,
  sourceGroupActive: false,
  onboardingOwnsMap: false,
};
assert.equal(resolveFieldnotesMapPresentation(base).showActivity, true);
assert.equal(resolveFieldnotesMapPresentation({ ...base, hasSelectedPlace: true }).showActivity, true);
const expanded = resolveFieldnotesMapPresentation({ ...base, hasSelectedPlace: true, expandedPlace: true });
assert.equal(expanded.showActivity, false, 'expanded detail owns the More corner');
assert.equal(expanded.activityPointerEvents, 'none', 'no invisible Activity target remains');
assert.equal(resolveFieldnotesMapPresentation({ ...base, searchVisible: true }).showActivity, false);
assert.equal(resolveFieldnotesMapPresentation({ ...base, nearbyExplorerActive: true }).showActivity, false);
assert.equal(resolveFieldnotesMapPresentation({ ...base, savedLibraryExpanded: true }).showActivity, false);

assert.match(map, /\{fieldnotesPresentation\.showActivity \? \(/);
assert.match(map, /pointerEvents=\{fieldnotesPresentation\.activityPointerEvents === 'auto' \? 'box-none' : 'none'\}/);
assert.match(map, /queueChrome: \{[\s\S]{0,220}top: insetTop \+ Spacing\.md,[\s\S]{0,80}right: Spacing\.lg,/);
assert.match(read('components/map/MapBottomSheet.tsx'), /<ShareQueueButton \/>/, 'Saved library retains its Activity entry');

const hook = read('hooks/useShareJobs.ts');
assert.ok(hook.includes('canReachShareQueue'));
assert.ok(!hook.includes('isAsyncShareJobsEnabled'));
for (const writePath of ['app/share.tsx', 'ShareExtension.tsx']) {
  assert.ok(read(writePath).includes('isAsyncShareJobsEnabled()'));
}

console.log('PASS map Activity entry point: reachable on map, suppressed under owned surfaces, pointer-safe');
