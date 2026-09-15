import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertRemoteHistoryKnown,
  assertRequiredLocalMigrations,
  assertUniqueAndMonotonic,
  inventoryLocalMigrations,
  parseSupabaseMigrationList,
  readDevelopmentHistoryConfig,
} from './lib/migrationHistory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = readDevelopmentHistoryConfig(
  path.join(root, 'config', 'development-migration-history.json'),
);
const migrations = inventoryLocalMigrations(path.join(root, 'supabase', 'migrations'));

assert.equal(config.supabaseProjectRef, 'qnfxnmvxpjzfydgudtvs');
assert.equal(config.requiredAppliedMigrations.length, 7);
assertRequiredLocalMigrations(migrations, config.requiredAppliedMigrations);
console.log('PASS canonical files, blob SHAs, and remote statement fingerprints are exact');

assert.throws(
  () => assertUniqueAndMonotonic([
    { version: '20260910000001' },
    { version: '20260910000001' },
  ]),
  /Duplicate migration version/,
);
console.log('PASS duplicate migration versions are rejected');

assert.throws(
  () => assertUniqueAndMonotonic([
    { version: '20260910000002' },
    { version: '20260910000001' },
  ]),
  /not strictly monotonic/,
);
console.log('PASS non-monotonic migration ordering is rejected');

const remoteList = `\n Local          | Remote         | Time (UTC)\n----------------|----------------|---------------------\n 20260910000001 | 20260910000001 | 2026-09-10 00:00:01\n                | 20260910000002 | 2026-09-10 00:00:02\n`;
assert.deepEqual(parseSupabaseMigrationList(remoteList), ['20260910000001', '20260910000002']);
const remoteJsonList = `Initialising login role...\n{"migrations":[{"local":"20260910000001","remote":"20260910000001"},{"local":"20260914000002","remote":""}],"message":"Migrations listed"}`;
assert.deepEqual(parseSupabaseMigrationList(remoteJsonList), ['20260910000001']);
console.log('PASS Supabase table and JSON migration-list output is parsed deterministically');

assert.throws(
  () => assertRemoteHistoryKnown(migrations, ['20991231000000'], []),
  /Remote contains unknown migration/,
);
console.log('PASS deploy preflight rejects remote-only unknown migrations');

assert.throws(
  () => assertRemoteHistoryKnown(migrations, [], config.requiredAppliedMigrations),
  /not remotely applied/,
);
console.log('PASS deploy preflight refuses to replay required historical Development migrations');

console.log(`PASS Development migration reconciliation contract (${migrations.length} local migrations)`);
