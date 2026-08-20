/**
 * scripts/devTarget.mjs
 *
 * Shared target resolution for every script that writes to Supabase.
 *
 * Two scripts need the identical answer to "which project am I about to
 * change, and can I prove it is not production?" — scripts/deployFunctions.mjs
 * and scripts/pushDevDatabase.mjs. Keeping the rule in one place means a future
 * writer script inherits the guard instead of re-deriving (and weakening) it.
 *
 * Project refs are not secrets — they appear in every client bundle's manifest
 * — and naming both here is the point: a guard can only refuse production if it
 * knows which ref production is.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PRODUCTION_REF = 'rlqvxdwtetxsqxhqztkw'; // Nearr
export const EXPECTED_DEV_REF = 'qnfxnmvxpjzfydgudtvs'; // Nearr-Dev

/**
 * Minimal .env reader.
 *
 * Node does NOT load .env files, and npm does not either — so a script reading
 * only process.env silently misses NEARR_DEV_SUPABASE_REF from .env.local and
 * then refuses to run (or, worse, falls back to something else). Expo's
 * precedence is mirrored here: .env.local > .env > process.env.
 */
export function readLocalEnv() {
  const out = { ...process.env };
  for (const file of ['.env', '.env.local']) {
    const full = path.join(REPO_ROOT, file);
    if (!existsSync(full)) continue;
    for (const rawLine of readFileSync(full, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[line.slice(0, eq).trim()] = value;
    }
  }
  return out;
}

/**
 * Resolve the development project ref and prove it is safe to write to.
 *
 * Returns the ref, or calls `onFail(message)` — which is expected not to
 * return — when the target cannot be proven. Never falls back to the linked
 * project: the 2026-08-19 audit found the CLI linked to production, which is
 * exactly the fallback that must not exist.
 */
export function resolveDevProjectRef({ explicitRef, onFail }) {
  const env = readLocalEnv();
  const projectRef = (explicitRef || env.NEARR_DEV_SUPABASE_REF || '').trim();

  if (!projectRef) {
    onFail(
      'No development project ref.\n' +
        'Set NEARR_DEV_SUPABASE_REF in .env.local, or pass --project-ref <ref>.\n' +
        'This never falls back to the linked project, because the linked project\n' +
        'has been production before.',
    );
  }

  if (projectRef === PRODUCTION_REF) {
    onFail(
      'REFUSING: the target ref is the PRODUCTION project (Nearr).\n' +
        'Development scripts only ever write to development. Production changes are\n' +
        'made deliberately, by hand — see docs/DEVELOPMENT_WORKFLOW.md -> Production promotion.',
    );
  }

  if (projectRef !== EXPECTED_DEV_REF) {
    onFail(
      `REFUSING: ref "${projectRef}" is neither the production project nor the\n` +
        `expected development project (${EXPECTED_DEV_REF}).\n` +
        'An unrecognised target cannot be proven safe. If Nearr-Dev was recreated,\n' +
        'update EXPECTED_DEV_REF in scripts/devTarget.mjs in the same commit.',
    );
  }

  return projectRef;
}

/** The project the Supabase CLI would use for `--linked` commands, or ''. */
export function linkedProjectRef() {
  const file = path.join(REPO_ROOT, 'supabase', '.temp', 'project-ref');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** Human label for a ref, for report lines. Never used for control flow. */
export function describeRef(ref) {
  if (ref === PRODUCTION_REF) return `${ref}  (Nearr — PRODUCTION)`;
  if (ref === EXPECTED_DEV_REF) return `${ref}  (Nearr-Dev)`;
  return `${ref}  (unrecognised)`;
}
