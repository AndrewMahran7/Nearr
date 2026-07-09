import * as fs from 'fs';
import * as path from 'path';

import { createClient } from '@supabase/supabase-js';

import {
  SHARE_REGRESSION_FIXTURES,
  type ShareRegressionFixture,
} from './shareRegressionFixtures';

type RemoteResponse = {
  status?: string;
  reason?: string | null;
  extraction?: {
    agent?: {
      userFacingDecision?: string;
      safeToAutoSave?: boolean;
      resolvedPlace?: {
        name?: string;
        formattedAddress?: string | null;
      } | null;
      candidates?: Array<{
        name?: string;
        formattedAddress?: string | null;
      }>;
    };
    finalCandidates?: Array<{
      name?: string;
      formattedAddress?: string | null;
    }>;
  };
};

const DEFAULT_EMAIL = 'dev@nearr.test';
const DEFAULT_PASSWORD = 'devpass123';

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function includesAny(haystack: string, needles?: string[]): boolean {
  if (!needles || needles.length === 0) return true;
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function includesAll(haystack: string, needles?: string[]): boolean {
  if (!needles || needles.length === 0) return true;
  return needles.every((needle) => haystack.includes(needle.toLowerCase()));
}

async function getAccessToken(): Promise<string> {
  const preset = process.env.NEARR_TEST_ACCESS_TOKEN?.trim();
  if (preset) return preset;

  const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const email = process.env.NEARR_TEST_EMAIL?.trim() || DEFAULT_EMAIL;
  const password = process.env.NEARR_TEST_PASSWORD?.trim() || DEFAULT_PASSWORD;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(error?.message ?? 'Could not sign in for regression test');
  }
  return data.session.access_token;
}

async function callProcessShareLink(
  endpoint: string,
  accessToken: string,
  url: string,
): Promise<{ ok: boolean; httpStatus: number; parsed: RemoteResponse | null; rawText: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode: 'extract',
      url,
      accessToken,
    }),
  });

  const rawText = await res.text();
  let parsed: RemoteResponse | null = null;
  try {
    parsed = JSON.parse(rawText) as RemoteResponse;
  } catch {
    parsed = null;
  }

  return { ok: res.ok, httpStatus: res.status, parsed, rawText };
}

function collectCandidateNames(parsed: RemoteResponse): string[] {
  const names = new Set<string>();
  const resolved = parsed.extraction?.agent?.resolvedPlace?.name;
  if (resolved) names.add(resolved);
  for (const c of parsed.extraction?.agent?.candidates ?? []) {
    if (c?.name) names.add(c.name);
  }
  for (const c of parsed.extraction?.finalCandidates ?? []) {
    if (c?.name) names.add(c.name);
  }
  return [...names];
}

function assertFixture(parsed: RemoteResponse, fixture: ShareRegressionFixture): string[] {
  const errors: string[] = [];
  const decision = parsed.extraction?.agent?.userFacingDecision ?? parsed.status ?? '';
  const safeToAutoSave = parsed.extraction?.agent?.safeToAutoSave;
  const resolvedName = parsed.extraction?.agent?.resolvedPlace?.name ?? '';
  const resolvedAddress = parsed.extraction?.agent?.resolvedPlace?.formattedAddress ?? '';
  const resolvedNameNorm = normalize(resolvedName);
  const resolvedAddressNorm = normalize(resolvedAddress);
  const allCandidateNames = collectCandidateNames(parsed);
  const allCandidateNamesNorm = allCandidateNames.map((name) => normalize(name));

  if (!fixture.acceptedDecisions.includes(decision as any)) {
    errors.push(`decision mismatch: got ${decision}, expected one of ${fixture.acceptedDecisions.join(', ')}`);
  }

  if (!includesAny(resolvedNameNorm, fixture.expectedCandidateNameIncludes)) {
    errors.push(
      `candidate name mismatch: got "${resolvedName}" expected one of ${
        fixture.expectedCandidateNameIncludes?.join(' | ') ?? '(none)'
      }`,
    );
  }

  if (!includesAll(resolvedAddressNorm, fixture.expectedAddressIncludes)) {
    errors.push(
      `address mismatch: got "${resolvedAddress}" expected all of ${
        fixture.expectedAddressIncludes?.join(' + ') ?? '(none)'
      }`,
    );
  }

  if (fixture.expectedSafeToAutoSave !== undefined && safeToAutoSave !== fixture.expectedSafeToAutoSave) {
    errors.push(
      `safeToAutoSave mismatch: got ${String(safeToAutoSave)} expected ${String(fixture.expectedSafeToAutoSave)}`,
    );
  }

  if (fixture.mustNotIncludeCandidateNames?.length) {
    for (const forbidden of fixture.mustNotIncludeCandidateNames) {
      const forbiddenNorm = forbidden.toLowerCase();
      const found = allCandidateNamesNorm.some((name) => name.includes(forbiddenNorm));
      if (found) {
        errors.push(`forbidden candidate name present: ${forbidden}`);
      }
    }
  }

  return errors;
}

async function runFixture(
  endpoint: string,
  accessToken: string,
  fixture: ShareRegressionFixture,
): Promise<{ pass: boolean; errors: string[] }> {
  const response = await callProcessShareLink(endpoint, accessToken, fixture.url);
  if (!response.parsed) {
    return {
      pass: false,
      errors: [
        `non-json response (http ${response.httpStatus})`,
        response.rawText.slice(0, 220),
      ],
    };
  }

  const errors = assertFixture(response.parsed, fixture);
  if (!response.ok) {
    errors.unshift(`http status ${response.httpStatus}`);
  }

  return { pass: errors.length === 0, errors };
}

async function main(): Promise<void> {
  loadDotEnv();
  const endpoint = requireEnv('EXPO_PUBLIC_PROCESS_SHARE_LINK_URL');
  const accessToken = await getAccessToken();

  let failures = 0;
  console.log(`[share-regression] endpoint: ${endpoint}`);
  for (const fixture of SHARE_REGRESSION_FIXTURES) {
    const result = await runFixture(endpoint, accessToken, fixture);
    if (result.pass) {
      console.log(`PASS ${fixture.id}`);
      continue;
    }
    failures += 1;
    console.log(`FAIL ${fixture.id}`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} fixture(s) failed.`);
    process.exit(1);
  }

  console.log('\nAll share regression fixtures passed.');
}

main().catch((error) => {
  console.error('[share-regression] fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
