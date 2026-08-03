// services/media-worker/src/config/loadEnvFiles.ts
//
// Deterministic .env auto-loader for the LOCAL media:inspect CLI (server-side
// only). So the operator never has to `$env:...` keys into each session.
//
// Precedence (HIGHEST wins; an already-defined process var is never overwritten):
//   1. existing process.env
//   2. services/media-worker/.env.local
//   3. <repo-root>/.env.local
//   4. services/media-worker/.env
//   5. <repo-root>/.env
//
// Implementation: process.env stays authoritative; each file (in precedence
// order) only FILLS keys that are still unset, so a higher-precedence file sets
// a key before a lower one can. Never logs values.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse `.env` text into a flat map. Handles `export `, `#` comments, quoted
 *  values, and trailing inline comments on unquoted values. Never throws. */
export function parseEnvContent(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2] ?? '';
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash);
      val = val.trim();
    }
    out[key] = val;
  }
  return out;
}

/** The env files in precedence order (highest first). */
export function envFilePrecedence(workerDir: string, repoRoot: string): string[] {
  return [
    path.join(workerDir, '.env.local'),
    path.join(repoRoot, '.env.local'),
    path.join(workerDir, '.env'),
    path.join(repoRoot, '.env'),
  ];
}

export type EnvFileCheck = { path: string; exists: boolean; loadedKeys: number };

export type LoadEnvOptions = {
  workerDir?: string;
  repoRoot?: string;
  /** Mutable env map (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Injected reader for tests; returns null when the file is absent. */
  read?: (p: string) => string | null;
};

/**
 * Load the env files into `env`, filling only keys that are unset/empty so the
 * precedence above holds. Returns which files were checked/loaded (paths only —
 * never values) for the sanitized readiness summary.
 */
export function loadEnvFiles(opts: LoadEnvOptions = {}): {
  checked: EnvFileCheck[];
  workerDir: string;
  repoRoot: string;
} {
  const workerDir = opts.workerDir ?? path.resolve(fileURLToPath(import.meta.url), '../../..');
  const repoRoot = opts.repoRoot ?? path.resolve(workerDir, '../..');
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const read = opts.read ?? ((p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null));

  const checked: EnvFileCheck[] = [];
  for (const file of envFilePrecedence(workerDir, repoRoot)) {
    const content = read(file);
    if (content == null) {
      checked.push({ path: file, exists: false, loadedKeys: 0 });
      continue;
    }
    const parsed = parseEnvContent(content);
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (env[k] === undefined || env[k] === '') {
        env[k] = v;
        loaded += 1;
      }
    }
    checked.push({ path: file, exists: true, loadedKeys: loaded });
  }
  return { checked, workerDir, repoRoot };
}
