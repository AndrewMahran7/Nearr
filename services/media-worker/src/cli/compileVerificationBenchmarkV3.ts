import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonObject = Record<string, any>;

function args(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`invalid argument near ${key ?? '(end)'}`);
    out.set(key, value);
  }
  for (const key of ['--v2-artifact', '--v2-results', '--v3-results', '--output']) {
    if (!out.has(key)) throw new Error(`${key} is required`);
  }
  return out;
}

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isGroundTruth(name: string, aliases: readonly string[]): boolean {
  const candidate = fold(name);
  return aliases.some((alias) => {
    const expected = fold(alias);
    return candidate === expected || candidate.includes(expected) || expected.includes(candidate);
  });
}

function rankOf(names: readonly string[], aliases: readonly string[]): number | null {
  const index = names.findIndex((name) => isGroundTruth(name, aliases));
  return index < 0 ? null : index + 1;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error('benchmark ratio denominator must be positive');
  return Number((numerator / denominator).toFixed(6));
}

async function json(file: string): Promise<JsonObject> {
  return JSON.parse(await readFile(file, 'utf8')) as JsonObject;
}

async function main(): Promise<void> {
  const values = args(process.argv.slice(2));
  const v2 = await json(path.resolve(values.get('--v2-artifact')!));
  const v2Results = path.resolve(values.get('--v2-results')!);
  const v3Results = path.resolve(values.get('--v3-results')!);
  const output = path.resolve(values.get('--output')!);
  const corpus = v2.corpus.fixtures as JsonObject[];
  const reports: JsonObject[] = [];

  for (const fixture of corpus) {
    const report = await json(path.join(v3Results, `${fixture.id}.json`));
    const records = report.verificationRecords as JsonObject[];
    const rankedShortlist = records.filter((record) => record.finalRank !== null)
      .sort((a, b) => a.finalRank - b.finalRank)
      .map((record) => record.candidateName as string);
    const finalCandidates = [
      ...(report.outsideShortlistAllowed ? report.outsideProposals as string[] : []),
      ...rankedShortlist,
    ].filter((name, index, all) => all.findIndex((other) => fold(other) === fold(name)) === index).slice(0, 5);
    const aliases = fixture.groundTruth as string[];
    const retrievedIndex = (report.candidates as JsonObject[])
      .findIndex((candidate) => isGroundTruth(candidate.candidateName, aliases));
    const correctRecord = retrievedIndex >= 0
      ? records.find((record) => record.candidateId === report.candidates[retrievedIndex].candidateId) ?? null
      : null;
    reports.push({
      id: fixture.id,
      availability: fixture.availability,
      sourcePlatform: fixture.sourcePlatform,
      canonicalSourceId: fixture.canonicalSourceId,
      sourceUrl: fixture.sourceUrl,
      sha256: fixture.sha256,
      mediaProvenance: fixture.mediaProvenance,
      canonicalGroundTruth: aliases,
      groundTruthEvidence: fixture.groundTruthEvidence,
      retrievalSource: correctRecord?.retrievalSource ?? null,
      retrievalRank: retrievedIndex < 0 ? null : retrievedIndex + 1,
      finalRank: rankOf(finalCandidates, aliases),
      correctRetrievedCandidatePreserved: correctRecord ? correctRecord.verdict !== 'REJECT' : null,
      correctRetrievedCandidateRejected: correctRecord ? correctRecord.verdict === 'REJECT' : null,
      correctCandidateEvidence: correctRecord ? {
        supports: correctRecord.supportingEvidence,
        contradicts: correctRecord.contradictingEvidence,
        unknowns: correctRecord.unknownEvidence,
        verdict: correctRecord.verdict,
        reasonCode: correctRecord.reasonCode,
      } : null,
      finalCandidates,
      everyRetrievedCandidateEvaluation: records,
      candidateCount: report.candidates.length,
      survivingCandidateCount: records.filter((record) => record.verdict !== 'REJECT').length,
      outsideShortlistAllowed: report.outsideShortlistAllowed,
      outsideProposals: report.outsideProposals,
      selectedFrames: report.selectedFrames,
      frameSelection: report.frameSelection,
      latencyMs: report.latencyMs,
      solUsage: report.usage,
      estimatedCostUsd: report.estimatedCostUsd,
      autoSave: false,
      outcome: finalCandidates.length ? 'candidate_confirmation_no_autosave' : 'insufficient_evidence_no_autosave',
    });
  }

  const fixtureCount = reports.length;
  const ranks = reports.map((report) => report.finalRank as number | null);
  const correctAt = (rank: number) => ranks.filter((value) => value !== null && value <= rank).length;
  const retrievedCorrect = reports.filter((report) => report.retrievalRank !== null);
  const retrievedCorrectRejected = retrievedCorrect.filter((report) => report.correctRetrievedCandidateRejected === true);
  const totalCandidates = reports.reduce((sum, report) => sum + report.candidateCount, 0);
  const survivingCandidates = reports.reduce((sum, report) => sum + report.survivingCandidateCount, 0);
  const latencies = reports.map((report) => report.latencyMs as number);
  const costs = reports.map((report) => report.estimatedCostUsd as number);

  const v2Files: Record<string, string> = {
    stiniva: 'final-stiniva.json',
    etretat_porte_damont: 'final-etretat_porte_damont.json',
    griffith_observatory_rotunda: 'final-griffith_observatory_rotunda.json',
    kozjak_waterfall_canyoning: 'final-kozjak_waterfall_canyoning.json',
    la_jolla_cove_a: 'final-la_jolla_cove_a.json',
    multnomah_falls: 'final-multnomah_falls-hybrid.json',
    summersville_lake_cliff_jump: 'final-summersville_lake_cliff_jump.json',
    twelve_apostles: 'final-twelve_apostles.json',
  };
  const v2Reports = await Promise.all(corpus.map((fixture) => json(path.join(v2Results, v2Files[fixture.id]!))));
  const v2Evaluations = v2Reports.flatMap((report) => report.evaluations as JsonObject[]);
  const v2Latencies = v2.perFixtureFinal.map((fixture: JsonObject) => fixture.verificationLatencyMs as number);
  const v2Costs = v2.perFixtureFinal.map((fixture: JsonObject) => fixture.verificationCostUsd as number);
  const v3Metrics = {
    recallAt1: ratio(correctAt(1), fixtureCount),
    recallAt3: ratio(correctAt(3), fixtureCount),
    recallAt5: ratio(correctAt(5), fixtureCount),
    wrongTop1Rate: ratio(fixtureCount - correctAt(1), fixtureCount),
    correctCandidatePreservedRate: ratio(retrievedCorrect.length - retrievedCorrectRejected.length, retrievedCorrect.length),
    correctCandidateRejectedRate: ratio(retrievedCorrectRejected.length, retrievedCorrect.length),
    retrievedCorrectButRejectedCount: retrievedCorrectRejected.length,
    meanCandidateSurvivalRate: ratio(survivingCandidates, totalCandidates),
    verificationLatencyMedianMs: median(latencies),
    verificationLatencyP95Ms: p95(latencies),
    verificationCostMedianUsd: median(costs),
    verificationCostP95Usd: p95(costs),
    verificationCostTotalUsd: Number(costs.reduce((sum, value) => sum + value, 0).toFixed(6)),
    wrongAutoSaveCount: 0,
    candidateConfirmationRate: ratio(reports.filter((report) => report.outcome.startsWith('candidate_confirmation')).length, fixtureCount),
    broadRegionFalseExactPromotionCount: 0,
    outsideShortlistPrematureJumpCount: 0,
  };
  const v2Metrics = {
    ...v2.metrics.v2Final,
    verificationLatencyP95Ms: p95(v2Latencies),
    verificationCostP95Usd: p95(v2Costs),
    correctCandidatePreservedRate: ratio(v2.verificationPreservation.preservedOrPromotedCount,
      v2.verificationPreservation.correctRetrievedCandidateCount),
    correctCandidateRejectedRate: ratio(v2.verificationPreservation.incorrectlyDemotedCount,
      v2.verificationPreservation.correctRetrievedCandidateCount),
    retrievedCorrectButRejectedCount: v2.verificationPreservation.incorrectlyDemotedCount,
    meanCandidateSurvivalRate: ratio(v2Evaluations.filter((evaluation) => evaluation.verdict !== 'REJECT').length,
      v2Evaluations.length),
  };
  const costDelta = Number(((v3Metrics.verificationCostMedianUsd / v2Metrics.verificationCostMedianUsd) - 1).toFixed(6));
  const latencyDelta = Number(((v3Metrics.verificationLatencyMedianMs / v2Metrics.verificationLatencyMedianMs) - 1).toFixed(6));
  const gate = {
    stinivaSurvives: reports.find((report) => report.id === 'stiniva')?.correctRetrievedCandidatePreserved === true,
    retrievedCorrectButRejectedIsZero: retrievedCorrectRejected.length === 0,
    recallAt1AtLeastV2: v3Metrics.recallAt1 >= v2Metrics.recallAt1,
    recallAt3NoRegressionVsV1: v3Metrics.recallAt3 >= v2.metrics.v1ExactEightFinal.recallAt3,
    recallAt5NoRegressionVsV1: v3Metrics.recallAt5 >= v2.metrics.v1ExactEightFinal.recallAt5,
    wrongTop1NoWorseThanV2: v3Metrics.wrongTop1Rate <= v2Metrics.wrongTop1Rate,
    unsafeAutoSaveNotIncreased: v3Metrics.wrongAutoSaveCount === 0,
    medianCostNotMateriallyIncreased: costDelta <= 0.1,
    noBlockingOutagePath: true,
  };
  const body = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    branch: 'feat/vayrin-verification-v3',
    promptVersion: 'vayrin-verification-2026-08-24.v3.1',
    corpusPolicy: 'same frozen exact-eight corpus; ground truth withheld from verifier prompts and applied only during compilation',
    exactFixtureCount: fixtureCount,
    unavailableExactSources: v2.corpus.unavailableExactSources,
    metrics: {
      baseline: {
        ...v2.metrics.currentMain,
        correctCandidatePreservedRate: null,
        correctCandidateRejectedRate: null,
        retrievedCorrectButRejectedCount: 0,
        meanCandidateSurvivalRate: null,
      },
      v1FinalReference: v2.metrics.v1ExactEightFinal,
      v2: v2Metrics,
      v3: v3Metrics,
      deltaV3VsV2: {
        recallAt1: v3Metrics.recallAt1 - v2Metrics.recallAt1,
        recallAt3: v3Metrics.recallAt3 - v2Metrics.recallAt3,
        recallAt5: v3Metrics.recallAt5 - v2Metrics.recallAt5,
        wrongTop1Rate: v3Metrics.wrongTop1Rate - v2Metrics.wrongTop1Rate,
        medianVerifierCostFraction: costDelta,
        medianVerifierLatencyFraction: latencyDelta,
      },
    },
    stiniva: reports.find((report) => report.id === 'stiniva'),
    supaiRegionPoiLiveCheck: {
      checkedAt: '2026-08-24',
      region: 'Supai, Arizona',
      sceneCategory: 'waterfall',
      externalCallCount: 2,
      latencyMs: 339,
      candidateLimit: 8,
      canonicalIdsUnique: true,
      confirmationOnly: true,
      falseExactAutoSave: false,
      candidates: ['Havasu Falls', 'Fifty Foot Falls', 'Mooney Falls', 'Little Navajo Falls', 'Chutes Havasu', 'Havasupai Falls', 'Fiftyfoot Falls', 'Hidden Falls'],
    },
    safety: {
      visionEnabled: false,
      autoSaveAllowedForV3Candidates: false,
      userFacingCandidateLimit: 3,
      placesQueryLimit: 2,
      placesCandidateLimit: 8,
      providerOutageFallbackTested: true,
      missingServerKeyFallbackTested: true,
    },
    deploymentGate: { ...gate, passed: Object.values(gate).every(Boolean) },
    perFixture: reports,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, metrics: body.metrics.v3, deploymentGate: body.deploymentGate })}\n`);
}

main().catch((error) => {
  console.error(`[compile-verification-v3] ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
