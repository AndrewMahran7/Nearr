/**
 * scripts/recognitionAuditPreflight.ts
 *
 * GATE for any LIVE recognition benchmark or replay.
 *
 * A recognition benchmark is worthless — worse, actively misleading — if it
 * silently ran against the Legacy Places API. Legacy has no `primaryType`
 * contract at all, and `primaryType` is what scoring and the geographic guards
 * read. We learned this the expensive way: the local `.env` had
 *
 *     GOOGLE_PLACES_KEY === EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
 *
 * so every local experiment authenticated with the CLIENT Maps key, which
 * Places API (New) correctly refuses with 403 API_KEY_SERVICE_BLOCKED. Nearr
 * fell back to Legacy exactly as designed, every search "worked", and three
 * sessions of local measurements were quietly taken against the wrong provider.
 *
 * Production is fine and must keep its Legacy fallback — a user losing a save
 * because Google hiccuped is a real cost. An AUDIT has the opposite priority:
 * it would rather stop than produce a number nobody can trust. So this gate is
 * strict where the product is forgiving.
 *
 * Run directly:
 *   npm run audit:recognition-preflight
 *
 * Or from a future replay tool, before URL #1:
 *   await assertRecognitionAuditReady();
 */

import * as path from 'path';
import { searchPlaces } from '../supabase/functions/process-share-link/places/googlePlaces';
import type { SearchPlacesResult } from '../supabase/functions/process-share-link/places/googlePlaces';

/** A stable, unambiguous business that Google types confidently. Doubles as the
 *  Brooklyn City Pizzeria regression fixture used elsewhere in the suite. */
export const PREFLIGHT_CONTROL_QUERY = 'Brooklyn City Pizzeria Laguna Niguel California';

export type PreflightStatus = 'pass' | 'fail';

export type PreflightCheck = {
  id: string;
  label: string;
  status: PreflightStatus;
  /** Human detail. NEVER contains a key value — digests are truncated. */
  detail: string;
};

export type PreflightResult = {
  ready: boolean;
  checks: PreflightCheck[];
};

export type PreflightDeps = {
  /** Environment source. Injected so tests never touch the real process env. */
  env?: Record<string, string | undefined>;
  /** Provider search. Injected so tests never hit the network. */
  search?: (query: string, key: string) => Promise<SearchPlacesResult>;
};

/**
 * First 8 hex chars of a SHA-256 digest — enough to say "these two differ"
 * without being enough to do anything with. Never persisted, never sent
 * anywhere; this is developer tooling output only.
 */
function digestPrefix(value: string): string {
  // Lazy require so this module stays importable in environments without the
  // node crypto typings wired up.
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

export async function runRecognitionAuditPreflight(
  deps: PreflightDeps = {},
): Promise<PreflightResult> {
  const env = deps.env ?? process.env;
  const search = deps.search ?? ((q: string, k: string) => searchPlaces(q, k));
  const checks: PreflightCheck[] = [];
  const add = (id: string, label: string, status: PreflightStatus, detail: string) => {
    checks.push({ id, label, status, detail });
    return status === 'pass';
  };

  const serverKey = (env.GOOGLE_PLACES_KEY ?? '').trim();
  const clientKey = (env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();

  // ---- 1. A server key must exist. Never fall back to the client key. -----
  if (
    !add(
      'server_key_present',
      'GOOGLE_PLACES_KEY is configured',
      serverKey ? 'pass' : 'fail',
      serverKey
        ? `present (digest ${digestPrefix(serverKey)}…)`
        : 'absent — configure a server-side development Places key with Places API (New) access',
    )
  ) {
    return { ready: false, checks };
  }

  add(
    'client_key_present',
    'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is configured',
    clientKey ? 'pass' : 'pass',
    clientKey ? `present (digest ${digestPrefix(clientKey)}…)` : 'absent (not required for audits)',
  );

  // ---- 2. The two keys must be distinct. ---------------------------------
  // Equality is fatal in BOTH directions and we cannot tell which one happened
  // from here, so it fails closed. If the client key was copied into the server
  // slot, every audit silently measures Legacy. If the server key was copied
  // into the client slot, a Places-capable server key is being compiled into
  // the mobile bundle, because EXPO_PUBLIC_* is published to the client.
  if (clientKey && serverKey === clientKey) {
    add(
      'keys_distinct',
      'Server and client keys are different',
      'fail',
      `identical (both ${digestPrefix(serverKey)}…) — a client Maps key cannot call Places API (New), ` +
        'and a server Places key must never live in an EXPO_PUBLIC_* variable',
    );
    return { ready: false, checks };
  }
  add(
    'keys_distinct',
    'Server and client keys are different',
    'pass',
    clientKey ? 'yes' : 'no client key set to collide with',
  );

  // ---- 3. Places API (New) must actually answer. --------------------------
  // The authoritative check. Everything above is a proxy for this one.
  let result: SearchPlacesResult;
  try {
    result = await search(PREFLIGHT_CONTROL_QUERY, serverKey);
  } catch (err) {
    add('places_new_probe', 'Places API (New) control query succeeds', 'fail', `probe threw: ${describeError(err)}`);
    return { ready: false, checks };
  }

  if (!result.ok) {
    add(
      'places_new_probe',
      'Places API (New) control query succeeds',
      'fail',
      `provider error (${result.reason}${result.status ? ` ${result.status}` : ''})`,
    );
    return { ready: false, checks };
  }
  add('places_new_probe', 'Places API (New) control query succeeds', 'pass', `${result.results.length} candidate(s)`);

  // ---- 4. It must have been served by the NEW surface. --------------------
  // A green probe is not enough: `searchPlaces` falls back to Legacy on a
  // service-blocked key and still returns ok:true. That is correct for the
  // product and unacceptable for an audit.
  if (result.apiPath !== 'places_new') {
    add(
      'provider_path_is_new',
      'Control query was served by Places API (New)',
      'fail',
      result.apiPath === 'places_legacy'
        ? `served by Legacy (fallbackReason=${result.fallbackReason ?? 'unknown'}) — the server key cannot call Places API (New)`
        : 'provider path not reported — cannot confirm the intended surface',
    );
    return { ready: false, checks };
  }
  add('provider_path_is_new', 'Control query was served by Places API (New)', 'pass', 'places_new');

  // ---- 5. The richer schema must actually be arriving. --------------------
  // The end we care about: not "New answered" but "New's extra field survived
  // normalization into the candidate the resolver will score".
  const withPrimaryType = result.results.filter((c) => !!c.primaryType).length;
  add(
    'primary_type_present',
    'Control candidates expose primaryType',
    withPrimaryType > 0 ? 'pass' : 'fail',
    withPrimaryType > 0
      ? `${withPrimaryType}/${result.results.length} candidate(s), e.g. ${result.results.find((c) => c.primaryType)!.primaryType}`
      : 'no candidate carried primaryType — the New schema is not reaching the resolver',
  );

  return { ready: checks.every((c) => c.status === 'pass'), checks };
}

function describeError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  // Defensive: an error text must never carry a key. Truncate hard.
  return message.slice(0, 120);
}

/**
 * Contract for benchmark/replay tooling: call once, before the first URL.
 * Throws with the failing checks rather than letting a batch produce numbers
 * measured against the wrong provider.
 */
export async function assertRecognitionAuditReady(deps: PreflightDeps = {}): Promise<void> {
  const result = await runRecognitionAuditPreflight(deps);
  if (result.ready) return;
  const failed = result.checks.filter((c) => c.status === 'fail');
  throw new Error(
    'Recognition audit blocked — the local provider path is not trustworthy:\n' +
      failed.map((c) => `  ✗ ${c.label}: ${c.detail}`).join('\n'),
  );
}

export function formatPreflight(result: PreflightResult): string {
  const lines = ['Recognition Audit Preflight', ''];
  for (const c of result.checks) {
    lines.push(`  ${c.status === 'pass' ? '✓' : '✗'} ${c.label}\n      ${c.detail}`);
  }
  lines.push('');
  lines.push(result.ready ? 'AUDIT READY' : 'STOP — audit blocked');
  return lines.join('\n');
}

// ---- CLI -----------------------------------------------------------------
if (require.main === module) {
  // Load .env the same way the other developer scripts do.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  } catch {
    // dotenv absent — fall back to whatever is already exported.
  }
  runRecognitionAuditPreflight()
    .then((result) => {
      console.log(formatPreflight(result));
      if (!result.ready) {
        console.log(
          '\nTo fix: configure a dedicated server-side DEVELOPMENT Google Places key\n' +
            'with Places API (New) enabled, and set it locally as GOOGLE_PLACES_KEY.\n' +
            'Do not replace EXPO_PUBLIC_GOOGLE_MAPS_API_KEY with it.',
        );
      }
      process.exit(result.ready ? 0 : 1);
    })
    .catch((err) => {
      console.error(`preflight crashed: ${describeError(err)}`);
      process.exit(1);
    });
}
