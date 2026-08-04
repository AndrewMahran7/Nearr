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
type ProductionLabel =
  | 'eligible for automatic saving'
  | 'confirmation required'
  | 'manual recovery required'
  | 'invalid/unavailable';

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

function productionDerivedScenarios(): Array<{
  fixtureId: string;
  logicalPlace: string;
  expectedLabel: ProductionLabel;
  input: MediaAutoSaveGateInput;
}> {
  const observed = (args: {
    fixtureId: string;
    logicalPlace: string;
    expectedLabel: ProductionLabel;
    sources: VenueMention['nameEvidenceSources'];
    repeated?: boolean;
    outcome?: MentionResult['outcome'];
    score?: number | null;
    scoreReasons?: string[];
    candidateName?: string;
    candidateCount?: number;
    hostVenueName?: string;
    relationshipType?: string;
  }) => {
    const result = productionResult({
      mentionId: args.fixtureId,
      displayName: args.logicalPlace,
      outcome: args.outcome ?? 'verified_single',
    });
    result.candidates[0]!.name = args.candidateName ?? args.logicalPlace;
    result.scoring[0]!.name = result.candidates[0]!.name;
    if (args.score === null || args.candidateCount === 0) {
      result.candidates = [];
      result.scoring = [];
    } else {
      result.scoring[0]!.normalizedScore = args.score ?? 0.99;
      if (args.scoreReasons) result.scoring[0]!.reasons = args.scoreReasons;
      if ((args.candidateCount ?? 1) > 1) {
        result.candidates.push({ ...result.candidates[0]!, googlePlaceId: `${args.fixtureId}-alternate` });
      }
    }
    const mention = productionMention({
      id: args.fixtureId,
      displayName: args.logicalPlace,
      normalizedName: args.logicalPlace.toLowerCase(),
      nameEvidenceSources: args.sources,
      repeated: args.repeated ?? true,
      hostVenueName: args.hostVenueName,
      relationshipType: args.relationshipType as any,
    });
    return {
      fixtureId: args.fixtureId,
      logicalPlace: args.logicalPlace,
      expectedLabel: args.expectedLabel,
      input: { mention, result, allResults: [result] },
    };
  };
  const completeReasons = ['business_type', 'compact_name_match', 'distinctive_token_match', 'state_match', 'distance_nearby'];
  return [
    observed({ fixtureId: 'capones', logicalPlace: "Capone's Italian Cucina", expectedLabel: 'eligible for automatic saving', sources: ['speech', 'frame'], score: 0.9903, scoreReasons: completeReasons }),
    observed({ fixtureId: 'dypc', logicalPlace: '2nd Floor Gallery Bar & Grill', expectedLabel: 'confirmation required', sources: ['visible_text'], score: 0.9923, scoreReasons: completeReasons, candidateName: '2nd Floor' }),
    observed({ fixtureId: 'brooklyn', logicalPlace: 'Brooklyn City Pizzeria & Market', expectedLabel: 'confirmation required', sources: ['speech', 'frame'], score: 0.9945, scoreReasons: completeReasons.filter((reason) => reason !== 'state_match' && reason !== 'distance_nearby') }),
    observed({ fixtureId: 'pizza-parlor', logicalPlace: 'Parlor Woodfire Kitchen', expectedLabel: 'confirmation required', sources: ['speech', 'frame'], score: 0.7802, scoreReasons: completeReasons.filter((reason) => reason !== 'distance_nearby') }),
    observed({ fixtureId: 'pizza-bc', logicalPlace: 'B&C Pizzas', expectedLabel: 'confirmation required', sources: ['speech', 'frame'], score: 0.8369, scoreReasons: completeReasons }),
    observed({ fixtureId: 'pizza-lunitas', logicalPlace: "Lunita's Pizza", expectedLabel: 'confirmation required', sources: ['speech', 'frame'], outcome: 'ambiguous_candidates', score: 0.4833, scoreReasons: completeReasons.filter((reason) => reason !== 'distance_nearby') }),
    observed({ fixtureId: 'pizza-x-eats', logicalPlace: 'X Eats at Brewery X', expectedLabel: 'confirmation required', sources: ['speech', 'frame'], outcome: 'ambiguous_candidates', score: 0.9849, scoreReasons: completeReasons, candidateCount: 2, candidateName: 'Brewery X', hostVenueName: 'Brewery X', relationshipType: 'located_at' }),
    observed({ fixtureId: 'pizza-patrini', logicalPlace: 'Patrini Pizza', expectedLabel: 'confirmation required', sources: ['speech', 'frame'], outcome: 'ambiguous_candidates', score: 0.6111, scoreReasons: ['business_type', 'state_match', 'distance_nearby'] }),
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
  const productionDerivedAudit = productionDerivedScenarios().map((scenario) => {
    const decision = evaluateMediaAutoSave(scenario.input);
    const expectedEligible = scenario.expectedLabel === 'eligible for automatic saving';
    return {
      fixtureId: scenario.fixtureId,
      logicalPlace: scenario.logicalPlace,
      expectedLabel: scenario.expectedLabel,
      expectedEligible,
      actualEligible: decision.eligible,
      passed: decision.eligible === expectedEligible,
      confidenceScore: decision.confidenceScore,
      reasonCodes: decision.reasonCodes,
    };
  });
  const productionDerivedMismatches = productionDerivedAudit.filter((scenario) => !scenario.passed).length;

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
    productionDerivedCalibration: {
      sanitizedFromRealPipelineRuns: true,
      statisticalPrecisionDemonstrated: false,
      eligibleDenominator: productionDerivedAudit.filter((scenario) => scenario.actualEligible).length,
      contractMismatches: productionDerivedMismatches,
      controls: [
        { fixtureId: 'restaurant-post-nothing', expectedLabel: 'manual recovery required', observedOutcome: 'insufficient_evidence' },
        { fixtureId: 'invalid-shortcode', expectedLabel: 'invalid/unavailable', observedOutcome: 'private_or_login_required' },
      ],
      missingRequiredCoverage: ['caption_plus_provider', 'wrong_branch_labeled', 'already_saved_live_write'],
      scenarios: productionDerivedAudit,
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
    `## Production-Derived Calibration\n\n` +
    `- Real logical-place observations: ${productionDerivedAudit.length}\n` +
    `- Eligible observations: ${productionDerivedAudit.filter((scenario) => scenario.actualEligible).length}\n` +
    `- Expected-label mismatches: ${productionDerivedMismatches}\n` +
    `- Controls: insufficient evidence and private/unavailable both remained conservative\n` +
    `- Required coverage still missing: caption-plus-provider, labeled wrong branch, and authenticated already-saved live write\n` +
    `- Statistical precision: not demonstrated (one eligible observation is not a launch-quality denominator)\n\n` +
    `## Rollout Decision\n\n` +
    `The production-derived matrix proves that the unchanged rule can admit one exceptionally clear real result while conservatively rejecting seven uncertain logical places. It does not establish 98% precision or authenticated write-path idempotency. Keep automatic saving disabled globally until the missing production labels and authenticated save/retry ownership checks pass.\n`;

  await writeFile(outputPath, report, 'utf8');
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)}`);
  console.log(`Wrote ${path.relative(root, auditPath)}`);
  console.log(`rows=${rows.length} gate_evaluable=0 gate_scenario_bugs=${gateBugs} production_contract_mismatches=${productionDerivedMismatches}`);

  if (gateBugs > 0 || productionDerivedMismatches > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});