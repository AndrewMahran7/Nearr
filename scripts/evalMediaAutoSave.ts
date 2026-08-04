import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateMediaAutoSave,
  MEDIA_AUTO_SAVE_MIN_SCORE,
  MEDIA_AUTO_SAVE_RULE_VERSION,
  type MediaAutoSaveGateInput,
} from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import type { MentionResult } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';

type GoldRow = {
  actual_candidate_place_id?: string;
  actual_decision?: string;
  category?: string;
  expected_decision?: string;
  place_pass?: boolean;
  safe_to_auto_save?: string | boolean;
  failure_type?: string;
  url?: string;
};

type AuditCategory = 'dataset_limitation' | 'pipeline_failure';

const MISSING_GATE_FIELDS = [
  'provider_coordinates',
  'per_candidate_score',
  'score_reason_codes',
  'media_name_evidence_channels',
  'media_name_repetition',
  'host_relationship',
] as const;

function truthy(value: unknown): boolean {
  return value === true || value === 'true';
}

function productionMention(overrides: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: 'Parlor Woodfire',
    normalizedName: 'parlor woodfire',
    distinctiveTokens: ['parlor', 'woodfire'],
    category: 'restaurant',
    sources: ['speech', 'visible_text'],
    nameEvidenceSources: ['speech', 'visible_text'],
    timestamps: [1, 8],
    mentionCount: 2,
    repeated: true,
    confidence: 0.95,
    geo: { city: 'Los Angeles', region: 'California', country: 'United States' },
    ...overrides,
  };
}

function productionResult(overrides: Partial<MentionResult> = {}): MentionResult {
  const candidate = {
    googlePlaceId: 'google-parlor',
    name: 'Parlor Woodfire',
    formattedAddress: '123 Main St, Los Angeles, CA 90001',
    latitude: 34.05,
    longitude: -118.24,
    types: ['restaurant'],
    confidenceScore: 0.96,
    evidence: [],
    reasons: [],
  } as any;
  return {
    mentionId: 'm1',
    displayName: 'Parlor Woodfire',
    outcome: 'verified_single',
    query: 'Parlor Woodfire Los Angeles California',
    candidates: [candidate],
    scoring: [{
      googlePlaceId: candidate.googlePlaceId,
      name: candidate.name,
      rawScore: 100,
      normalizedScore: 0.97,
      reasons: [
        'business_type',
        'compact_name_match',
        'distinctive_token_match',
        'state_match',
        'distance_nearby',
      ],
      rejected: false,
      rejectionReason: null,
    }],
    ...overrides,
  };
}

function productionScenarios(): Array<{
  id: string;
  expectedEligible: boolean;
  input: MediaAutoSaveGateInput;
}> {
  const eligible = productionResult();
  const lowScore = productionResult();
  lowScore.scoring[0]!.normalizedScore = MEDIA_AUTO_SAVE_MIN_SCORE - 0.01;
  const duplicateA = productionResult();
  const duplicateB = productionResult({ mentionId: 'm2', displayName: 'Duplicate Slot' });
  return [
    {
      id: 'verified_two_channel_repeated_place',
      expectedEligible: true,
      input: { mention: productionMention(), result: eligible, allResults: [eligible] },
    },
    {
      id: 'score_below_threshold',
      expectedEligible: false,
      input: { mention: productionMention(), result: lowScore, allResults: [lowScore] },
    },
    {
      id: 'single_name_evidence_channel',
      expectedEligible: false,
      input: {
        mention: productionMention({ nameEvidenceSources: ['speech'] }),
        result: productionResult(),
        allResults: [productionResult()],
      },
    },
    {
      id: 'venue_inside_host',
      expectedEligible: false,
      input: {
        mention: productionMention({ hostVenueName: 'Brewery X', relationshipType: 'located_at' }),
        result: productionResult(),
        allResults: [productionResult()],
      },
    },
    {
      id: 'duplicate_canonical_place_across_slots',
      expectedEligible: false,
      input: { mention: productionMention(), result: duplicateA, allResults: [duplicateA, duplicateB] },
    },
  ];
}

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const inputPath = path.join(root, 'artifacts', 'share-gold-results.json');
  const outputPath = path.join(root, 'artifacts', 'media-autosave-calibration.md');
  const auditPath = path.join(root, 'artifacts', 'media-autosave-calibration.json');
  const rows = JSON.parse(await readFile(inputPath, 'utf8')) as GoldRow[];
  const correct = rows.filter((row) => row.place_pass === true).length;
  const incorrect = rows.filter((row) => !!row.actual_candidate_place_id && row.place_pass !== true).length;
  const ambiguous = rows.filter((row) => /picker|multi|ambiguous/i.test(row.actual_decision ?? '')).length;
  const unmatched = rows.filter((row) => !row.actual_candidate_place_id).length;
  const wrongLocation = rows.filter((row) => /wrong_country|wrong_location|wrong_branch/i.test(row.failure_type ?? '')).length;
  const eligible = rows.filter((row) => truthy(row.safe_to_auto_save)).length;
  const eligibleCorrect = rows.filter((row) => truthy(row.safe_to_auto_save) && row.place_pass === true).length;
  const eligibleIncorrect = rows.filter((row) => truthy(row.safe_to_auto_save) && row.place_pass !== true).length;
  const duplicateRows = rows.length - new Set(rows.map((row) => row.url).filter(Boolean)).size;
  const candidatePrecision = correct + incorrect > 0 ? correct / (correct + incorrect) : null;
  const rowAudit = rows.map((row, index) => {
    const auditCategory: AuditCategory = row.place_pass === true
      ? 'dataset_limitation'
      : 'pipeline_failure';
    return {
      fixtureId: `gold-${String(index + 1).padStart(2, '0')}`,
      sourceCategory: row.category ?? 'unclassified',
      expectedDecision: row.expected_decision ?? 'unlabeled',
      actualDecision: row.actual_decision ?? 'unresolved',
      placeCorrect: row.place_pass === true,
      auditCategory,
      gateEvaluable: false,
      missingGateFields: MISSING_GATE_FIELDS,
    };
  });
  const categoryCounts = rowAudit.reduce<Record<AuditCategory, number>>(
    (counts, row) => ({ ...counts, [row.auditCategory]: counts[row.auditCategory] + 1 }),
    { dataset_limitation: 0, pipeline_failure: 0 },
  );
  const scenarioAudit = productionScenarios().map((scenario) => {
    const decision = evaluateMediaAutoSave(scenario.input);
    return {
      scenarioId: scenario.id,
      expectedEligible: scenario.expectedEligible,
      actualEligible: decision.eligible,
      passed: decision.eligible === scenario.expectedEligible,
      confidenceScore: decision.confidenceScore,
      reasonCodes: decision.reasonCodes,
    };
  });
  const gateBugs = scenarioAudit.filter((scenario) => !scenario.passed).length;

  const audit = {
    generatedBy: 'npm run eval:media-autosave',
    ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
    threshold: MEDIA_AUTO_SAVE_MIN_SCORE,
    legacyDataset: {
      rows: rows.length,
      gateEvaluableRows: 0,
      legacySafeFieldEligible: eligible,
      categoryCounts,
      fixtures: rowAudit,
    },
    productionShapedGateScenarios: {
      syntheticBehaviorChecksOnly: true,
      precisionEvidence: false,
      gateBugs,
      scenarios: scenarioAudit,
    },
  };

  const report = `# Media Auto-Save Calibration\n\n` +
    `Generated by: \`npm run eval:media-autosave\`\n\n` +
    `## Approved Dataset\n\n` +
    `- Labeled post-level rows: ${rows.length}\n` +
    `- Correct verified candidate: ${correct}\n` +
    `- Incorrect verified candidate: ${incorrect}\n` +
    `- Ambiguous/picker outcomes: ${ambiguous}\n` +
    `- Unmatched outcomes: ${unmatched}\n` +
    `- Wrong location/branch labels: ${wrongLocation}\n` +
    `- Duplicate fixture rows: ${duplicateRows}\n` +
    `- Candidate precision among rows with a candidate: ${candidatePrecision === null ? 'not available' : `${(candidatePrecision * 100).toFixed(1)}%`}\n\n` +
    `## Legacy Dataset Audit\n\n` +
    `- Rows evaluable by the production media gate: 0 of ${rows.length}\n` +
    `- Dataset limitations: ${categoryCounts.dataset_limitation}\n` +
    `- Legacy pipeline failures or unresolved outcomes: ${categoryCounts.pipeline_failure}\n` +
    `- Conservative gate failures observed: 0 (the required gate inputs were not recorded)\n` +
    `- Gate bugs observed from legacy rows: not measurable\n` +
    `- Legacy \`safe_to_auto_save\` true: ${eligible} (metadata-path output, not a production media-gate decision)\n` +
    `- Missing on every row: provider coordinates, per-candidate score and reason codes, media evidence channels/repetition, and host relationship labels\n\n` +
    `## Production-Shaped Gate Checks\n\n` +
    `- Scenarios: ${scenarioAudit.length}\n` +
    `- Expected eligible scenarios: ${scenarioAudit.filter((scenario) => scenario.expectedEligible).length}\n` +
    `- Expected conservative rejections: ${scenarioAudit.filter((scenario) => !scenario.expectedEligible).length}\n` +
    `- Contract mismatches / gate bugs: ${gateBugs}\n` +
    `- Auto-save precision: not demonstrated (synthetic behavior checks are not production outcomes)\n` +
    `- Host-only false auto-save: not measurable (host relationship is not labeled in this artifact)\n` +
    `- Duplicate insertion rate: measured separately by \`scripts/testShareJobPlaceResults.sql\` (expected 0%)\n` +
    `- Cross-user errors: measured separately by RLS/ownership SQL tests (expected 0)\n\n` +
    `## Rollout Decision\n\n` +
    `The stored gold artifact predates per-place Phase 2 gate diagnostics and cannot demonstrate the required 98% auto-save precision. Production-shaped scenarios prove that the current rule can admit a fully verified case while rejecting low-score, single-channel, host-related, and duplicate-canonical cases without lowering the 0.92 threshold. They are behavioral contracts, not statistical calibration. Keep automatic saving disabled globally until labeled production outcomes contain the full gate diagnostics, provide a non-zero eligible denominator, and demonstrate at least 98% precision.\n`;

  await writeFile(outputPath, report, 'utf8');
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)}`);
  console.log(`Wrote ${path.relative(root, auditPath)}`);
  console.log(`rows=${rows.length} gate_evaluable=0 gate_scenario_bugs=${gateBugs}`);

  if (gateBugs > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});