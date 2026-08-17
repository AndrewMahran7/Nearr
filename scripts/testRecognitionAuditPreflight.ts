/**
 * scripts/testRecognitionAuditPreflight.ts
 *
 * PINNED contract for the RECOGNITION AUDIT GATE.
 *
 * The failure this exists to prevent has already happened once: the local
 * `.env` had GOOGLE_PLACES_KEY set to the client Maps key, Places API (New)
 * refused it, `searchPlaces` fell back to Legacy exactly as designed, and three
 * sessions of local recognition measurements were taken against a provider that
 * returns no `primaryType` at all. Nothing errored. The numbers were simply
 * about a different system than the one we ship.
 *
 * So every path to a wrong-provider benchmark must be a hard STOP, and the
 * gate must never be satisfiable by anything short of Places API (New)
 * genuinely answering and its richer schema genuinely arriving.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testRecognitionAuditPreflight.ts
 */

import {
  runRecognitionAuditPreflight,
  assertRecognitionAuditReady,
  formatPreflight,
  PREFLIGHT_CONTROL_QUERY,
} from './recognitionAuditPreflight';
import type { SearchPlacesResult } from '../supabase/functions/process-share-link/places/googlePlaces';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

const SERVER_KEY = 'server-key-value-do-not-log';
const CLIENT_KEY = 'client-key-value-do-not-log';

const newOk = (): SearchPlacesResult => ({
  ok: true,
  apiPath: 'places_new',
  results: [
    {
      googlePlaceId: 'ChIJctrl',
      name: 'Brooklyn City Pizzeria & Market',
      primaryType: 'pizza_restaurant',
      types: ['pizza_restaurant', 'restaurant'],
    } as never,
  ],
});

const failedCheck = (r: { checks: Array<{ id: string; status: string }> }, id: string) =>
  r.checks.find((c) => c.id === id)?.status === 'fail';

async function main(): Promise<void> {

// ---------------------------------------------------------------------------
// 1. Missing server key — never silently substitute the client key
// ---------------------------------------------------------------------------
{
  let searched = false;
  const r = await runRecognitionAuditPreflight({
    env: { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => { searched = true; return newOk(); },
  });
  check('missing key: audit blocked', r.ready === false);
  check('missing key: the right check failed', failedCheck(r, 'server_key_present'));
  check('missing key: no provider call attempted', !searched);
  check(
    'missing key: the client key is never borrowed',
    !JSON.stringify(r).includes(CLIENT_KEY),
  );
}

// ---------------------------------------------------------------------------
// 2. Server key === client key — fatal in both directions
// ---------------------------------------------------------------------------
{
  let searched = false;
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: CLIENT_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => { searched = true; return newOk(); },
  });
  check('same key: audit blocked', r.ready === false);
  check('same key: the right check failed', failedCheck(r, 'keys_distinct'));
  check('same key: blocked before spending a provider call', !searched);
}

// ---------------------------------------------------------------------------
// 3. Service-blocked key — the exact production-shaped failure
// ---------------------------------------------------------------------------
{
  // `searchPlaces` returns ok:true here, because the product deliberately falls
  // back rather than failing the user. The gate must NOT read that as success.
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => ({
      ok: true,
      apiPath: 'places_legacy',
      fallbackReason: 'service_blocked',
      results: [{ googlePlaceId: 'x', name: 'Brooklyn City Pizzeria & Market', primaryType: undefined } as never],
    }),
  });
  check('service blocked: audit blocked', r.ready === false);
  check('service blocked: provider-path check failed', failedCheck(r, 'provider_path_is_new'));
  check(
    'service blocked: a successful-looking Legacy answer is not mistaken for readiness',
    r.checks.find((c) => c.id === 'places_new_probe')?.status === 'pass' && r.ready === false,
  );
  check(
    'service blocked: the reason is surfaced',
    (r.checks.find((c) => c.id === 'provider_path_is_new')?.detail ?? '').includes('service_blocked'),
  );
}

// ---------------------------------------------------------------------------
// 4. Provider genuinely down — audit stops rather than measuring nothing
// ---------------------------------------------------------------------------
{
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => ({ ok: false, reason: 'http_error', status: '503' }),
  });
  check('provider down: audit blocked', r.ready === false);
  check('provider down: probe check failed', failedCheck(r, 'places_new_probe'));
}
{
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => { throw new Error('socket hang up'); },
  });
  check('probe throws: audit blocked, not crashed', r.ready === false);
  check('probe throws: reported as a failed check', failedCheck(r, 'places_new_probe'));
}

// ---------------------------------------------------------------------------
// 5. Unreported provider path — cannot confirm, so do not proceed
// ---------------------------------------------------------------------------
{
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => ({ ok: true, results: [{ googlePlaceId: 'x', name: 'X', primaryType: 'cafe' } as never] }),
  });
  check('unknown path: audit blocked', r.ready === false);
  check('unknown path: provider-path check failed', failedCheck(r, 'provider_path_is_new'));
}

// ---------------------------------------------------------------------------
// 6. New answers but the richer schema never arrives
// ---------------------------------------------------------------------------
{
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async () => ({
      ok: true,
      apiPath: 'places_new',
      results: [{ googlePlaceId: 'x', name: 'Brooklyn City Pizzeria & Market' } as never],
    }),
  });
  check('no primaryType: audit blocked', r.ready === false);
  check('no primaryType: the right check failed', failedCheck(r, 'primary_type_present'));
}

// ---------------------------------------------------------------------------
// 7. The happy path
// ---------------------------------------------------------------------------
{
  let queried = '';
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
    search: async (q) => { queried = q; return newOk(); },
  });
  check('ready: audit allowed', r.ready === true);
  check('ready: every check passed', r.checks.every((c) => c.status === 'pass'));
  check('ready: the control query was used', queried === PREFLIGHT_CONTROL_QUERY);
  check('ready: exactly one probe is enough', r.checks.filter((c) => c.id === 'places_new_probe').length === 1);
  check('ready: report renders the verdict', formatPreflight(r).includes('AUDIT READY'));
}

// A client key that simply is not set must not be invented as a collision.
{
  const r = await runRecognitionAuditPreflight({
    env: { GOOGLE_PLACES_KEY: SERVER_KEY },
    search: async () => newOk(),
  });
  check('no client key: audit still allowed', r.ready === true);
}

// ---------------------------------------------------------------------------
// 8. The benchmark contract
// ---------------------------------------------------------------------------
{
  let threw: Error | null = null;
  try {
    await assertRecognitionAuditReady({
      env: { GOOGLE_PLACES_KEY: CLIENT_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
      search: async () => newOk(),
    });
  } catch (e) { threw = e as Error; }
  check('contract: a blocked audit throws', !!threw);
  check('contract: the message names the failing check', (threw?.message ?? '').includes('Server and client keys'));
  check('contract: no key value in the thrown message', !(threw?.message ?? '').includes(CLIENT_KEY));

  let ok = true;
  try {
    await assertRecognitionAuditReady({
      env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY },
      search: async () => newOk(),
    });
  } catch { ok = false; }
  check('contract: a ready audit proceeds silently', ok);
}

// ---------------------------------------------------------------------------
// 9. Secret safety across every outcome
// ---------------------------------------------------------------------------
{
  const scenarios: Array<[string, Parameters<typeof runRecognitionAuditPreflight>[0]]> = [
    ['same key', { env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: SERVER_KEY }, search: async () => newOk() }],
    ['blocked', { env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY }, search: async () => ({ ok: true, apiPath: 'places_legacy', fallbackReason: 'service_blocked', results: [] }) }],
    ['ready', { env: { GOOGLE_PLACES_KEY: SERVER_KEY, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: CLIENT_KEY }, search: async () => newOk() }],
  ];
  for (const [label, deps] of scenarios) {
    const r = await runRecognitionAuditPreflight(deps);
    const text = `${JSON.stringify(r)}\n${formatPreflight(r)}`;
    check(`secrets: no server key value in output (${label})`, !text.includes(SERVER_KEY));
    check(`secrets: no client key value in output (${label})`, !text.includes(CLIENT_KEY));
    check(`secrets: digests are truncated (${label})`, !/[0-9a-f]{16,}/.test(text));
  }
}

}

main().then(() => {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
