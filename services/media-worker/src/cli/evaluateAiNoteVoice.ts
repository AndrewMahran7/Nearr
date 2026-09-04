import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  classifyAiNoteStructure,
  evaluateAiNoteCorpus,
  evaluateAiPlaceNote,
  isMalformedAiNote,
  isSummaryLikeAiNote,
} from '../../../../lib/aiPlaceNote.js';
import { loadConfig } from '../config/env.js';
import { parseEnvContent } from '../config/loadEnvFiles.js';
import { AI_NOTE_VOICE_FIXTURES } from '../evaluation/aiNoteVoiceFixtures.js';
import { selectModelProvider } from '../providers/model.js';

type Usage = { inputTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number };
type Count = { value: string; count: number; percentage: number };

const INPUT_USD_PER_MILLION = 0.30;
const OUTPUT_USD_PER_MILLION = 2.50;
const MAX_FAMILY_SHARE = 0.40;
const MAX_AVERAGE_COST_USD = 0.001;

function args(): { output: string; envFile?: string; groups?: Set<string>; perGroup?: number } {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '(end)'}`);
    values.set(key, value);
  }
  const output = values.get('--output');
  if (!output) throw new Error('Usage: --output <json> [--env-file <path>] [--groups food,outdoors] [--per-group 5]');
  const groupsValue = values.get('--groups');
  const perGroupValue = values.get('--per-group');
  const perGroup = perGroupValue === undefined ? undefined : Number(perGroupValue);
  if (perGroup !== undefined && (!Number.isInteger(perGroup) || perGroup <= 0)) {
    throw new Error('--per-group must be a positive integer');
  }
  return {
    output: path.resolve(output),
    envFile: values.get('--env-file'),
    groups: groupsValue ? new Set(groupsValue.split(',').map((value) => value.trim()).filter(Boolean)) : undefined,
    perGroup,
  };
}

function loadExplicitEnv(file: string | undefined): void {
  if (!file) return;
  for (const [key, value] of Object.entries(parseEnvContent(readFileSync(path.resolve(file), 'utf8')))) {
    if (!process.env[key]) process.env[key] = value;
  }
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
  return note ? classifyAiNoteStructure(note) : null;
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
      'looks incredible': countPhrase(notes, 'looks incredible'),
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
  const provider = selectModelProvider(cfg);
  const rows: any[] = [];
  const groupCounts = new Map<string, number>();
  const selectedFixtures = AI_NOTE_VOICE_FIXTURES.filter((fixture) => {
    if (cli.groups && !cli.groups.has(fixture.group)) return false;
    const count = groupCounts.get(fixture.group) ?? 0;
    if (cli.perGroup !== undefined && count >= cli.perGroup) return false;
    groupCounts.set(fixture.group, count + 1);
    return true;
  });

  for (const fixture of selectedFixtures) {
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
      proposedAfter: place?.memoryCue ?? null,
      after,
      disposition: evaluated.status === 'generated' ? 'accepted' : 'rejected',
      rejectionReason: evaluated.status === 'generated' ? null : evaluated.reason ?? evaluated.status,
      structuralFamily: structuralFamily(place?.memoryCue ?? null),
      validation: evaluated,
      evaluation: {
        grounded: evaluated.status === 'generated',
        concise: !!after && (after.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 18,
        malformed: !!after && isMalformedAiNote(after),
        summaryLike: !!after && isSummaryLikeAiNote(after),
        marketingLike: /\bmust[- ]visit|destination|you should|worth checking out\b/i.test(lower),
        natural: !!after && !/^(?:the|this) (?:video|post)/i.test(after),
      },
      usage: { after: generated.usage ?? null },
    });
  }

  const afterUsage = totalUsage(rows.map((row) => row.usage.after));
  const afterAverage = averageUsage(afterUsage, rows.length);
  const afterSummary = summarize(rows.map((row) => row.after));
  const authenticity = evaluateAiNoteCorpus(rows.map((row) => row.after));
  const accepted = afterSummary.generated;
  const unsupportedAcceptedClaims = rows.filter((row) => row.after && !row.evaluation.grounded).length;
  const malformedAccepted = rows.filter((row) => row.after && row.evaluation.malformed).length;
  const summaryLikeAccepted = rows.filter((row) => row.after && row.evaluation.summaryLike).length;
  const largestFamily = afterSummary.largestStructuralFamily;
  const largestPrefix = afterSummary.repeatedThreeWordPrefixes[0] ?? null;
  const averageCostUsd = estimatedCost(afterAverage);
  const gateFailures: string[] = [];
  if (!accepted) gateFailures.push('no accepted outputs');
  if (unsupportedAcceptedClaims > 0) gateFailures.push(`${unsupportedAcceptedClaims} unsupported accepted claim(s)`);
  if (malformedAccepted > 0) gateFailures.push(`${malformedAccepted} malformed accepted output(s)`);
  if (summaryLikeAccepted > 0) gateFailures.push(`${summaryLikeAccepted} summary-like accepted output(s)`);
  if (authenticity.demonstrativeDescriptiveRate > 0.15) gateFailures.push(`demonstrative descriptive family ${(authenticity.demonstrativeDescriptiveRate * 100).toFixed(1)}% > 15%`);
  if (largestFamily && largestFamily.percentage > MAX_FAMILY_SHARE) gateFailures.push(`${largestFamily.value} family ${(largestFamily.percentage * 100).toFixed(1)}% > 40%`);
  if (largestPrefix && largestPrefix.count > 2) gateFailures.push(`three-token prefix "${largestPrefix.value}" occurs ${largestPrefix.count} times`);
  for (const [phrase, count] of Object.entries(authenticity.phraseCounts)) {
    if (count > 0) gateFailures.push(`"${phrase}" occurs ${count} time(s)`);
  }
  if (averageCostUsd >= MAX_AVERAGE_COST_USD) gateFailures.push(`average estimated cost $${averageCostUsd.toFixed(6)} >= $0.001`);

  const report = {
    generatedAt: new Date().toISOString(),
    model: cfg.geminiModel,
    fixtureCount: rows.length,
    after: afterSummary,
    authenticity,
    grounding: { unsupportedAcceptedClaims, malformedAccepted, summaryLikeAccepted },
    pricing: {
      assumption: 'Gemini 2.5 Flash standard paid tier, USD per 1M tokens',
      inputUsdPerMillion: INPUT_USD_PER_MILLION,
      outputIncludingThinkingUsdPerMillion: OUTPUT_USD_PER_MILLION,
    },
    usage: {
      afterTotal: afterUsage,
      afterAverage,
      afterAverageEstimatedCostUsd: averageCostUsd,
    },
    releaseGate: {
      passed: gateFailures.length === 0,
      thresholds: {
        maxStructuralFamilyShare: MAX_FAMILY_SHARE,
        maxDemonstrativeDescriptiveShare: 0.15,
        maxRepeatedThreeWordPrefixCount: 2,
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
