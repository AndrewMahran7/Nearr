import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config/env.js';
import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import { extractFrames } from '../pipeline/extractFrames.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { selectFramesForVayrin } from '../vayrin/frameSelection.js';
import { estimateVayrinCostUsd, runVisualGeolocation } from '../vayrin/visualGeolocationClient.js';
import {
  serializeCandidatesForVerificationV3,
  verifyRetrievedCandidatesV3,
  type VerificationCandidate,
} from '../vayrin/verificationV3.js';

function parseArgs(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`invalid argument near ${key ?? '(end)'}`);
    values.set(key, value);
  }
  for (const required of ['--video', '--candidate-report', '--fixture-id', '--output']) {
    if (!values.has(required)) throw new Error(`${required} is required`);
  }
  return values;
}

function candidatesForFixture(raw: unknown, fixtureId: string): VerificationCandidate[] {
  const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const fixtures = Array.isArray(root.fixtures) ? root.fixtures : [];
  const fixture = fixtures.find((item) => item && typeof item === 'object' &&
    (item as Record<string, unknown>).id === fixtureId) as Record<string, unknown> | undefined;
  if (!fixture) throw new Error('fixture_not_found');
  if (Array.isArray(fixture.candidates)) {
    return fixture.candidates.filter((item): item is VerificationCandidate => !!item && typeof item === 'object').slice(0, 8);
  }
  const names = Array.isArray(fixture.candidateNames)
    ? fixture.candidateNames.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const directCount = typeof fixture.directCandidateCount === 'number' ? Math.max(0, Math.floor(fixture.directCandidateCount)) : 0;
  return names.slice(0, 8).map((candidateName, index) => ({
    candidateId: `frozen:${index + 1}`,
    candidateName,
    initialRank: index + 1,
    source: index < directCount ? 'direct_image' : 'descriptor_web',
    retrievalStrength: index === 0 ? 'strong' : index < 3 ? 'moderate' : 'weak',
    retrievalEvidence: [`Frozen source-backed hybrid retrieval rank ${index + 1}.`],
    regionConsistent: false,
    confirmationOnly: true,
  }));
}

async function main(): Promise<void> {
  const values = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const video = path.resolve(values.get('--video')!);
  const output = path.resolve(values.get('--output')!);
  const fixtureId = values.get('--fixture-id')!;
  const candidates = candidatesForFixture(
    JSON.parse(await readFile(path.resolve(values.get('--candidate-report')!), 'utf8')),
    fixtureId,
  );
  const scratch = await mkdtemp(path.join(tmpdir(), 'nearr-verification-v3-'));
  const controller = new AbortController();
  try {
    const probe = await inspectMedia(cfg, video, controller.signal);
    const extracted = deduplicateFrames(await extractFrames(cfg, probe, video, scratch, controller.signal));
    const selection = selectFramesForVayrin(extracted, 'diverse', Math.min(6, cfg.vayrinFrameBudget));
    const result = await runVisualGeolocation({
      model: cfg.vayrinModel,
      reasoningEffort: cfg.vayrinReasoningEffort,
      signal: controller.signal,
      frames: selection.frames.map((frame) => ({ path: frame.path, timestampSeconds: frame.timestampSeconds })),
      context: {
        caption: values.get('--caption') ?? null,
        retrievedCandidatesJson: candidates.length > 0
          ? serializeCandidatesForVerificationV3(candidates)
          : null,
      },
    });
    if (!result.ok) throw new Error(result.code);
    const verification = verifyRetrievedCandidatesV3({
      candidates,
      evaluations: result.payload.retrieved_candidate_evaluations ?? [],
    });
    const outside = verification.outsideShortlistAllowed
      ? (result.payload.outside_candidate_proposals ?? []).map((proposal) => proposal.placeName)
      : [];
    const freeform = candidates.length === 0
      ? result.payload.place_hypotheses.map((hypothesis) => hypothesis.name).filter(Boolean)
      : [];
    // An outside proposal is admitted only after the deterministic weak/all-
    // contradicted gate. At that point it must be allowed to outrank the weak
    // shortlist instead of being truncated behind five preserved placeholders.
    const finalCandidates = [...outside, ...verification.rankedCandidates.map((candidate) => candidate.candidateName), ...freeform]
      .filter((name, index, all) => all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index)
      .slice(0, 5);
    const body = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      fixtureId,
      groundTruthWithheld: true,
      candidates,
      selectedFrames: selection.frames.map((frame) => ({ timestampSeconds: frame.timestampSeconds, reason: frame.reason })),
      frameSelection: {
        consideredCount: selection.consideredCount,
        meanPairwiseDistance: selection.meanPairwiseDistance,
        decisions: selection.decisions,
      },
      verificationRecords: verification.records,
      missingEvaluationCount: verification.missingEvaluationCount,
      outsideShortlistAllowed: verification.outsideShortlistAllowed,
      outsideProposals: outside,
      finalCandidates,
      latencyMs: result.latencyMs,
      usage: result.usage,
      estimatedCostUsd: estimateVayrinCostUsd(result.usage, {
        inputPerMillion: cfg.vayrinInputPricePerMillion,
        cachedInputPerMillion: cfg.vayrinCachedInputPricePerMillion,
        outputPerMillion: cfg.vayrinOutputPricePerMillion,
      }),
      autoSave: false,
      decision: finalCandidates.length > 0 ? 'candidate_confirmation' : 'insufficient_evidence',
    };
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ fixtureId, finalCandidates, latencyMs: body.latencyMs, estimatedCostUsd: body.estimatedCostUsd })}\n`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[verification-v3] ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
