/**
 * scripts/mediaLiveRegression.ts
 *
 * Layer B — opt-in LIVE regression harness over
 * scripts/mediaRegressionCorpus.json. Hits real platform URLs, so it is
 * gated behind RUN_LIVE_MEDIA_REGRESSION=1 and is NEVER part of the normal
 * test suite / CI. See docs/MEDIA_REGRESSION_CORPUS.md.
 *
 * Stages:
 *   acquisition (default) — cheap: fetch the real page, run platform
 *     detection + the metadata evidence pipeline (extractHandles ->
 *     extractEvidence -> buildQueryPlan) against the REAL fetched content,
 *     and (via `yt-dlp -j`, if on PATH) report media/caption reachability.
 *     No Google Places calls, no AI provider calls.
 *   resolution — everything acquisition does, PLUS an actual Google Places
 *     text search per generated query (requires GOOGLE_PLACES_KEY) so
 *     forbiddenCandidates / forbiddenRegions can be checked against real
 *     results. Costs real API quota — kept to the small corpus on purpose.
 *
 * Run:
 *   RUN_LIVE_MEDIA_REGRESSION=1 npx ts-node -P scripts/tsconfig.json scripts/mediaLiveRegression.ts
 *   RUN_LIVE_MEDIA_REGRESSION=1 npx ts-node -P scripts/tsconfig.json scripts/mediaLiveRegression.ts --stage=resolution
 */

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { buildQueryPlan } from '../supabase/functions/process-share-link/resolver/queryBuilder';
import { detectPlatform } from '../supabase/functions/process-share-link/platform/detectPlatform';
import { isPlaceholderValue } from '../lib/shareAgent/queryCleaner';

if (process.env.RUN_LIVE_MEDIA_REGRESSION !== '1') {
  console.log(
    'Skipped (opt-in only). Set RUN_LIVE_MEDIA_REGRESSION=1 to run the live corpus regression. See docs/MEDIA_REGRESSION_CORPUS.md.',
  );
  process.exit(0);
}

const stage = (process.argv.find((a) => a.startsWith('--stage=')) ?? '--stage=acquisition').split('=')[1];
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_KEY || '';

type CorpusEntry = {
  id: string;
  platform: string;
  url: string;
  groundTruth: { verifiedBy: string; hasIdentifiablePlace: boolean | string; notes?: string };
  expected: {
    contentCategory: string;
    geographyHints: string[];
    forbiddenCandidates: string[];
    forbiddenRegions?: string[];
    minDecision: string;
  };
};

const corpus = JSON.parse(readFileSync(path.join(__dirname, 'mediaRegressionCorpus.json'), 'utf8')) as {
  entries: CorpusEntry[];
};

const USER_AGENT = 'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';

async function fetchHtml(url: string, timeoutMs = 12_000): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const html = await res.text();
    return { ok: true, html, finalUrl: res.url || url };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.name === 'AbortError' ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(t);
  }
}

function pickMetaTag(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  return m ? m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
}

function ytDlpProbe(url: string): { ok: boolean; hasFormats?: boolean; hasCaptions?: boolean; durationSeconds?: number; error?: string } {
  try {
    const out = execFileSync('yt-dlp', ['-j', '--no-warnings', '--no-playlist', '--no-cache-dir', '--socket-timeout', '15', url], {
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    const info = JSON.parse(out.trim().split('\n')[0] || '{}');
    const hasFormats = Array.isArray(info.formats) ? info.formats.length > 0 : !!info.url;
    const hasCaptions =
      (info.subtitles && Object.keys(info.subtitles).length > 0) ||
      (info.automatic_captions && Object.keys(info.automatic_captions).length > 0);
    return { ok: true, hasFormats, hasCaptions: !!hasCaptions, durationSeconds: info.duration };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message?.slice(0, 200) };
  }
}

async function searchPlacesLive(query: string): Promise<{ name: string; formattedAddress: string }[]> {
  if (!GOOGLE_PLACES_KEY) return [];
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 8 }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { places?: { displayName?: { text?: string }; formattedAddress?: string }[] };
    return (json.places ?? []).map((p) => ({ name: p.displayName?.text ?? '', formattedAddress: p.formattedAddress ?? '' }));
  } catch {
    return [];
  }
}

type EntryResult = {
  id: string;
  platform: string;
  urlRecognized: boolean;
  fixtureUnavailable: boolean;
  fixtureUnavailableReason?: string;
  mediaAcquired: boolean | 'unknown';
  captionAcquired: boolean | 'unknown';
  queries: string[];
  hasExplicitPlaceEvidence: boolean;
  candidateCount: number;
  garbageCandidatePresent: boolean;
  garbageDetail?: string;
  wrongRegionPresent: boolean;
  elapsedMs: number;
  failureReason?: string;
};

async function runEntry(entry: CorpusEntry): Promise<EntryResult> {
  const startedAt = Date.now();
  const platform = detectPlatform(entry.url);
  const urlRecognized = platform === entry.platform || (entry.platform === 'tiktok' && platform === 'tiktok');

  const page = await fetchHtml(entry.url);
  if (!page.ok) {
    return {
      id: entry.id,
      platform: entry.platform,
      urlRecognized,
      fixtureUnavailable: true,
      fixtureUnavailableReason: page.reason,
      mediaAcquired: 'unknown',
      captionAcquired: 'unknown',
      queries: [],
      hasExplicitPlaceEvidence: false,
      candidateCount: 0,
      garbageCandidatePresent: false,
      wrongRegionPresent: false,
      elapsedMs: Date.now() - startedAt,
      failureReason: `fixture_unavailable:${page.reason}`,
    };
  }

  const title = pickMetaTag(page.html, 'og:title');
  const description = pickMetaTag(page.html, 'og:description');
  const handles = extractHandles({ platform: platform as any, title, description, html: page.html });
  const evidence = extractEvidence({ platform: platform as any, title, description, handles });
  const plan = buildQueryPlan(evidence);

  let mediaAcquired: boolean | 'unknown' = 'unknown';
  let captionAcquired: boolean | 'unknown' = 'unknown';
  if (stage === 'acquisition' || stage === 'resolution') {
    const probe = ytDlpProbe(entry.url);
    mediaAcquired = probe.ok ? !!probe.hasFormats : false;
    captionAcquired = probe.ok ? !!probe.hasCaptions : false;
  }

  let candidateCount = 0;
  let garbageCandidatePresent = false;
  let garbageDetail: string | undefined;
  let wrongRegionPresent = false;
  if (stage === 'resolution' && plan.queries.length > 0) {
    for (const q of plan.queries.slice(0, 3)) {
      const results = await searchPlacesLive(q);
      candidateCount += results.length;
      for (const r of results) {
        if (isPlaceholderValue(r.name) || entry.expected.forbiddenCandidates.some((f) => r.name.toLowerCase() === f.toLowerCase())) {
          garbageCandidatePresent = true;
          garbageDetail = r.name;
        }
        const region = (entry.expected.forbiddenRegions ?? []).find((st) => new RegExp(`,\\s*${st}\\s`).test(r.formattedAddress));
        if (region) wrongRegionPresent = true;
      }
    }
  }

  return {
    id: entry.id,
    platform: entry.platform,
    urlRecognized,
    fixtureUnavailable: false,
    mediaAcquired,
    captionAcquired,
    queries: plan.queries,
    hasExplicitPlaceEvidence: plan.hasExplicitPlaceEvidence,
    candidateCount,
    garbageCandidatePresent,
    garbageDetail,
    wrongRegionPresent,
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  console.log(`[media-live-regression] stage=${stage} entries=${corpus.entries.length} googlePlacesConfigured=${!!GOOGLE_PLACES_KEY}`);
  const results: EntryResult[] = [];
  for (const entry of corpus.entries) {
    process.stdout.write(`  ${entry.id} (${entry.platform})... `);
    const r = await runEntry(entry);
    results.push(r);
    console.log(
      r.fixtureUnavailable
        ? `FIXTURE_UNAVAILABLE (${r.fixtureUnavailableReason})`
        : `ok queries=${JSON.stringify(r.queries)} garbage=${r.garbageCandidatePresent} wrongRegion=${r.wrongRegionPresent} (${r.elapsedMs}ms)`,
    );
  }

  // ---- Regression check: a REAL failure is a still-reachable fixture whose
  // forbidden candidate/region actually showed up. fixture_unavailable never
  // counts as a regression.
  const regressions = results.filter((r) => !r.fixtureUnavailable && (r.garbageCandidatePresent || r.wrongRegionPresent));

  // ---- Metrics by platform ----
  const platforms = Array.from(new Set(results.map((r) => r.platform)));
  const metrics: Record<string, unknown> = {};
  for (const p of platforms) {
    const rows = results.filter((r) => r.platform === p);
    const reachable = rows.filter((r) => !r.fixtureUnavailable);
    metrics[p] = {
      total: rows.length,
      fixtureUnavailableRate: rows.length ? rows.filter((r) => r.fixtureUnavailable).length / rows.length : 0,
      acquisitionSuccessRate: reachable.length ? reachable.filter((r) => r.mediaAcquired === true).length / reachable.length : null,
      transcriptAvailabilityRate: reachable.length ? reachable.filter((r) => r.captionAcquired === true).length / reachable.length : null,
      garbageCandidateRate: reachable.length ? reachable.filter((r) => r.garbageCandidatePresent).length / reachable.length : 0,
      wrongRegionRate: reachable.length ? reachable.filter((r) => r.wrongRegionPresent).length / reachable.length : 0,
      noExplicitEvidenceRate: reachable.length ? reachable.filter((r) => !r.hasExplicitPlaceEvidence).length / reachable.length : null,
    };
  }

  // No video/audio is ever downloaded by this harness (yt-dlp runs in `-j`
  // metadata-probe-only mode, same as the acquisition-stage checks
  // elsewhere in this codebase) — nothing to clean up. The JSON report
  // itself is the only artifact and is left in place for inspection.
  const outDir = mkdtempSync(path.join(tmpdir(), 'nearr-media-live-regression-'));
  const outPath = path.join(outDir, `report-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ stage, results, metrics }, null, 2), 'utf8');

  console.log('');
  console.log('=== Metrics by platform ===');
  console.log(JSON.stringify(metrics, null, 2));
  console.log('');
  console.log(`Full report: ${outPath}`);

  if (regressions.length > 0) {
    console.error(`\n${regressions.length} REGRESSION(S) on still-reachable gold cases:`);
    for (const r of regressions) {
      console.error(`  ${r.id}: garbage=${r.garbageDetail ?? 'n/a'} wrongRegion=${r.wrongRegionPresent}`);
    }
    process.exit(1);
  }
  console.log('\nNo regressions on reachable gold cases.');
}

main().catch((err) => {
  console.error('[media-live-regression] fatal', err);
  process.exit(1);
});
