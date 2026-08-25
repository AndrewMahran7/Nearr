import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateAiPlaceNote } from '../../../../lib/aiPlaceNote.js';
import { loadConfig } from '../config/env.js';
import { parseEnvContent } from '../config/loadEnvFiles.js';
import { AI_NOTE_VOICE_FIXTURES } from '../evaluation/aiNoteVoiceFixtures.js';
import { selectModelProvider } from '../providers/model.js';

type Usage = { inputTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number };
type Count = { value: string; count: number; percentage: number };

const INPUT_USD_PER_MILLION = 0.30;
const OUTPUT_USD_PER_MILLION = 2.50;
const MAX_FAMILY_SHARE = 0.40;
const MAX_EXACT_OPENER_COUNT = 3;
const MAX_AVERAGE_COST_USD = 0.001;

function args(): { base: string; output: string; envFile?: string } {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '(end)'}`);
    values.set(key, value);
  }
  const base = values.get('--base');
  const output = values.get('--output');
  if (!base || !output) throw new Error('Usage: --base <sha> --output <json> [--env-file <path>]');
  return { base, output: path.resolve(output), envFile: values.get('--env-file') };
}

function loadExplicitEnv(file: string | undefined): void {
  if (!file) return;
  for (const [key, value] of Object.entries(parseEnvContent(readFileSync(path.resolve(file), 'utf8')))) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function legacyPrompt(base: string): string {
  const source = execFileSync('git', [
    'show', `${base}:services/media-worker/src/prompts/placeEvidencePrompt.ts`,
  ], { encoding: 'utf8' });
  const match = /export const PLACE_EVIDENCE_SYSTEM_PROMPT = `([\s\S]*?)`\.trim\(\);/.exec(source);
  if (!match?.[1]) throw new Error(`Could not read legacy prompt from ${base}`);
  return match[1];
}

function legacyUserContext(fixture: typeof AI_NOTE_VOICE_FIXTURES[number]): string {
  const retained = fixture.evidence.slice(0, 16).map((item) => {
    const timestamp = typeof item.timestampSeconds === 'number' ? ` @${item.timestampSeconds.toFixed(1)}s` : '';
    return `- ${item.source}${timestamp}: ${item.value.slice(0, 240)}`;
  });
  return [
    'platform: deterministic_fixture',
    [
      'TARGETED AI-NOTE ENRICHMENT:',
      `final_place_name: ${fixture.placeName}`,
      `final_place_category: ${fixture.category}`,
      'final_place_address: (unknown)',
      'The final saved place above is authoritative. Do not identify, replace,',
      'correct, or suggest a different venue. Return exactly one place object',
      'whose name is exactly final_place_name.',
    ].join('\n'),
    `PLACE-SCOPED RETAINED EVIDENCE:\n${retained.join('\n')}`,
    'transcript:\n(none)',
    'visible_text:\nnot separately extracted - use retained observations',
    'Return ONLY the JSON object described above.',
  ].join('\n\n');
}

async function callLegacy(input: {
  apiKey: string;
  model: string;
  prompt: string;
  fixture: typeof AI_NOTE_VOICE_FIXTURES[number];
}): Promise<{ note: string | null; usage: Usage | null }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${input.prompt}\n\n${legacyUserContext(input.fixture)}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`Legacy Gemini HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '';
  const parsed = JSON.parse(text);
  const place = Array.isArray(parsed?.places)
    ? parsed.places.find((candidate: any) => candidate?.name === input.fixture.placeName) ?? parsed.places[0]
    : null;
  const usage = json.usageMetadata ? {
    inputTokens: Number(json.usageMetadata.promptTokenCount) || 0,
    outputTokens: Number(json.usageMetadata.candidatesTokenCount) || 0,
    thinkingTokens: Number(json.usageMetadata.thoughtsTokenCount) || 0,
    totalTokens: Number(json.usageMetadata.totalTokenCount) || 0,
  } : null;
  return { note: typeof place?.memoryCue === 'string' ? place.memoryCue.trim() : null, usage };
}

function tokens(note: string): string[] {
  return note.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

function countPhrase(notes: Array<string | null>, phrase: string): number {
  const target = phrase.toLowerCase();
  return notes.filter((note) => note?.toLowerCase().includes(target)).length;
}

function isFirstPersonOpener(note: string): boolean {
  return /^(?:i\b|i'd\b|i'm\b|i'll\b|i've\b|me\b|my\b)/i.test(note.trim());
}

function isVerbLed(note: string): boolean {
  return /^(?:imagine|picture|watch|look|try|give|bring|make|take|walk|walking|climb|climbing|swim|swimming|drive|driving|need|skip|count|put|save|show)\b/i.test(note.trim());
}

function isFragment(note: string): boolean {
  const value = note.trim().replace(/[.!?]+$/, '');
  if (/^(?:way|absolutely|ridiculously|seriously|honestly|too|so|nope|never|worth)\b/i.test(value)) return true;
  const finiteVerb = /\b(?:am|are|is|was|were|be|been|being|look|looks|looked|feel|feels|felt|want|wants|wanted|need|needs|needed|have|has|had|do|does|did|can|could|will|would|should|might|must)\b/i;
  return !finiteVerb.test(value) && !isVerbLed(value);
}

function structuralFamily(note: string | null): string | null {
  if (!note) return null;
  const value = note.trim();
  if (/^That .+\b(?:looks|looked|is|was)\b/i.test(value)) return 'that + looks/looked/is/was';
  if (/^Looks like\b/i.test(value)) return 'looks like';
  if (/^This\b/i.test(value)) return 'this demonstrative';
  if (isFirstPersonOpener(value)) return 'first-person opener';
  if (/\?/.test(value)) return 'question-led or rhetorical';
  if (isFragment(value)) return 'fragment';
  if (isVerbLed(value)) return 'imperative or verb-led';
  if (/^(?:That|Those|These)\b/i.test(value)) return 'other demonstrative';
  if (/^(?:Okay|Wow|Nope|Seriously|Honestly|Absolutely)\b/i.test(value)) return 'interjection-led';
  return `other: ${tokens(value)[0] ?? 'unknown'}`;
}

function counts(values: string[], denominator: number): Count[] {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return [...result.entries()]
    .map(([value, count]) => ({ value, count, percentage: denominator ? count / denominator : 0 }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function summarize(notes: Array<string | null>) {
  const values = notes.filter((note): note is string => !!note);
  const tokenized = values.map(tokens);
  const familyCounts = counts(values.map((note) => structuralFamily(note)!), values.length);
  return {
    generated: values.length,
    omitted: notes.length - values.length,
    phraseFrequency: {
      'looked unreal': countPhrase(notes, 'looked unreal'),
      'caught your eye': countPhrase(notes, 'caught your eye'),
      'looks amazing': countPhrase(notes, 'looks amazing'),
      'I want to': countPhrase(notes, 'I want to'),
      'need to': countPhrase(notes, 'need to'),
    },
    openerTokens: counts(tokenized.map((value) => value[0]).filter(Boolean) as string[], values.length),
    firstTwoTokenOpeners: counts(tokenized.map((value) => value.slice(0, 2).join(' ')).filter(Boolean), values.length),
    repeatedThreeWordPrefixes: counts(tokenized.map((value) => value.slice(0, 3).join(' ')).filter(Boolean), values.length)
      .filter((item) => item.count > 1),
    constructionFrequency: {
      'That ... looks/looked/is/was ...': values.filter((note) => /^That .+\b(?:looks|looked|is|was)\b/i.test(note)).length,
      'This ...': values.filter((note) => /^This\b/i.test(note)).length,
      'Looks like ...': values.filter((note) => /^Looks like\b/i.test(note)).length,
      'first-person openers': values.filter(isFirstPersonOpener).length,
      fragments: values.filter(isFragment).length,
      questions: values.filter((note) => /\?/.test(note)).length,
      'imperative or verb-led': values.filter(isVerbLed).length,
    },
    structuralFamilies: familyCounts,
    largestStructuralFamily: familyCounts[0] ?? null,
  };
}

function totalUsage(items: Array<Usage | null>): Usage {
  return items.reduce<Usage>((sum, usage) => ({
    inputTokens: sum.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: sum.outputTokens + (usage?.outputTokens ?? 0),
    thinkingTokens: sum.thinkingTokens + (usage?.thinkingTokens ?? 0),
    totalTokens: sum.totalTokens + (usage?.totalTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 });
}

function averageUsage(usage: Usage, count: number): Usage {
  return Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, value / count])) as Usage;
}

function estimatedCost(usage: Usage): number {
  return (
    usage.inputTokens * INPUT_USD_PER_MILLION +
    (usage.outputTokens + usage.thinkingTokens) * OUTPUT_USD_PER_MILLION
  ) / 1_000_000;
}

async function main(): Promise<void> {
  const cli = args();
  loadExplicitEnv(cli.envFile);
  process.env.MEDIA_ANALYSIS_PROVIDER = 'gemini';
  process.env.VAYRIN_VISUAL_GEOLOCATION_ENABLED = 'false';
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  const oldPrompt = legacyPrompt(cli.base);
  const provider = selectModelProvider(cfg);
  const rows: any[] = [];

  for (const fixture of AI_NOTE_VOICE_FIXTURES) {
    const before = await callLegacy({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel, prompt: oldPrompt, fixture });
    const generated = await provider.analyze({
      platform: 'deterministic_fixture',
      canonicalUrl: `fixture://${fixture.id}`,
      transcript: [],
      ocr: [],
      ocrExtracted: false,
      frames: [],
      metadataTitle: null,
      metadataDescription: null,
      targetPlace: { name: fixture.placeName, category: fixture.category },
      retainedEvidence: fixture.evidence,
      signal: new AbortController().signal,
    });
    const place = generated.evidence.places[0];
    const evaluated = evaluateAiPlaceNote({
      placeName: fixture.placeName,
      proposedNote: place?.memoryCue,
      evidence: place?.memoryCueEvidence ?? [],
    });
    const after = evaluated.note;
    const lower = after?.toLowerCase() ?? '';
    rows.push({
      id: fixture.id,
      group: fixture.group,
      label: fixture.label,
      evidence: fixture.evidence,
      before: before.note,
      proposedAfter: place?.memoryCue ?? null,
      after,
      disposition: evaluated.status === 'generated' ? 'accepted' : 'rejected',
      rejectionReason: evaluated.status === 'generated' ? null : evaluated.reason ?? evaluated.status,
      structuralFamily: structuralFamily(place?.memoryCue ?? null),
      validation: evaluated,
      evaluation: {
        grounded: evaluated.status === 'generated',
        concise: !!after && (after.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 18,
        summaryLike: /^(?:the|this) (?:video|post)|\b(?:video|post) (?:shows|showcases)\b/i.test(after ?? ''),
        marketingLike: /\bmust[- ]visit|destination|you should|worth checking out\b/i.test(lower),
        natural: !!after && !/^(?:the|this) (?:video|post)/i.test(after),
      },
      usage: { before: before.usage, after: generated.usage ?? null },
    });
  }

  const beforeUsage = totalUsage(rows.map((row) => row.usage.before));
  const afterUsage = totalUsage(rows.map((row) => row.usage.after));
  const beforeAverage = averageUsage(beforeUsage, rows.length);
  const afterAverage = averageUsage(afterUsage, rows.length);
  const beforeSummary = summarize(rows.map((row) => row.before));
  const afterSummary = summarize(rows.map((row) => row.after));
  const accepted = afterSummary.generated;
  const unsupportedAcceptedClaims = rows.filter((row) => row.after && !row.evaluation.grounded).length;
  const summaryLikeAccepted = rows.filter((row) => row.after && row.evaluation.summaryLike).length;
  const thatCount = afterSummary.constructionFrequency['That ... looks/looked/is/was ...'];
  const thatShare = accepted ? thatCount / accepted : 1;
  const largestFamily = afterSummary.largestStructuralFamily;
  const largestOpener = afterSummary.firstTwoTokenOpeners[0] ?? null;
  const largestPrefix = afterSummary.repeatedThreeWordPrefixes[0] ?? null;
  const averageCostUsd = estimatedCost(afterAverage);
  const gateFailures: string[] = [];
  if (!accepted) gateFailures.push('no accepted outputs');
  if (unsupportedAcceptedClaims > 0) gateFailures.push(`${unsupportedAcceptedClaims} unsupported accepted claim(s)`);
  if (summaryLikeAccepted > 0) gateFailures.push(`${summaryLikeAccepted} summary-like accepted output(s)`);
  if (thatShare > MAX_FAMILY_SHARE) gateFailures.push(`That + looks family ${(thatShare * 100).toFixed(1)}% > 40%`);
  if (largestFamily && largestFamily.percentage > MAX_FAMILY_SHARE) gateFailures.push(`${largestFamily.value} family ${(largestFamily.percentage * 100).toFixed(1)}% > 40%`);
  if (largestOpener && largestOpener.count > MAX_EXACT_OPENER_COUNT) gateFailures.push(`exact two-token opener "${largestOpener.value}" occurs ${largestOpener.count} times`);
  if (largestPrefix && largestPrefix.percentage > MAX_FAMILY_SHARE) gateFailures.push(`three-token prefix "${largestPrefix.value}" ${(largestPrefix.percentage * 100).toFixed(1)}% > 40%`);
  if (averageCostUsd >= MAX_AVERAGE_COST_USD) gateFailures.push(`average estimated cost $${averageCostUsd.toFixed(6)} >= $0.001`);

  const report = {
    generatedAt: new Date().toISOString(),
    baseSha: cli.base,
    model: cfg.geminiModel,
    fixtureCount: rows.length,
    before: beforeSummary,
    after: afterSummary,
    grounding: { unsupportedAcceptedClaims, summaryLikeAccepted },
    pricing: {
      assumption: 'Gemini 2.5 Flash standard paid tier, USD per 1M tokens',
      inputUsdPerMillion: INPUT_USD_PER_MILLION,
      outputIncludingThinkingUsdPerMillion: OUTPUT_USD_PER_MILLION,
    },
    usage: {
      beforeTotal: beforeUsage,
      afterTotal: afterUsage,
      beforeAverage,
      afterAverage,
      beforeAverageEstimatedCostUsd: estimatedCost(beforeAverage),
      afterAverageEstimatedCostUsd: averageCostUsd,
    },
    releaseGate: {
      passed: gateFailures.length === 0,
      thresholds: {
        maxStructuralFamilyShare: MAX_FAMILY_SHARE,
        maxExactTwoTokenOpenerCount: MAX_EXACT_OPENER_COUNT,
        maxAverageEstimatedCostUsd: MAX_AVERAGE_COST_USD,
      },
      failures: gateFailures,
    },
    rows,
  };
  await mkdir(path.dirname(cli.output), { recursive: true });
  await writeFile(cli.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.releaseGate.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[ai-note-voice-eval] ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
