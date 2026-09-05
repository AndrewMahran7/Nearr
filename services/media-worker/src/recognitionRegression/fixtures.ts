import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FixtureCorrection, GroundTruthTarget, GroundTruthQuality, IntendedSpecificity, RecognitionCategory, RegressionCorpusCase } from './types.js';
import { validateCorpus } from './corpus.js';

type CorpusOverlay = {
  cases: Array<{ caseId: string; category: RecognitionCategory; sourceCaseId: string | null; sourceUrl?: string; sourceCorpus?: string; evidenceFixture?: string | null; researchOnly: boolean; fixtureKind?: 'LIVE_SOURCE' | 'CONTRACT_CONTROL' }>;
};
type TruthOverlay = {
  cases: Array<{
    caseId: string;
    quality: GroundTruthQuality;
    intendedSpecificity: IntendedSpecificity;
    canonicalNameOverride?: string;
    acceptedAliasesOverride?: string[];
    latitude?: number | null;
    longitude?: number | null;
    acceptableRadiusMeters?: number | null;
    requiredLocality?: string | null;
    parentPlaceNames?: string[];
    broaderAreaNames?: string[];
    expectedSafetyDecision: 'AUTO_SAVE' | 'REVIEW';
    autoSaveProhibited?: boolean;
    evidenceSources: Array<{ kind: string; reference: string; supports: string }>;
    notes?: string | null;
  }>;
  fixtureCorrections?: FixtureCorrection[];
};
type LegacyCorpus = { cases: Array<{ case_id: string; source_url: string; manual_frames_directory: string }> };
type LegacyTruth = { cases: Array<{ case_id: string; accepted_exact_identities: string[]; accepted_aliases: string[]; expected_broad_geography: string[] }> };
type FounderCliffCorpus = { cases: Array<{ caseId: string; sourceUrl: string; existingCaseId?: string }> };

function artifactRoot(repoRoot: string): string {
  return path.join(repoRoot, 'artifacts', 'recognition-regression');
}

export async function loadRegressionCorpus(repoRoot: string): Promise<RegressionCorpusCase[]> {
  const [overlayRaw, legacyRaw, cliffRaw] = await Promise.all([
    readFile(path.join(artifactRoot(repoRoot), 'corpus.json'), 'utf8'),
    readFile(path.join(repoRoot, 'artifacts', 'sol-parity', 'inference-corpus.json'), 'utf8'),
    readFile(path.join(artifactRoot(repoRoot), 'cliff-corpus.json'), 'utf8'),
  ]);
  const overlay = JSON.parse(overlayRaw) as CorpusOverlay;
  const legacy = JSON.parse(legacyRaw) as LegacyCorpus;
  const cliffs = JSON.parse(cliffRaw) as FounderCliffCorpus;
  const legacyById = new Map(legacy.cases.map((item) => [item.case_id, item]));
  const cases = overlay.cases.map((item): RegressionCorpusCase => {
    const source = item.sourceCaseId ? legacyById.get(item.sourceCaseId) : null;
    if (item.sourceCaseId && !source) throw new Error(`missing_legacy_source_case:${item.sourceCaseId}`);
    if (!source && !item.sourceUrl) throw new Error(`missing_direct_source_url:${item.caseId}`);
    return {
      ...item,
      sourceUrl: source?.source_url ?? item.sourceUrl!,
      sourceCorpus: source ? 'artifacts/sol-parity/inference-corpus.json' : item.sourceCorpus ?? 'artifacts/recognition-regression/corpus.json',
      evidenceFixture: source?.manual_frames_directory ?? item.evidenceFixture ?? null,
    };
  });
  for (const item of cliffs.cases.filter((entry) => !entry.existingCaseId)) cases.push({
    caseId: item.caseId,
    category: 'CLIFF_JUMPING',
    sourceUrl: item.sourceUrl,
    sourceCorpus: 'artifacts/recognition-regression/cliff-corpus.json',
    sourceCaseId: null,
    evidenceFixture: null,
    researchOnly: true,
  });
  validateCorpus(cases);
  return cases;
}

export async function loadRegressionGroundTruth(repoRoot: string): Promise<GroundTruthTarget[]> {
  const [overlayRaw, legacyRaw, cliffRaw] = await Promise.all([
    readFile(path.join(artifactRoot(repoRoot), 'ground-truth.json'), 'utf8'),
    readFile(path.join(repoRoot, 'artifacts', 'sol-parity', 'ground-truth.json'), 'utf8'),
    readFile(path.join(artifactRoot(repoRoot), 'cliff-corpus.json'), 'utf8'),
  ]);
  const overlay = JSON.parse(overlayRaw) as TruthOverlay;
  const legacy = JSON.parse(legacyRaw) as LegacyTruth;
  const cliffs = JSON.parse(cliffRaw) as FounderCliffCorpus;
  const legacyById = new Map(legacy.cases.map((item) => [item.case_id, item]));
  const targets = overlay.cases.map((item): GroundTruthTarget => {
    const source = legacyById.get(item.caseId);
    if (!source && !item.canonicalNameOverride) throw new Error(`missing_legacy_truth_case:${item.caseId}`);
    const exact = source?.accepted_exact_identities ?? [];
    return {
      caseId: item.caseId,
      canonicalName: item.canonicalNameOverride ?? exact[0] ?? '',
      acceptedAliases: item.acceptedAliasesOverride ?? [...exact.slice(1), ...(source?.accepted_aliases ?? [])],
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      acceptableRadiusMeters: item.acceptableRadiusMeters ?? null,
      intendedSpecificity: item.intendedSpecificity,
      quality: item.quality,
      requiredLocality: item.requiredLocality ?? null,
      parentPlaceNames: item.parentPlaceNames ?? [],
      broaderAreaNames: item.broaderAreaNames ?? source?.expected_broad_geography ?? [],
      expectedSafetyDecision: item.expectedSafetyDecision,
      autoSaveProhibited: item.autoSaveProhibited ?? false,
      evidenceSources: item.evidenceSources,
      notes: item.notes ?? null,
    };
  });
  for (const item of cliffs.cases.filter((entry) => !entry.existingCaseId)) targets.push({
    caseId: item.caseId,
    canonicalName: '',
    acceptedAliases: [],
    latitude: null,
    longitude: null,
    acceptableRadiusMeters: null,
    intendedSpecificity: 'SPECIFIC_PHYSICAL_PLACE',
    quality: 'PROVISIONAL',
    requiredLocality: null,
    parentPlaceNames: [],
    broaderAreaNames: [],
    expectedSafetyDecision: 'REVIEW',
    autoSaveProhibited: false,
    evidenceSources: [{ kind: 'FOUNDER_CORPUS', reference: `artifacts/recognition-regression/cliff-corpus.json#${item.caseId}`, supports: 'Source URL only; exact identity not yet verified' }],
    notes: 'Research-only until independently ground-truthed.',
  });
  return targets;
}

export async function loadFixtureCorrections(repoRoot: string): Promise<FixtureCorrection[]> {
  const overlay = JSON.parse(await readFile(path.join(artifactRoot(repoRoot), 'ground-truth.json'), 'utf8')) as TruthOverlay;
  return overlay.fixtureCorrections ?? [];
}
