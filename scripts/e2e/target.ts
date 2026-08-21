/**
 * scripts/e2e/target.ts
 *
 * FAIL-CLOSED environment identity for the Tier 3 deployed E2E suite.
 *
 * Everything in scripts/e2e/ mutates a REAL Supabase project and invokes a REAL
 * Railway service. That is only ever acceptable against Nearr-Dev, so identity
 * is proven here, once, before any other module is allowed to build a client.
 *
 * The rule is deliberately stricter than "not production": an UNRECOGNISED
 * target is refused too, because an unrecognised target cannot be proven safe.
 * There is no --force, no --yes, and no environment variable that relaxes this.
 * If Nearr-Dev were genuinely re-created, EXPECTED_DEV_REF in
 * scripts/devTarget.mjs (the single source of truth, parsed below) is updated in
 * the same commit.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Railway project holding BOTH lanes. Not a secret — it is in package.json. */
export const RAILWAY_PROJECT_ID = '4037a3b5-d66f-409e-b734-56c22c244e3e';
export const EXPECTED_RAILWAY_ENVIRONMENT = 'development';
export const EXPECTED_RAILWAY_SERVICE = 'media-worker';
/** The production Railway lane, refused by name as well as by Supabase ref. */
export const PRODUCTION_RAILWAY_SERVICE = 'Nearr';
export const PRODUCTION_RAILWAY_ENVIRONMENT = 'production';

/**
 * Read PRODUCTION_REF / EXPECTED_DEV_REF out of scripts/devTarget.mjs rather
 * than re-declaring them. Re-declaring is how two guards drift apart: the older
 * one keeps refusing a ref the newer one already retired. Parsing the existing
 * module keeps exactly one definition in the repo, and the offline harness test
 * fails loudly if that module ever stops declaring them in a readable form.
 */
function readRefsFromDevTarget(): { productionRef: string; devRef: string } {
  const file = path.join(REPO_ROOT, 'scripts', 'devTarget.mjs');
  if (!existsSync(file)) {
    throw new Error(
      'scripts/devTarget.mjs is missing. The E2E suite refuses to guess which ' +
        'Supabase project is production.',
    );
  }
  const source = readFileSync(file, 'utf8');
  const prod = source.match(/export const PRODUCTION_REF\s*=\s*'([a-z0-9]+)'/);
  const dev = source.match(/export const EXPECTED_DEV_REF\s*=\s*'([a-z0-9]+)'/);
  if (!prod || !prod[1] || !dev || !dev[1]) {
    throw new Error(
      'Could not read PRODUCTION_REF / EXPECTED_DEV_REF from scripts/devTarget.mjs. ' +
        'The E2E suite refuses to run without a proven production ref to refuse.',
    );
  }
  if (prod[1] === dev[1]) {
    throw new Error('devTarget.mjs declares the same ref as production AND development.');
  }
  return { productionRef: prod[1], devRef: dev[1] };
}

const REFS = readRefsFromDevTarget();
export const PRODUCTION_REF = REFS.productionRef;
export const EXPECTED_DEV_REF = REFS.devRef;

/** Thrown for every refusal. Callers ABORT; nothing "best effort" continues. */
export class TargetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetRefusedError';
  }
}

function refuse(reason: string, detail: string): never {
  throw new TargetRefusedError(
    'ABORT — ' +
      reason +
      '\n\n' +
      detail +
      '\n\n' +
      'The Nearr-Dev E2E suite runs against DEVELOPMENT ONLY and fails closed.\n' +
      `Expected Supabase ref : ${EXPECTED_DEV_REF} (Nearr-Dev)\n` +
      `Refused production ref: ${PRODUCTION_REF} (Nearr)\n` +
      `Expected Railway      : project ${RAILWAY_PROJECT_ID}, ` +
      `environment "${EXPECTED_RAILWAY_ENVIRONMENT}", service "${EXPECTED_RAILWAY_SERVICE}"`,
  );
}

/** Extract the project ref from a Supabase URL, or '' when it is not one. */
export function refFromSupabaseUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.endsWith('.supabase.co') && !host.endsWith('.supabase.in')) return '';
    const first = host.split('.')[0];
    return /^[a-z0-9]{20}$/.test(first) ? first : '';
  } catch {
    return '';
  }
}

/**
 * Prove a Supabase URL points at Nearr-Dev.
 *
 * Order matters: production is named and refused FIRST so the message is
 * unambiguous, then anything unrecognised is refused for being unprovable.
 */
export function assertDevelopmentSupabaseUrl(url: string, source: string): string {
  if (!url || !url.trim()) {
    refuse('missing target identity', `No Supabase URL was resolved from ${source}.`);
  }
  const ref = refFromSupabaseUrl(url);
  if (!ref) {
    refuse(
      'ambiguous environment',
      `${source} produced a URL that is not a recognisable Supabase project URL, so its\n` +
        'project ref cannot be read and the target cannot be proven.',
    );
  }
  if (ref === PRODUCTION_REF) {
    refuse(
      'PRODUCTION Supabase project',
      `${source} resolves to ${ref}, which is the PRODUCTION project (Nearr).\n` +
        'The E2E suite creates users, share jobs and media tasks. It will never do that\n' +
        'against real user data.',
    );
  }
  if (ref !== EXPECTED_DEV_REF) {
    refuse(
      'unrecognised Supabase project',
      `${source} resolves to ${ref}, which is neither production nor the expected\n` +
        'development project. An unrecognised target cannot be proven safe.',
    );
  }
  return ref;
}

export type RailwayIdentity = {
  environment: string;
  service: string;
  projectId: string;
  publicDomain: string;
};

/** Prove a Railway variable snapshot describes the DEVELOPMENT media-worker. */
export function assertDevelopmentRailway(vars: Record<string, string>): RailwayIdentity {
  const environment = (vars.RAILWAY_ENVIRONMENT_NAME || vars.RAILWAY_ENVIRONMENT || '').trim();
  const service = (vars.RAILWAY_SERVICE_NAME || '').trim();
  const projectId = (vars.RAILWAY_PROJECT_ID || '').trim();
  const publicDomain = (vars.RAILWAY_PUBLIC_DOMAIN || '').trim();

  if (!environment || !service || !projectId) {
    refuse(
      'missing target identity',
      'Railway did not report RAILWAY_ENVIRONMENT_NAME / RAILWAY_SERVICE_NAME /\n' +
        'RAILWAY_PROJECT_ID, so the environment being tested cannot be proven.',
    );
  }
  if (environment.toLowerCase() === PRODUCTION_RAILWAY_ENVIRONMENT) {
    refuse('PRODUCTION Railway environment', `Railway reported environment "${environment}".`);
  }
  if (service === PRODUCTION_RAILWAY_SERVICE) {
    refuse('PRODUCTION Railway service', `Railway reported service "${service}".`);
  }
  if (environment !== EXPECTED_RAILWAY_ENVIRONMENT) {
    refuse(
      'unrecognised Railway environment',
      `Railway reported environment "${environment}", expected "${EXPECTED_RAILWAY_ENVIRONMENT}".`,
    );
  }
  if (service !== EXPECTED_RAILWAY_SERVICE) {
    refuse(
      'unrecognised Railway service',
      `Railway reported service "${service}", expected "${EXPECTED_RAILWAY_SERVICE}".`,
    );
  }
  if (projectId !== RAILWAY_PROJECT_ID) {
    refuse(
      'unrecognised Railway project',
      `Railway reported project "${projectId}", expected "${RAILWAY_PROJECT_ID}".`,
    );
  }
  return { environment, service, projectId, publicDomain };
}

/**
 * Prove a media-worker base URL is the development worker.
 *
 * Checked independently of the Railway variable snapshot because this URL is
 * what the DATABASE dials. A correct Railway environment paired with a worker
 * URL pointing somewhere else is precisely the cross-service break this tier
 * exists to catch.
 */
export function assertDevelopmentWorkerUrl(
  url: string,
  expectedDomain: string,
  source: string,
): string {
  if (!url || !url.trim()) {
    refuse('missing target identity', `No media-worker URL was resolved from ${source}.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return refuse('ambiguous environment', `${source} produced "${url}", which is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    refuse('insecure worker URL', `${source} produced a non-HTTPS URL (${parsed.protocol}).`);
  }
  const host = parsed.hostname.toLowerCase();
  if (expectedDomain && host !== expectedDomain.toLowerCase()) {
    refuse(
      'worker URL does not match the development deployment',
      `${source} points at "${host}", but the Railway development service is served from\n` +
        `"${expectedDomain}". A development database dialling a different worker is a\n` +
        'cross-service break, and could be production.',
    );
  }
  if (!expectedDomain && !/(^|\.)up\.railway\.app$/.test(host)) {
    refuse(
      'ambiguous environment',
      `${source} points at "${host}" and Railway reported no public domain to compare it\n` +
        'against, so the worker being tested cannot be proven to be development.',
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

/** Assert the ref constants are still readable. Used by the offline harness test. */
export function assertRefSourceIntact(): { productionRef: string; devRef: string } {
  return readRefsFromDevTarget();
}
