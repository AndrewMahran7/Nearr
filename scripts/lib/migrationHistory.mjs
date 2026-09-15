import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATION_FILE = /^(\d{14})_(.+)\.sql$/;

export function gitBlobSha(contents) {
  const normalized = contents.toString('utf8').replace(/\r\n/g, '\n');
  const bytes = Buffer.from(normalized, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

export function splitSqlStatements(contents) {
  const sql = contents.toString('utf8').replace(/\r\n/g, '\n');
  const statements = [];
  let start = 0;
  let index = 0;
  let state = 'plain';
  let dollarTag = null;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (state === 'single') {
      if (current === "'" && next === "'") index += 2;
      else if (current === "'") { state = 'plain'; index += 1; }
      else index += 1;
      continue;
    }
    if (state === 'double') {
      if (current === '"' && next === '"') index += 2;
      else if (current === '"') { state = 'plain'; index += 1; }
      else index += 1;
      continue;
    }
    if (state === 'line-comment') {
      if (current === '\n') state = 'plain';
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') { state = 'plain'; index += 2; }
      else index += 1;
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = 'plain';
        dollarTag = null;
      } else index += 1;
      continue;
    }

    if (current === "'") { state = 'single'; index += 1; continue; }
    if (current === '"') { state = 'double'; index += 1; continue; }
    if (current === '-' && next === '-') { state = 'line-comment'; index += 2; continue; }
    if (current === '/' && next === '*') { state = 'block-comment'; index += 2; continue; }
    if (current === '$') {
      const match = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(index));
      if (match) { dollarTag = match[0]; state = 'dollar'; index += dollarTag.length; continue; }
    }
    if (current === ';') {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

export function registryStatementFingerprint(contents) {
  const statements = splitSqlStatements(contents);
  return {
    statementCount: statements.length,
    md5: createHash('md5')
      .update(statements.join('\n--statement-boundary--\n'))
      .digest('hex'),
  };
}

export function inventoryLocalMigrations(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const entries = files.map((filename) => {
    const match = MIGRATION_FILE.exec(filename);
    if (!match) throw new Error(`Invalid migration filename: ${filename}`);
    const contents = readFileSync(path.join(migrationsDir, filename));
    return {
      version: match[1],
      name: match[2],
      filename,
      blobSha: gitBlobSha(contents),
      registryFingerprint: registryStatementFingerprint(contents),
    };
  });
  assertUniqueAndMonotonic(entries);
  return entries;
}

export function assertUniqueAndMonotonic(entries) {
  const seen = new Set();
  let previous = null;
  for (const entry of entries) {
    if (seen.has(entry.version)) throw new Error(`Duplicate migration version: ${entry.version}`);
    if (previous !== null && entry.version <= previous) {
      throw new Error(`Migration sequence is not strictly monotonic: ${previous} then ${entry.version}`);
    }
    seen.add(entry.version);
    previous = entry.version;
  }
}

export function readDevelopmentHistoryConfig(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.schemaVersion !== 1 || config.environment !== 'development') {
    throw new Error('Invalid Development migration-history configuration');
  }
  return config;
}

export function assertRequiredLocalMigrations(entries, required) {
  const byVersion = new Map(entries.map((entry) => [entry.version, entry]));
  for (const expected of required) {
    const actual = byVersion.get(expected.version);
    if (!actual) throw new Error(`Required Development migration is missing: ${expected.version}`);
    if (actual.filename !== expected.filename) {
      throw new Error(`Migration ${expected.version} filename mismatch: ${actual.filename}`);
    }
    if (actual.blobSha !== expected.blobSha) {
      throw new Error(`Migration ${expected.version} blob mismatch: ${actual.blobSha}`);
    }
    if (
      actual.registryFingerprint.statementCount !== expected.registryStatementCount ||
      actual.registryFingerprint.md5 !== expected.registryStatementMd5
    ) {
      throw new Error(
        `Migration ${expected.version} remote-statement fingerprint mismatch: ` +
        `${actual.registryFingerprint.statementCount}/${actual.registryFingerprint.md5}`,
      );
    }
  }
}

export function parseSupabaseMigrationList(output) {
  const jsonStart = output.indexOf('{"migrations"');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(output.slice(jsonStart));
      if (Array.isArray(parsed.migrations)) {
        return [...new Set(
          parsed.migrations
            .map((migration) => migration?.remote)
            .filter((version) => typeof version === 'string' && /^\d{14}$/.test(version)),
        )].sort();
      }
    } catch {
      // Fall through to the human-readable table parser.
    }
  }
  const remote = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.split('|').map((value) => value.trim());
    if (columns.length < 2) continue;
    if (/^\d{14}$/.test(columns[1])) remote.push(columns[1]);
  }
  return [...new Set(remote)].sort();
}

export function assertRemoteHistoryKnown(entries, remoteVersions, requiredApplied) {
  const local = new Set(entries.map((entry) => entry.version));
  const remote = new Set(remoteVersions);
  const unknown = remoteVersions.filter((version) => !local.has(version));
  if (unknown.length > 0) {
    throw new Error(`Remote contains unknown migration version(s): ${unknown.join(', ')}`);
  }
  const missingApplied = requiredApplied
    .map((entry) => entry.version)
    .filter((version) => !remote.has(version));
  if (missingApplied.length > 0) {
    throw new Error(
      `Required historical Development migration is not remotely applied: ${missingApplied.join(', ')}`,
    );
  }
  return entries.filter((entry) => !remote.has(entry.version)).map((entry) => entry.version);
}
