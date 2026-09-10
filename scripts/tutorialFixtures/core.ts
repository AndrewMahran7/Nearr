import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { canonicalContentIdentity } from '../../lib/shareAgent/contentIdentity';
import { loadDeployedConfig } from '../e2e/config';

export const FIXTURE_HEALTH_TTL_DAYS = 7;
export const EXPECTED_DEV_REF = 'qnfxnmvxpjzfydgudtvs';

export type FixtureManifestEntry = {
  fixtureId: string;
  sourceCorpusId: string;
  sourceUrl: string;
  identityKey: string;
  identityVersion: number;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'snapchat';
  contentId: string;
  canonicalUrl: string;
  googlePlaceId: string;
  expectedPlaceName: string;
  expectedLatitude: number;
  expectedLongitude: number;
  role: 'primary' | 'backup';
  priority: number;
  verifiedBy: string;
  expectedMediaSha256: string | null;
};

export type FixtureRow = {
  id: string;
  identity_key: string;
  identity_version: number;
  platform: string;
  content_id: string;
  canonical_url: string;
  place_id: string;
  status: 'active' | 'quarantined' | 'stale' | 'disabled';
  role: 'primary' | 'backup';
  priority: number;
  provenance: string;
  verification_revision: number;
  verified_at: string;
  verified_by: string;
  expected_media_sha256: string | null;
  last_observed_media_sha256: string | null;
  health_state: string;
  last_health_checked_at: string | null;
  health_expires_at: string | null;
  last_health_error_code: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
};

export function parseOptions(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq < 0) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

export function requireOption(options: Record<string, string | boolean>, name: string): string {
  const value = options[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing_required_option:--${name}=...`);
  return value.trim();
}

export function developmentAdmin(): { db: SupabaseClient; ref: string } {
  const config = loadDeployedConfig();
  if (config.supabaseRef !== EXPECTED_DEV_REF) throw new Error(`development_target_refused:${config.supabaseRef}`);
  if (!config.serviceRoleKey) throw new Error('development_service_role_missing');
  return {
    ref: config.supabaseRef,
    db: createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export function loadManifest(file = path.resolve(process.cwd(), 'scripts/tutorialFixtureManifest.json')): FixtureManifestEntry[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { environment?: string; fixtures?: FixtureManifestEntry[] };
  if (parsed.environment !== 'development' || !Array.isArray(parsed.fixtures)) {
    throw new Error('invalid_development_fixture_manifest');
  }
  return parsed.fixtures;
}

export function validateManifestEntry(entry: FixtureManifestEntry): void {
  const identity = canonicalContentIdentity(entry.sourceUrl, entry.canonicalUrl);
  if (!identity || identity.key !== entry.identityKey || identity.identityVersion !== entry.identityVersion ||
      identity.platform !== entry.platform || identity.contentId !== entry.contentId ||
      identity.canonicalUrl !== entry.canonicalUrl) {
    throw new Error(`fixture_identity_mismatch:${entry.fixtureId}`);
  }
  if (!['primary', 'backup'].includes(entry.role) || !Number.isInteger(entry.priority) ||
      entry.priority < 0 || entry.priority > 10000) throw new Error(`fixture_metadata_invalid:${entry.fixtureId}`);
  if (entry.expectedMediaSha256 && !/^[0-9a-f]{64}$/.test(entry.expectedMediaSha256)) {
    throw new Error(`fixture_fingerprint_invalid:${entry.fixtureId}`);
  }
}

export async function sourceHealthProbe(
  row: Pick<FixtureRow, 'canonical_url' | 'identity_key' | 'expected_media_sha256'>,
  verifyFingerprint: boolean,
): Promise<{ identityKey: string; mediaSha256: string | null; formatCount: number; titlePresent: boolean }> {
  const probe = spawnSync('yt-dlp', ['--dump-single-json', '--skip-download', '--no-playlist', '--', row.canonical_url], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true, shell: false, maxBuffer: 12 * 1024 * 1024,
  });
  if (probe.error || probe.status !== 0) throw new Error('source_acquisition_unavailable');
  let metadata: any;
  try { metadata = JSON.parse(probe.stdout); } catch { throw new Error('source_metadata_invalid'); }
  const observedUrl = typeof metadata.webpage_url === 'string' ? metadata.webpage_url : row.canonical_url;
  const identity = canonicalContentIdentity(row.canonical_url, observedUrl);
  if (!identity || identity.key !== row.identity_key) throw new Error('source_identity_mismatch');
  const formatCount = Array.isArray(metadata.formats) ? metadata.formats.length : 0;
  if (formatCount < 1) throw new Error('source_media_formats_unavailable');

  let mediaSha256: string | null = null;
  if (row.expected_media_sha256) {
    if (!verifyFingerprint) throw new Error('fingerprint_verification_required');
    const dir = mkdtempSync(path.join(tmpdir(), 'nearr-tutorial-fixture-'));
    try {
      const output = path.join(dir, 'media.%(ext)s');
      const download = spawnSync('yt-dlp', [
        '--no-playlist', '--max-filesize', '200M', '-f', 'best[ext=mp4]/best', '-o', output, '--', row.canonical_url,
      ], { encoding: 'utf8', timeout: 180_000, windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024 });
      if (download.error || download.status !== 0) throw new Error('source_media_download_failed');
      const file = readdirSync(dir).map((name) => path.join(dir, name)).find(existsSync);
      if (!file) throw new Error('source_media_download_missing');
      mediaSha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (mediaSha256 !== row.expected_media_sha256) throw new Error('source_fingerprint_mismatch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    identityKey: identity.key,
    mediaSha256,
    formatCount,
    titlePresent: typeof metadata.title === 'string' && metadata.title.trim().length > 0,
  };
}

export async function writeFixtureEvent(
  db: SupabaseClient,
  fixture: FixtureRow,
  eventType: string,
  toStatus: FixtureRow['status'],
  actor: string,
  reasonCode: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from('onboarding_tutorial_fixture_events').insert({
    fixture_id: fixture.id,
    event_type: eventType,
    from_status: fixture.status,
    to_status: toStatus,
    verification_revision: fixture.verification_revision,
    actor: actor.slice(0, 160),
    reason_code: reasonCode.slice(0, 120),
    detail,
  });
  if (error) throw new Error(`fixture_event_write_failed:${error.message}`);
}

export async function readFixture(db: SupabaseClient, id: string): Promise<FixtureRow> {
  const { data, error } = await db.from('onboarding_tutorial_fixtures').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`fixture_read_failed:${error.message}`);
  if (!data) throw new Error(`fixture_not_found:${id}`);
  return data as FixtureRow;
}
