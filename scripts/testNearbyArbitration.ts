/**
 * scripts/testNearbyArbitration.ts
 *
 * Proves the global nearby-notification arbitration window added in
 * lib/notifications.ts (`reserveGlobalNearbyArbitrationSlot` /
 * `releaseGlobalNearbyArbitrationSlot`), which closes a burst gap the
 * per-place cooldown cannot: native OS geofence ENTER events for two
 * DIFFERENT, non-overlapping saved places can arrive as independent async
 * invocations of `NEARR_GEOFENCE_TASK` (lib/geofencing.ts) and — because JS
 * is single-threaded but non-blocking — can genuinely interleave at their
 * `await` points, each reading per-place cooldown state before either has
 * written its result. `checkProximity`'s single-winner selection only
 * bounds the POLLING path; it says nothing about two independent geofence
 * callbacks.
 *
 * The fix reuses the exact same dedupe gate (and its promise-chained mutex)
 * already proven for per-place dedupe in lib/placeNotificationDedupe.ts,
 * with one extra globally-scoped key and a short window. This file exercises
 * that REAL primitive directly — not lib/notifications.ts itself, which
 * cannot be imported under plain ts-node (a transitive Expo/RN dependency
 * breaks Node's module loader; see also scripts/testNearbyGroupRouting.ts,
 * which resorts to source-text checks against that same file for the same
 * reason). Core arbitration logic is proven here with real function calls
 * and real return values, never regex. A single, narrow source-text check
 * at the bottom confirms lib/notifications.ts actually wires the two
 * functions in at the right points — matching the existing pattern
 * scripts/testNearbyGroupRouting.ts already uses for integration facts
 * about that same file.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testNearbyArbitration.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPlaceNotificationDedupeGate } from '../lib/placeNotificationDedupe';

// Mirrors the constants in lib/notifications.ts (NEARBY_ARBITRATION_KEY /
// NEARBY_ARBITRATION_WINDOW_MS). Duplicated here — rather than imported —
// because that file cannot be imported under plain ts-node; the wiring
// check at the bottom of this file confirms the real values match.
const ARBITRATION_KEY = '__nearby_global_arbitration__';
const ARBITRATION_WINDOW_MS = 5_000;

class MemoryStore {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

async function reserve(gate: ReturnType<typeof createPlaceNotificationDedupeGate>, now: number) {
  return gate.checkAndRecord({
    savedPlaceId: ARBITRATION_KEY,
    triggerType: 'global',
    now,
    cooldownMs: ARBITRATION_WINDOW_MS,
    dedupeAcrossTriggers: false,
  });
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Two SEQUENTIAL native ENTER events for different places, moments
  //    apart, within the arbitration window -> only the first wins.
  //
  //    This models: user drives past place A (ENTER fires, notification
  //    A's send attempt reserves the slot) then place B a second later
  //    (ENTER fires, notification B's send attempt is suppressed).
  // -------------------------------------------------------------------------
  {
    const gate = createPlaceNotificationDedupeGate(new MemoryStore());
    const now = 1_000_000;

    const first = await reserve(gate, now);
    check('first nearby send in the window reserves the slot', first.status === 'allow');

    const second = await reserve(gate, now + 1_500); // 1.5s later, same window
    check(
      'a second nearby send 1.5s later (same window) is suppressed, not a burst',
      second.status === 'skipped_duplicate',
    );
  }

  // -------------------------------------------------------------------------
  // 2. Two CONCURRENT/interleaved native ENTER events at the SAME instant.
  //
  //    This is the actual race: two independent async callbacks both
  //    calling checkAndRecord before either has written its result. The
  //    gate's withLock mutex (lib/placeNotificationDedupe.ts) must
  //    serialize them so exactly one wins — never both.
  // -------------------------------------------------------------------------
  {
    const gate = createPlaceNotificationDedupeGate(new MemoryStore());
    const now = 2_000_000;

    const [resultA, resultB] = await Promise.all([reserve(gate, now), reserve(gate, now)]);
    const statuses = [resultA.status, resultB.status].sort();
    check(
      'two truly concurrent geofence ENTER events -> exactly one notification wins',
      statuses[0] === 'allow' && statuses[1] === 'skipped_duplicate',
      JSON.stringify({ resultA, resultB }),
    );
  }

  // -------------------------------------------------------------------------
  // 3. A LATER, genuinely separate notification (outside the window) is
  //    never interfered with.
  // -------------------------------------------------------------------------
  {
    const gate = createPlaceNotificationDedupeGate(new MemoryStore());
    const now = 3_000_000;

    const first = await reserve(gate, now);
    check('first send wins', first.status === 'allow');

    const stillBlocked = await reserve(gate, now + ARBITRATION_WINDOW_MS - 1);
    check('just inside the window is still suppressed', stillBlocked.status === 'skipped_duplicate');

    const later = await reserve(gate, now + ARBITRATION_WINDOW_MS + 1);
    check(
      'a later, unrelated notification just past the window is never blocked',
      later.status === 'allow',
    );
  }

  // -------------------------------------------------------------------------
  // 4. A FAILED send rolls the reservation back, so it never wrongly blocks
  //    a different, legitimate notification for the rest of the window.
  // -------------------------------------------------------------------------
  {
    const gate = createPlaceNotificationDedupeGate(new MemoryStore());
    const now = 4_000_000;

    const reserved = await reserve(gate, now);
    check('slot reserved before the (simulated) send attempt', reserved.status === 'allow');

    // Simulate: fireNotification() failed, so lib/notifications.ts rolls
    // the global reservation back exactly like it rolls back per-place ones.
    await gate.rollback(ARBITRATION_KEY, 'global');

    const retriedImmediately = await reserve(gate, now + 500);
    check(
      'a failed send releases the slot immediately, not for the rest of the window',
      retriedImmediately.status === 'allow',
    );
  }

  // -------------------------------------------------------------------------
  // 5. Wiring check — confirms lib/notifications.ts actually calls the two
  //    arbitration functions at the reserve/rollback points, and that the
  //    constants mirrored above match the real ones. This is an
  //    INTEGRATION fact, not the core logic (proven for real above) — same
  //    pattern scripts/testNearbyGroupRouting.ts already uses for this file.
  // -------------------------------------------------------------------------
  const notifications = readFileSync(join(process.cwd(), 'lib/notifications.ts'), 'utf8');
  assert.match(
    notifications,
    /const NEARBY_ARBITRATION_KEY = '__nearby_global_arbitration__';/,
    'the mirrored arbitration key matches the real constant',
  );
  assert.match(
    notifications,
    /const NEARBY_ARBITRATION_WINDOW_MS = 5_000;/,
    'the mirrored arbitration window matches the real constant',
  );
  assert.match(
    notifications,
    /const arbitration = await reserveGlobalNearbyArbitrationSlot\(now\);/,
    'sendPlaceReminderNotificationOnce reserves the global slot before doing anything else',
  );
  assert.match(
    notifications,
    /await releaseGlobalNearbyArbitrationSlot\(\);\s*\n\s*return \{ status: 'failed', reason: 'send_failed' \};/,
    'a failed fireNotification() releases the global slot',
  );
  console.log('PASS arbitration wiring matches lib/notifications.ts');

  console.log('');
  if (failures === 0) {
    console.log('ALL nearby-arbitration tests passed.');
    process.exit(0);
  }
  console.log(`${failures} nearby-arbitration test(s) FAILED.`);
  process.exit(1);
}

void main();
