/**
 * scripts/checkGoogleApis.ts
 *
 * Confirm the Google API key a lane will actually build with is authorized for
 * every Google service Nearr calls at runtime. Read-only: it issues one
 * harmless query per service and reports the status. The key is never printed.
 *
 *   npm run verify:google
 *   npm run verify:google -- --eas-environment development
 *
 * WHY THIS EXISTS
 * ---------------
 * The first development build signed in fine but every manual place search
 * failed with:
 *
 *   [usePlacesSearch] error REQUEST_DENIED
 *   This API key is not authorized to use this service or API.
 *
 * The development lane currently falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (a separate
 * EAS variable from production's), and that key's API-restrictions allowlist
 * had Geocoding and "Places API (New)" but not "Places API" — the LEGACY
 * service. services/placesService.ts calls the legacy endpoints:
 *
 *   https://maps.googleapis.com/maps/api/place/textsearch/json
 *   https://maps.googleapis.com/maps/api/place/details/json
 *   https://maps.googleapis.com/maps/api/place/photo
 *   https://maps.googleapis.com/maps/api/geocode/json
 *
 * "Places API" and "Places API (New)" are two DIFFERENT services in Google
 * Cloud. Enabling only the new one leaves every legacy call denied, which is
 * easy to miss because the key looks configured and Maps tiles still render.
 *
 * Google distinguishes the two failure modes in the message, and so does this
 * script: an API that is not on the key's allowlist reports "not authorized to
 * use this service", whereas a wrong application restriction reports "This IP,
 * site or mobile application is not authorized". Web-service endpoints do not
 * honour iOS/Android app restrictions at all, so a key restricted to iOS apps
 * fails every call here even though the Maps SDK works.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { captureCli } from './lib/cliRunner';

const REPO_ROOT = path.resolve(__dirname, '..');

type Probe = {
  /** Google Cloud service name, as it appears in the console. */
  service: string;
  /** Where Nearr calls it from. */
  usedBy: string;
  required: boolean;
  run: (key: string) => Promise<{ ok: boolean; detail: string }>;
};

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

type SelectedKey = { key: string; variable: string };

function selectKey(env: Record<string, string | undefined>): SelectedKey {
  if ((env.EXPO_PUBLIC_GOOGLE_PLACES_KEY || '').trim()) {
    return { key: env.EXPO_PUBLIC_GOOGLE_PLACES_KEY!.trim(), variable: 'EXPO_PUBLIC_GOOGLE_PLACES_KEY' };
  }
  if ((env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim()) {
    return { key: env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY!.trim(), variable: 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (fallback)' };
  }
  return { key: '', variable: '(none)' };
}

function localKey(): SelectedKey {
  const env = {
    ...process.env,
    ...readEnvFile(path.join(REPO_ROOT, '.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.env.local')),
  } as Record<string, string | undefined>;
  return selectKey(env);
}

function easKey(environment: string): SelectedKey {
  if (!/^[A-Za-z0-9_-]+$/.test(environment)) {
    console.error(`Invalid EAS environment name: ${environment}`);
    process.exit(2);
  }
  let stdout = '';
  try {
    stdout = captureCli(
      'eas',
      ['env:list', '--environment', environment, '--include-sensitive'],
      { cwd: REPO_ROOT },
    );
  } catch (err) {
    console.error(
      `Could not read the EAS \`${environment}\` environment: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    process.exit(2);
  }
  const env: Record<string, string> = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = /^(EXPO_PUBLIC_GOOGLE_(?:PLACES|MAPS_API)_KEY)=(.*)$/.exec(rawLine.trim());
    if (match && !match[2].startsWith('*****')) env[match[1]] = match[2];
  }
  return selectKey(env);
}

/** Classify a legacy web-service response without echoing the key. */
function classifyLegacy(json: { status?: string; error_message?: string }): {
  ok: boolean;
  detail: string;
} {
  const status = json.status ?? 'UNKNOWN';
  if (status === 'OK' || status === 'ZERO_RESULTS') return { ok: true, detail: status };
  const message = json.error_message ?? '';
  if (/not authorized to use this service|not enabled|has not been used/i.test(message)) {
    return {
      ok: false,
      detail: `${status} — this service is NOT on the key's API-restrictions allowlist`,
    };
  }
  if (/IP, site or mobile application/i.test(message)) {
    return {
      ok: false,
      detail:
        `${status} — the key's APPLICATION restriction rejects web-service calls. ` +
        'Web services do not honour iOS/Android app restrictions; use None or IP.',
    };
  }
  return { ok: false, detail: `${status}${message ? ` — ${message}` : ''}` };
}

const PROBES: Probe[] = [
  {
    service: 'Places API  (LEGACY — not "Places API (New)")',
    usedBy: 'services/placesService.ts — textsearch / details / photo',
    required: true,
    run: async (key) => {
      const url =
        'https://maps.googleapis.com/maps/api/place/textsearch/json?query=coffee&key=' +
        encodeURIComponent(key);
      const response = await fetch(url);
      return classifyLegacy(await response.json());
    },
  },
  {
    service: 'Geocoding API',
    usedBy: 'services/placesService.ts — address verification',
    required: true,
    run: async (key) => {
      const url =
        'https://maps.googleapis.com/maps/api/geocode/json?address=Seattle&key=' +
        encodeURIComponent(key);
      const response = await fetch(url);
      return classifyLegacy(await response.json());
    },
  },
  {
    service: 'Places API (New)',
    usedBy: 'not used by Nearr today — informational only',
    required: false,
    run: async (key) => {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify({ textQuery: 'coffee' }),
      });
      if (response.ok) return { ok: true, detail: 'OK' };
      let message = '';
      try {
        message = ((await response.json()) as { error?: { message?: string } })?.error?.message ?? '';
      } catch {
        /* ignore */
      }
      return { ok: false, detail: `HTTP ${response.status}${message ? ` — ${message}` : ''}` };
    },
  },
];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--eas-environment');
  const environment = index >= 0 ? argv[index + 1] : undefined;

  const selected = environment ? easKey(environment) : localKey();
  const key = selected.key;
  const source = environment ? `EAS environment \`${environment}\`` : 'local .env';

  console.log(`Google API check — source: ${source}`);
  if (!key) {
    console.error(
      '\nNo EXPO_PUBLIC_GOOGLE_PLACES_KEY or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY found for this source. Nothing to check.',
    );
    process.exit(1);
  }
  // Length only — never the value.
  console.log(`  key class: ${selected.variable}`);
  console.log(`  key present (length ${key.length}); value is never printed\n`);

  let requiredFailures = 0;
  for (const probe of PROBES) {
    let result: { ok: boolean; detail: string };
    try {
      result = await probe.run(key);
    } catch (err) {
      result = { ok: false, detail: `request failed: ${err instanceof Error ? err.message : err}` };
    }
    const label = probe.required ? (result.ok ? 'OK      ' : 'DENIED  ') : 'info    ';
    if (probe.required && !result.ok) requiredFailures += 1;
    console.log(`  ${label}${probe.service}`);
    console.log(`          used by: ${probe.usedBy}`);
    console.log(`          ${result.detail}\n`);
  }

  if (requiredFailures > 0) {
    console.error(
      `${requiredFailures} required Google service(s) are not authorized for this key.\n\n` +
        'Fix in Google Cloud Console (this cannot be done from the repo):\n' +
        '  1. Create a DEVELOPMENT-ONLY API key (do not edit the production key).\n' +
        '  2. Enable "Places API" (LEGACY, separate from "Places API (New)")\n' +
        '     and "Geocoding API" in that Google Cloud project.\n' +
        '  3. Restrict the key\'s APIs to exactly those two services.\n' +
        '  4. Application restriction must be None for this client REST key;\n' +
        '     iOS/Android restrictions are not honoured by these web endpoints.\n' +
        '     Keep the key development-only and monitor/quota-limit it.\n' +
        '  5. Save it as EXPO_PUBLIC_GOOGLE_PLACES_KEY in EAS development + preview.\n' +
        '  6. Re-run this command.\n\n' +
        'Do NOT widen the production key to work around this — the development\n' +
        'lane has its own key precisely so they can be restricted separately.',
    );
    process.exit(1);
  }

  console.log('All required Google services are authorized for this key.');
}

void main();
