/**
 * Evaluation harness for share-link → place-query extraction.
 *
 * Loads scripts/share-extraction-fixtures.json, runs each fixture through:
 *   1. The local heuristic (lib/placeExtractor.extractPlaceQueryFromShareMetadata)
 *   2. The AI extractor (lib/aiExtractPlace.extractPlaceAI), which falls back
 *      gracefully when GEMINI_API_KEY is missing.
 *   3. (Optional) Google Places Text Search if GOOGLE_PLACES_KEY is set.
 *
 * Writes a timestamped JSON report to logs/share-extraction-eval-<date>.json
 * and prints a summary table.
 *
 * This is a Node-only script. It must NOT pull in React Native runtime code.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  extractPlaceQueryFromShareMetadata,
  type PlaceExtractionInput,
} from '../lib/placeExtractor';
import type { ShareSource } from '../lib/shareParser';
import { extractPlaceAI } from '../lib/aiExtractPlace';
import { transcribeSocialVideo } from '../lib/transcription';
import type { TranscriptionResult, TranscriptionSourceType } from '../lib/transcription';
import { runExtractionPipeline } from '../lib/extractionPipeline';
import {
  pickBestVerifiedVenueProfile,
  type InstagramProfileMetadata,
} from '../lib/instagramProfileMetadata';
import { shouldSearchPlaces } from '../lib/queryValidation';

type Fixture = {
  name: string;
  input: {
    title: string;
    description: string;
    url: string;
    sourceType: string;
    posterHandle?: string;
    profileMetadata?: InstagramProfileMetadata[];
    /** Optional pre-supplied transcript. When present, eval skips the provider call. */
    transcript?: string;
  };
  expectedQuery: string;
  expectedNameSource?: string;
  expectedSearchAllowed?: boolean;
  /**
   * Optional v2 assertion: whether the extraction pipeline should allow a
   * silent save without showing the user a chooser. When omitted the eval
   * does not assert against the pipeline decision.
   */
  expectedAutoSave?: boolean;
};

type EvalRow = {
  name: string;
  input: Fixture['input'];
  expectedQuery: string;
  expectedAutoSave?: boolean;
  heuristicQuery: string;
  heuristicConfidence: string;
  heuristicReason: string;
  aiQuery: string;
  aiConfidence: string;
  aiReason: string;
  pipelineQuery: string;
  pipelineNameSource: string;
  searchAllowed: boolean;
  transcript: string | null;
  transcriptionStatus: string;
  transcriptionProvider: string;
  transcriptionReason: string;
  placesTopResult?: string;
  pipelineAutoSaveAllowed: boolean;
  pipelineBlockedReason: string | null;
  pipelinePosterType: string;
  autoSaveAssertionPass: boolean | null;
  pass: boolean;
  aiBeatsHeuristic: boolean;
  notes: string;
};

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(ROOT, 'scripts', 'share-extraction-fixtures.json');
const LOGS_DIR = path.join(ROOT, 'logs');

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Soft match: at least 60% of expected tokens present. */
function softMatch(actual: string, expected: string): boolean {
  if (!expected) return !actual;
  const a = tokenSet(actual);
  const e = tokenSet(expected);
  if (e.size === 0) return false;
  let hits = 0;
  for (const t of e) if (a.has(t)) hits++;
  return hits / e.size >= 0.6;
}

function asShareSource(s: string): ShareSource {
  if (s === 'tiktok' || s === 'instagram' || s === 'link') return s;
  return 'link';
}

function asTranscriptionSource(s: string): TranscriptionSourceType {
  if (s === 'tiktok' || s === 'instagram' || s === 'link' || s === 'manual') return s;
  return 'link';
}

/**
 * Resolve a transcript for a fixture. Order of operations:
 *   1. If the fixture already includes a transcript, use it as-is and
 *      record status="success" provider="fixture" so the report is honest.
 *   2. Otherwise, call the placeholder transcription provider. It will
 *      return status="unavailable" until a real provider is wired up.
 *      The eval MUST NOT fail just because transcription is unavailable.
 */
async function resolveTranscript(
  fx: Fixture,
): Promise<{ transcript: string | null; result: TranscriptionResult }> {
  if (fx.input.transcript && fx.input.transcript.trim()) {
    const transcript = fx.input.transcript.trim();
    const result: TranscriptionResult = {
      transcript,
      provider: 'fixture',
      status: 'success',
      reason: 'Transcript provided in fixture',
    };
    console.log(
      '[transcription]',
      result.status,
      result.provider,
      result.reason,
    );
    return { transcript, result };
  }

  if (!fx.input.url) {
    const result: TranscriptionResult = {
      transcript: null,
      provider: 'none',
      status: 'skipped',
      reason: 'No url to transcribe',
    };
    console.log('[transcription]', result.status, result.provider, result.reason);
    return { transcript: null, result };
  }

  const result = await transcribeSocialVideo({
    url: fx.input.url,
    sourceType: asTranscriptionSource(fx.input.sourceType),
  });
  console.log(
    '[transcription]',
    result.status,
    result.provider,
    result.reason ?? '',
  );
  return { transcript: result.transcript, result };
}

async function placesLookup(query: string): Promise<string | undefined> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key || !query) return undefined;
  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/textsearch/json' +
      `?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`[eval] places HTTP ${res.status} for "${query}"`);
      return undefined;
    }
    const data = (await res.json()) as {
      results?: Array<{ name?: string; formatted_address?: string }>;
    };
    const top = data.results?.[0];
    if (!top?.name) return undefined;
    return top.formatted_address ? `${top.name} — ${top.formatted_address}` : top.name;
  } catch (err) {
    console.log('[eval] places lookup failed:', err);
    return undefined;
  }
}

async function main(): Promise<void> {
  console.log('[eval] starting share-extraction evaluation');
  console.log(
    `[eval] GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'present' : 'missing'} ` +
      `GOOGLE_PLACES_KEY=${process.env.GOOGLE_PLACES_KEY ? 'present' : 'missing'}`,
  );

  const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
  const fixtures: Fixture[] = JSON.parse(raw);
  console.log(`[eval] loaded ${fixtures.length} fixtures`);

  const rows: EvalRow[] = [];

  for (const fx of fixtures) {
    const heuristicInput: PlaceExtractionInput = {
      source: asShareSource(fx.input.sourceType),
      title: fx.input.title ?? null,
      description: fx.input.description ?? null,
      url: fx.input.url ?? '',
      cleanedQuery: null,
    };
    const heuristic =
      extractPlaceQueryFromShareMetadata(heuristicInput) ?? {
        query: '',
        confidence: 'low' as const,
        reason: 'no-extraction',
      };

    // Resolve transcript (either from fixture or via placeholder provider).
    // Eval MUST tolerate unavailable transcription — it's a fallback signal.
    const { transcript, result: transcriptionResult } = await resolveTranscript(fx);

    const ai = await extractPlaceAI({
      sourceType: fx.input.sourceType,
      url: fx.input.url,
      title: fx.input.title,
      description: fx.input.description,
      transcript: transcript ?? undefined,
      fallbackQuery: heuristic.query || undefined,
      profileMetadata: fx.input.profileMetadata,
    });

    const placesTopResult = await placesLookup(ai.query || heuristic.query);

    // Run the v2 evidence pipeline. The eval treats this as the
    // authoritative auto-save decision.
    const pipeline = runExtractionPipeline({
      source: asShareSource(fx.input.sourceType),
      url: fx.input.url ?? '',
      title: fx.input.title ?? null,
      description: fx.input.description ?? null,
      cleanedQuery: heuristic.query || null,
      posterHandle: fx.input.posterHandle ?? null,
      enrichments: fx.input.profileMetadata?.map((profile) => ({
        handle: profile.handle,
        classification: profile.classification,
        category: profile.category,
        displayName: profile.displayName,
        extractedName: profile.extractedName,
        extractedAddress: profile.extractedAddress,
        extractedCity: profile.extractedCity,
        confidence: profile.confidence,
      })),
      transcript: transcript ?? null,
      ai: ai
        ? {
            query: ai.query,
            placeName: ai.placeName ?? null,
            address: ai.address ?? null,
            city: ai.city ?? null,
            state: ai.state ?? null,
            posterType: ai.posterType,
            taggedAccounts: ai.taggedAccounts,
            confidence: ai.confidence,
            reason: ai.reason,
            needsUserConfirmation: ai.needsUserConfirmation,
          }
        : null,
    });

    const verifiedProfile = pickBestVerifiedVenueProfile(
      fx.input.profileMetadata ?? [],
      [fx.input.posterHandle],
    );
    const searchAllowed = shouldSearchPlaces(pipeline.query, {
      title: fx.input.title ?? null,
      description: fx.input.description ?? null,
      transcript: transcript ?? null,
      placeName: pipeline.placeName,
      address: pipeline.address,
      city: pipeline.city,
      state: pipeline.state,
      sourceContext: pipeline.sourceContext,
      profileExtractedName: verifiedProfile?.extractedName ?? null,
      profileExtractedAddress: verifiedProfile?.extractedAddress ?? null,
      profileExtractedCity: verifiedProfile?.extractedCity ?? null,
      accountIdentityOnly: false,
      accountIdentitySource: pipeline.evidence.nameSource === 'verified_profile' ? 'verified_profile' : null,
    });

    const heuristicMatch = softMatch(heuristic.query, fx.expectedQuery);
    const aiMatch = softMatch(ai.query, fx.expectedQuery);
    const pipelineMatch = softMatch(pipeline.query, fx.expectedQuery);
    const queryPass =
      fx.expectedQuery === ''
        ? heuristic.query.trim() === '' && ai.query.trim() === '' && pipeline.query.trim() === ''
        : pipelineMatch || aiMatch || heuristicMatch;
    const nameSourcePass =
      fx.expectedNameSource == null || pipeline.evidence.nameSource === fx.expectedNameSource;
    const searchAllowedPass =
      typeof fx.expectedSearchAllowed === 'boolean'
        ? searchAllowed === fx.expectedSearchAllowed
        : true;

    // Auto-save assertion: only enforced when the fixture explicitly sets
    // expectedAutoSave. A wrong silent-save (false positive) or a missed
    // safe save (false negative) both fail the fixture.
    const autoSaveAssertionPass: boolean | null =
      typeof fx.expectedAutoSave === 'boolean'
        ? pipeline.autoSaveAllowed === fx.expectedAutoSave
        : null;

    const pass =
      queryPass &&
      nameSourcePass &&
      searchAllowedPass &&
      (autoSaveAssertionPass === null || autoSaveAssertionPass === true);
    const aiBeatsHeuristic = aiMatch && !heuristicMatch;

    const notes: string[] = [];
    if (aiBeatsHeuristic) notes.push('AI BEATS HEURISTIC');
    if (!aiMatch && heuristicMatch) notes.push('heuristic better than AI');
    if (!pipelineMatch && !aiMatch && !heuristicMatch && fx.expectedQuery) notes.push('all missed');
    if (fx.expectedQuery === '' && (!queryPass || heuristic.query.trim() !== '' || ai.query.trim() !== '' || pipeline.query.trim() !== '')) {
      notes.push('false positive');
    }
    if (!nameSourcePass && fx.expectedNameSource) {
      notes.push(`name-source mismatch: expected=${fx.expectedNameSource} actual=${pipeline.evidence.nameSource}`);
    }
    if (!searchAllowedPass && typeof fx.expectedSearchAllowed === 'boolean') {
      notes.push(`search-allowed mismatch: expected=${fx.expectedSearchAllowed} actual=${searchAllowed}`);
    }
    if (autoSaveAssertionPass === false) {
      notes.push(
        `auto-save mismatch: expected=${fx.expectedAutoSave} actual=${pipeline.autoSaveAllowed}` +
          (pipeline.needsConfirmationReason
            ? ` reason=${pipeline.needsConfirmationReason}`
            : ''),
      );
    }

    rows.push({
      name: fx.name,
      input: fx.input,
      expectedQuery: fx.expectedQuery,
      expectedAutoSave: fx.expectedAutoSave,
      heuristicQuery: heuristic.query,
      heuristicConfidence: heuristic.confidence,
      heuristicReason: heuristic.reason ?? '',
      aiQuery: ai.query,
      aiConfidence: ai.confidence,
      aiReason: ai.reason,
      pipelineQuery: pipeline.query,
      pipelineNameSource: pipeline.evidence.nameSource,
      searchAllowed,
      transcript: transcript,
      transcriptionStatus: transcriptionResult.status,
      transcriptionProvider: transcriptionResult.provider,
      transcriptionReason: transcriptionResult.reason ?? '',
      placesTopResult,
      pipelineAutoSaveAllowed: pipeline.autoSaveAllowed,
      pipelineBlockedReason: pipeline.needsConfirmationReason ?? null,
      pipelinePosterType: pipeline.posterType,
      autoSaveAssertionPass,
      pass,
      aiBeatsHeuristic,
      notes: notes.join('; '),
    });
  }

  // Summary
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const aiWins = rows.filter((r) => r.aiBeatsHeuristic).length;
  const autoSaveAsserted = rows.filter((r) => r.autoSaveAssertionPass !== null).length;
  const autoSavePassed = rows.filter((r) => r.autoSaveAssertionPass === true).length;

  console.log('\n[eval] === Summary ===');
  console.log(`[eval] total=${total} passed=${passed} aiBeatsHeuristic=${aiWins}`);
  console.log(
    `[eval] auto-save assertions: ${autoSavePassed}/${autoSaveAsserted} passed`,
  );
  console.log('\n[eval] === Per-fixture ===');
  for (const r of rows) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    const marker = r.aiBeatsHeuristic ? ' ★' : '';
    const autoSaveLine =
      r.autoSaveAssertionPass === null
        ? `       pipeline:  autoSave=${r.pipelineAutoSaveAllowed} poster=${r.pipelinePosterType}` +
          (r.pipelineBlockedReason ? ` blocked=${r.pipelineBlockedReason}` : '') +
          '\n'
        : `       pipeline:  autoSave=${r.pipelineAutoSaveAllowed} (expected ${r.expectedAutoSave}) poster=${r.pipelinePosterType}` +
          (r.pipelineBlockedReason ? ` blocked=${r.pipelineBlockedReason}` : '') +
          '\n';
    console.log(
      `[eval] ${tag}${marker} ${r.name}\n` +
        `       expected:  "${r.expectedQuery}"\n` +
        `       heuristic: "${r.heuristicQuery}" (${r.heuristicConfidence}, ${r.heuristicReason})\n` +
        `       ai:        "${r.aiQuery}" (${r.aiConfidence}) ${r.aiReason}\n` +
        `       transcr:   ${r.transcriptionStatus} via ${r.transcriptionProvider}` +
        (r.transcriptionReason ? ` (${r.transcriptionReason})` : '') +
        (r.transcript ? ` -- "${r.transcript.slice(0, 80)}"` : '') +
        '\n' +
        autoSaveLine +
        (r.placesTopResult ? `       places:    ${r.placesTopResult}\n` : '') +
        (r.notes ? `       notes:     ${r.notes}\n` : ''),
    );
  }

  // Write log
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const outPath = path.join(LOGS_DIR, `share-extraction-eval-${todayStamp()}.json`);
  const report = {
    runAt: new Date().toISOString(),
    geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
    googlePlacesKeyPresent: Boolean(process.env.GOOGLE_PLACES_KEY),
    summary: {
      total,
      passed,
      aiBeatsHeuristic: aiWins,
      autoSaveAsserted,
      autoSavePassed,
    },
    results: rows,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[eval] wrote report -> ${path.relative(ROOT, outPath)}`);
}

main().catch((err) => {
  console.error('[eval] fatal:', err);
  process.exit(1);
});
