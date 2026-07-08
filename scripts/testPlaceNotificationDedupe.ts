/**
 * scripts/testPlaceNotificationDedupe.ts
 *
 * Focused tests for lib/placeNotificationDedupe.ts.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlaceNotificationDedupe.ts
 */

import {
  PLACE_NOTIFICATION_DEDUPE_WINDOW_MS,
  createPlaceNotificationDedupeGate,
} from '../lib/placeNotificationDedupe';

class MemoryStore {
  private readonly map = new Map<string, string>();
  public failReads = false;
  public failWrites = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('read_failed');
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('write_failed');
    this.map.set(key, value);
  }

  setRaw(key: string, value: string): void {
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

async function run(): Promise<void> {
  const store = new MemoryStore();
  const gate = createPlaceNotificationDedupeGate(store);
  const now = 1_000_000;

  // 1) First notification for place A sends.
  {
    const first = await gate.checkAndRecord({
      savedPlaceId: 'place-a',
      triggerType: 'background_location',
      now,
    });
    check('first send for place A is allowed', first.status === 'allow');
  }

  // 2) Immediate second notification for place A same trigger skips.
  {
    const second = await gate.checkAndRecord({
      savedPlaceId: 'place-a',
      triggerType: 'background_location',
      now: now + 10,
    });
    check(
      'immediate second send for place A same trigger is skipped duplicate',
      second.status === 'skipped_duplicate' && second.savedPlaceId === 'place-a',
      JSON.stringify(second),
    );
  }

  // 3) Place A different trigger behavior can be configured.
  {
    const crossTriggerDefault = await gate.checkAndRecord({
      savedPlaceId: 'place-a',
      triggerType: 'geofence_enter',
      now: now + 20,
    });
    check(
      'place A different trigger is skipped by default cross-trigger dedupe',
      crossTriggerDefault.status === 'skipped_duplicate',
      JSON.stringify(crossTriggerDefault),
    );

    const crossTriggerAllowed = await gate.checkAndRecord({
      savedPlaceId: 'place-a',
      triggerType: 'geofence_enter',
      now: now + 30,
      dedupeAcrossTriggers: false,
    });
    check(
      'place A different trigger can be allowed when cross-trigger dedupe is disabled',
      crossTriggerAllowed.status === 'allow',
      JSON.stringify(crossTriggerAllowed),
    );
  }

  // 4) Place B still sends.
  {
    const placeB = await gate.checkAndRecord({
      savedPlaceId: 'place-b',
      triggerType: 'background_location',
      now: now + 40,
    });
    check('place B send is allowed', placeB.status === 'allow', JSON.stringify(placeB));
  }

  // 5) After cooldown, place A sends again.
  {
    const afterCooldown = await gate.checkAndRecord({
      savedPlaceId: 'place-a',
      triggerType: 'background_location',
      now: now + PLACE_NOTIFICATION_DEDUPE_WINDOW_MS + 1,
    });
    check('place A sends again after cooldown', afterCooldown.status === 'allow');
  }

  // 6) Missing savedPlaceId skips.
  {
    const missing = await gate.checkAndRecord({
      savedPlaceId: '',
      triggerType: 'background_location',
      now: now + 50,
    });
    check(
      'missing savedPlaceId is skipped_disabled',
      missing.status === 'skipped_disabled' && missing.reason === 'missing_saved_place_id',
      JSON.stringify(missing),
    );
  }

  // 7) Storage read failure fails safe.
  {
    const failingStore = new MemoryStore();
    failingStore.failReads = true;
    const failingGate = createPlaceNotificationDedupeGate(failingStore);
    const failedRead = await failingGate.checkAndRecord({
      savedPlaceId: 'place-c',
      triggerType: 'background_location',
      now,
    });
    check(
      'storage read failure returns failed',
      failedRead.status === 'failed' && failedRead.reason === 'storage_read_failed',
      JSON.stringify(failedRead),
    );
  }

  // 7b) Storage parse failure fails safe.
  {
    const parseStore = new MemoryStore();
    parseStore.setRaw('nearr:place-notification-dedupe:v1', '{"bad":true}');
    const parseGate = createPlaceNotificationDedupeGate(parseStore);
    const failedParse = await parseGate.checkAndRecord({
      savedPlaceId: 'place-c',
      triggerType: 'background_location',
      now,
    });
    check(
      'storage parse failure returns failed',
      failedParse.status === 'failed' && failedParse.reason === 'storage_parse_failed',
      JSON.stringify(failedParse),
    );
  }

  // 8) Old dedupe entries expire/cleanup.
  {
    const cleanupStore = new MemoryStore();
    const cleanupGate = createPlaceNotificationDedupeGate(cleanupStore, {
      retentionMs: 1_000,
      storageKey: 'nearr:place-notification-dedupe:test-cleanup',
    });
    const base = 10_000;
    await cleanupGate.checkAndRecord({
      savedPlaceId: 'old-place',
      triggerType: 'background_location',
      now: base,
      dedupeAcrossTriggers: false,
    });
    await cleanupGate.checkAndRecord({
      savedPlaceId: 'new-place',
      triggerType: 'background_location',
      now: base + 5_000,
      dedupeAcrossTriggers: false,
    });
    const snapshot = await cleanupGate.snapshotForTests(base + 5_000);
    const keys = Object.keys(snapshot);
    const hasOld = keys.some((key) => key.includes('old-place'));
    const hasNew = keys.some((key) => key.includes('new-place'));
    check(
      'old dedupe entries are expired during cleanup',
      !hasOld && hasNew,
      JSON.stringify(keys),
    );
  }
}

void run().then(() => {
  console.log('');
  if (failures === 0) {
    console.log('ALL place-notification-dedupe tests passed.');
    process.exit(0);
  }
  console.log(`${failures} place-notification-dedupe test(s) FAILED.`);
  process.exit(1);
});
