/**
 * Shadow-mode evaluation harness for the new share-extraction agent.
 *
 * STAGE 1 — does NOT change app behavior. Compares:
 *   - the OLD pipeline result (via runExtractionPipeline + lib/aiExtractPlace)
 *   - the NEW agent result (lib/shareAgent.runShareAgent)
 *   - the deterministic safety gate verdict
 *   - reasoning + tools used
 *
 * Two fixture sources:
 *   1. scripts/share-extraction-fixtures.json
 *      Existing pipeline fixtures. Re-run through the agent in shadow mode
 *      to surface diffs; no agent assertion is enforced.
 *   2. scripts/share-agent-behavior-fixtures.json
 *      New agent-only behavior fixtures. expectedSafetyDecision is asserted.
 *
 * Network calls (Gemini, Places, IG profile) only happen when keys are
 * present — otherwise the agent gracefully degrades and the eval reports
 * `failed` with reason gemini_key_missing.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  runShareAgent,
  type ShareAgentPlatform,
  type ProfileBioResult,
  type PlacesSearchCandidate,
  type AgentResponse,
} from '../lib/shareAgent';
import { buildClientAgentBlock } from '../lib/shareAgent/userFacing';
import {
  extractPlaceQueryFromShareMetadata,
  type PlaceExtractionInput,
} from '../lib/placeExtractor';
import type { ShareSource } from '../lib/shareParser';
import { extractPlaceAI } from '../lib/aiExtractPlace';
import { runExtractionPipeline } from '../lib/extractionPipeline';

type LegacyFixture = {
  name: string;
  input: {
    title: string;
    description: string;
    url: string;
    sourceType: string;
    posterHandle?: string;
    profileMetadata?: Array<Record<string, unknown>>;
  };
  expectedQuery: string;
};

type AgentFixture = {
  name: string;
  input: {
    url: string;
    platform: ShareAgentPlatform;
    title: string | null;
    description: string | null;
    detectedHandles?: {
      posterHandle: string | null;
      taggedHandles: string[];
      allHandles: string[];
    };
    profileBios?: ProfileBioResult[];
    prefetchedPlaces?: PlacesSearchCandidate[];
  };
  expectedSafetyDecision?: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  expectedSafeToAutoSave?: boolean;
  expectedEvidenceContains?: string[];
  /**
   * STAGE 3 — assert what the host-app surface should be after the
   * deterministic safety gate. `auto_save` is now a permitted outcome
   * when (and only when) every safety rule passes; otherwise the
   * agent surfaces `candidate_confirmation` or `manual_fallback`.
   */
  expectedUserFacingDecision?: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  /**
   * Stage-3 negative assertion: agent must NOT silently save for this
   * fixture. Prior fixtures used `expectMustNotAutoSaveInStage2`; both
   * names are accepted for backward compatibility.
   */
  expectMustNotAutoSave?: boolean;
  expectMustNotAutoSaveInStage2?: boolean;
  /**
   * STAGE 4 — behavior-based assertions (preferred over brittle exact
   * query strings). All optional and additive.
   *
   *   expectedPlaceNameContains  — case-insensitive substrings that
   *       MUST appear in the resolvedPlace.name. Use to assert "agent
   *       picked the right venue" without nailing the full string.
   *   forbiddenPlaceNameContains — case-insensitive substrings that
   *       MUST NOT appear in resolvedPlace.name. Use to assert "agent
   *       did NOT pick the wrong (e.g. influencer-named) place".
   *   mustCallTool / mustNotCallTool — toolInvocations whose `tool`
   *       field is asserted to (not) appear in the run.
   *   expectedAutoSaveAllowed — alias for expectedSafeToAutoSave with
   *       intent-aligned naming.
   */
  expectedPlaceNameContains?: string[];
  forbiddenPlaceNameContains?: string[];
  mustCallTool?: string[];
  mustNotCallTool?: string[];
  expectedAutoSaveAllowed?: boolean;
};

const ROOT = path.resolve(__dirname, '..');
const LEGACY_FIXTURES = path.join(ROOT, 'scripts', 'share-extraction-fixtures.json');
const AGENT_FIXTURES = path.join(ROOT, 'scripts', 'share-agent-behavior-fixtures.json');
const LOGS_DIR = path.join(ROOT, 'logs');

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asShareSource(s: string): ShareSource {
  if (s === 'tiktok' || s === 'instagram' || s === 'link') return s;
  return 'link';
}

function asPlatform(s: string): ShareAgentPlatform {
  if (s === 'tiktok' || s === 'instagram' || s === 'youtube' || s === 'twitter' || s === 'link') return s;
  return 'link';
}

async function runLegacyFixtureShadow(fx: LegacyFixture): Promise<{
  legacy: {
    pipelineQuery: string;
    pipelineAutoSave: boolean;
    pipelineBlockedReason: string | null;
  };
  agent: AgentResponse;
}> {
  // Mirror the existing pipeline path (heuristic + AI + pipeline).
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
  const ai = await extractPlaceAI({
    sourceType: fx.input.sourceType,
    url: fx.input.url,
    title: fx.input.title,
    description: fx.input.description,
    fallbackQuery: heuristic.query || undefined,
    profileMetadata: fx.input.profileMetadata as any,
  });
  const pipeline = runExtractionPipeline({
    source: asShareSource(fx.input.sourceType),
    url: fx.input.url ?? '',
    title: fx.input.title ?? null,
    description: fx.input.description ?? null,
    cleanedQuery: heuristic.query || null,
    posterHandle: fx.input.posterHandle ?? null,
    enrichments: (fx.input.profileMetadata ?? []).map((p: any) => ({
      handle: p.handle,
      classification: p.classification,
      category: p.category,
      displayName: p.displayName,
      extractedName: p.extractedName,
      extractedAddress: p.extractedAddress,
      extractedCity: p.extractedCity,
      confidence: p.confidence,
    })),
    transcript: null,
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

  // Now run the new agent in shadow mode using the SAME inputs (we do NOT
  // refetch metadata or hit IG; the agent uses what we pass in).
  const profileBios: ProfileBioResult[] = (fx.input.profileMetadata ?? []).map((p: any) => ({
    status: 'ok',
    handle: String(p.handle ?? ''),
    platform: 'instagram',
    displayName: p.displayName ?? null,
    category: p.category ?? null,
    bio: p.bio ?? null,
    website: p.website ?? null,
  }));
  const agent = await runShareAgent({
    url: fx.input.url ?? '',
    platform: asPlatform(fx.input.sourceType),
    title: fx.input.title ?? null,
    description: fx.input.description ?? null,
    profileBios,
    env: {
      geminiApiKey: process.env.GEMINI_API_KEY ?? null,
      googlePlacesKey: process.env.GOOGLE_PLACES_KEY ?? null,
    },
    allowPlacesSearch: !!process.env.GOOGLE_PLACES_KEY,
  });

  return {
    legacy: {
      pipelineQuery: pipeline.query,
      pipelineAutoSave: pipeline.autoSaveAllowed,
      pipelineBlockedReason: pipeline.needsConfirmationReason ?? null,
    },
    agent,
  };
}

async function runAgentFixture(fx: AgentFixture): Promise<AgentResponse> {
  return runShareAgent({
    url: fx.input.url,
    platform: fx.input.platform,
    title: fx.input.title,
    description: fx.input.description,
    detectedHandles: fx.input.detectedHandles ?? null,
    profileBios: fx.input.profileBios ?? [],
    prefetchedPlaces: fx.input.prefetchedPlaces,
    env: {
      geminiApiKey: process.env.GEMINI_API_KEY ?? null,
      googlePlacesKey: process.env.GOOGLE_PLACES_KEY ?? null,
    },
    allowPlacesSearch: !!process.env.GOOGLE_PLACES_KEY,
  });
}

async function main(): Promise<void> {
  console.log('[agent-shadow] starting shadow eval');
  console.log(
    `[agent-shadow] GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'present' : 'missing'} ` +
      `GOOGLE_PLACES_KEY=${process.env.GOOGLE_PLACES_KEY ? 'present' : 'missing'}`,
  );

  const legacyFixtures: LegacyFixture[] = JSON.parse(fs.readFileSync(LEGACY_FIXTURES, 'utf8'));
  const agentFixtures: AgentFixture[] = JSON.parse(fs.readFileSync(AGENT_FIXTURES, 'utf8'));

  const legacyRows: Array<{
    name: string;
    legacyQuery: string;
    legacyAutoSave: boolean;
    legacyBlockedReason: string | null;
    agentDecision: string;
    safetyDecision: string;
    safeToAutoSave: boolean;
    confidence: string;
    evidence: string[];
    toolsUsed: string[];
    reasoningPreview: string;
    diffsAutoSave: boolean;
  }> = [];

  for (const fx of legacyFixtures) {
    try {
      const { legacy, agent } = await runLegacyFixtureShadow(fx);
      const safeAuto = agent.safety.safeToAutoSave;
      legacyRows.push({
        name: fx.name,
        legacyQuery: legacy.pipelineQuery,
        legacyAutoSave: legacy.pipelineAutoSave,
        legacyBlockedReason: legacy.pipelineBlockedReason,
        agentDecision: agent.proposal.decision,
        safetyDecision: agent.safety.decision,
        safeToAutoSave: safeAuto,
        confidence: agent.proposal.confidence,
        evidence: agent.proposal.evidenceUsed,
        toolsUsed: agent.proposal.toolsUsed,
        reasoningPreview: (agent.proposal.reasoning ?? '').slice(0, 160),
        diffsAutoSave: legacy.pipelineAutoSave !== safeAuto,
      });
    } catch (err) {
      console.log(`[agent-shadow] legacy fixture ${fx.name} threw: ${(err as Error)?.message}`);
    }
  }

  const agentRows: Array<{
    name: string;
    safetyDecision: string;
    expectedSafetyDecision: string | null;
    safeToAutoSave: boolean;
    expectedSafeToAutoSave: boolean | null;
    confidence: string;
    evidence: string[];
    expectedEvidenceContains: string[];
    decisionPass: boolean;
    autoSavePass: boolean;
    evidencePass: boolean;
    userFacingDecision: string | null;
    expectedUserFacingDecision: string | null;
    userFacingPass: boolean;
    noAutoSavePass: boolean;
    downgradedFromAutoSave: boolean;
    pass: boolean;
    reasoningPreview: string;
  }> = [];

  // STAGE 5 — captured from the first agent run that returns a debug
  // block. Used for the promptVersion banner + JSON report.
  let agentPromptVersion: string | null = null;

  for (const fx of agentFixtures) {
    let agent: AgentResponse | null = null;
    try {
      agent = await runAgentFixture(fx);
    } catch (err) {
      console.log(`[agent-shadow] agent fixture ${fx.name} threw: ${(err as Error)?.message}`);
      continue;
    }
    if (!agentPromptVersion && agent.debug?.promptVersion) {
      agentPromptVersion = agent.debug.promptVersion;
    }
    const decisionPass =
      !fx.expectedSafetyDecision || agent.safety.decision === fx.expectedSafetyDecision;
    const autoSavePass =
      typeof fx.expectedSafeToAutoSave !== 'boolean' ||
      agent.safety.safeToAutoSave === fx.expectedSafeToAutoSave;
    const evidencePass =
      !fx.expectedEvidenceContains ||
      fx.expectedEvidenceContains.every((k) => agent!.proposal.evidenceUsed.includes(k as any));
    // STAGE 2 — derive the user-facing surface and verify hardcap.
    const clientBlock = buildClientAgentBlock(agent);
    const userFacingPass =
      !fx.expectedUserFacingDecision ||
      (clientBlock?.userFacingDecision ?? null) === fx.expectedUserFacingDecision;
    const noAutoSavePass =
      (fx.expectMustNotAutoSave !== true && fx.expectMustNotAutoSaveInStage2 !== true) ||
      (clientBlock?.safeToAutoSave === false &&
        clientBlock?.userFacingDecision !== ('auto_save' as any));
    // STAGE 4 — behavior-based (not query-string-based) assertions.
    const resolvedNameLower = (agent.resolvedPlace?.name ?? '').toLowerCase();
    const expectedNamePass =
      !fx.expectedPlaceNameContains ||
      fx.expectedPlaceNameContains.every((s) => resolvedNameLower.includes(s.toLowerCase()));
    const forbiddenNamePass =
      !fx.forbiddenPlaceNameContains ||
      fx.forbiddenPlaceNameContains.every((s) => !resolvedNameLower.includes(s.toLowerCase()));
    const toolsCalled: string[] = (agent.debug?.toolInvocations ?? []).map((t) => t.tool);
    const mustCallToolPass =
      !fx.mustCallTool || fx.mustCallTool.every((t: string) => toolsCalled.includes(t));
    const mustNotCallToolPass =
      !fx.mustNotCallTool || fx.mustNotCallTool.every((t: string) => !toolsCalled.includes(t));
    const autoSaveAllowedPass =
      typeof fx.expectedAutoSaveAllowed !== 'boolean' ||
      agent.safety.safeToAutoSave === fx.expectedAutoSaveAllowed;
    const pass =
      decisionPass &&
      autoSavePass &&
      evidencePass &&
      userFacingPass &&
      noAutoSavePass &&
      expectedNamePass &&
      forbiddenNamePass &&
      mustCallToolPass &&
      mustNotCallToolPass &&
      autoSaveAllowedPass;
    agentRows.push({
      name: fx.name,
      safetyDecision: agent.safety.decision,
      expectedSafetyDecision: fx.expectedSafetyDecision ?? null,
      safeToAutoSave: agent.safety.safeToAutoSave,
      expectedSafeToAutoSave:
        typeof fx.expectedSafeToAutoSave === 'boolean' ? fx.expectedSafeToAutoSave : null,
      confidence: agent.proposal.confidence,
      evidence: agent.proposal.evidenceUsed,
      expectedEvidenceContains: fx.expectedEvidenceContains ?? [],
      decisionPass,
      autoSavePass,
      evidencePass,
      userFacingDecision: clientBlock?.userFacingDecision ?? null,
      expectedUserFacingDecision: fx.expectedUserFacingDecision ?? null,
      userFacingPass,
      noAutoSavePass,
      downgradedFromAutoSave: clientBlock?.downgradedFromAutoSave ?? false,
      pass,
      reasoningPreview: (agent.proposal.reasoning ?? '').slice(0, 200),
    });
  }

  const total = agentRows.length;
  const passed = agentRows.filter((r) => r.pass).length;
  const diffs = legacyRows.filter((r) => r.diffsAutoSave).length;

  // STAGE 5 — emit promptVersion banner so eval logs / CI artifacts can
  // attribute behavior changes to a specific prompt revision. Read it
  // from the agentRows captured above (no extra Gemini calls).
  const promptVersion = agentPromptVersion ?? 'unknown';
  console.log(`\n[agent-shadow] promptVersion=${promptVersion}`);

  console.log('\n[agent-shadow] === Agent behavior fixtures ===');
  console.log(`[agent-shadow] total=${total} passed=${passed}`);

  // STAGE 5 — failure-reason summary (count of why each fix failed).
  const failureBuckets: Record<string, number> = {};
  for (const r of agentRows.filter((x) => !x.pass)) {
    const tag = (label: string) => {
      failureBuckets[label] = (failureBuckets[label] ?? 0) + 1;
    };
    if (!r.decisionPass) tag('decision_mismatch');
    if (!r.autoSavePass) tag('auto_save_mismatch');
    if (!r.evidencePass) tag('evidence_missing');
    if (!r.userFacingPass) tag('user_facing_mismatch');
    if (!r.noAutoSavePass) tag('forbidden_auto_save');
  }
  if (Object.keys(failureBuckets).length > 0) {
    console.log(
      '[agent-shadow] failure_buckets=' +
        Object.entries(failureBuckets)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join(' '),
    );
  }
  for (const r of agentRows) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `[agent-shadow] ${tag} ${r.name}\n` +
        `       safety=${r.safetyDecision}` +
        (r.expectedSafetyDecision ? ` (expected ${r.expectedSafetyDecision})` : '') +
        ` safeAuto=${r.safeToAutoSave}` +
        (r.expectedSafeToAutoSave !== null ? ` (expected ${r.expectedSafeToAutoSave})` : '') +
        ` confidence=${r.confidence}\n` +
        `       userFacing=${r.userFacingDecision ?? '∅'}` +
        (r.expectedUserFacingDecision
          ? ` (expected ${r.expectedUserFacingDecision})`
          : '') +
        (r.downgradedFromAutoSave ? ' [DOWNGRADED_FROM_AUTO_SAVE]' : '') +
        '\n' +
        `       evidence=${r.evidence.join(',') || '(none)'}\n` +
        (r.reasoningPreview ? `       reasoning="${r.reasoningPreview}"\n` : ''),
    );
  }
  console.log('\n[agent-shadow] === Legacy-vs-agent shadow comparison ===');
  console.log(`[agent-shadow] legacy_fixtures=${legacyRows.length} autoSave_diffs=${diffs}`);
  for (const r of legacyRows) {
    const marker = r.diffsAutoSave ? ' DIFF' : '';
    console.log(
      `[agent-shadow]${marker} ${r.name}\n` +
        `       legacy:  query="${r.legacyQuery}" autoSave=${r.legacyAutoSave}` +
        (r.legacyBlockedReason ? ` blocked=${r.legacyBlockedReason}` : '') +
        '\n' +
        `       agent:   decision=${r.agentDecision} safety=${r.safetyDecision} safeAuto=${r.safeToAutoSave} conf=${r.confidence}\n` +
        `       evidence=${r.evidence.join(',') || '(none)'}\n` +
        `       tools=${r.toolsUsed.join(',') || '(none)'}\n` +
        (r.reasoningPreview ? `       reasoning="${r.reasoningPreview}"\n` : ''),
    );
  }

  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const outPath = path.join(LOGS_DIR, `share-agent-shadow-eval-${todayStamp()}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        promptVersion: agentPromptVersion ?? 'unknown',
        geminiKeyPresent: !!process.env.GEMINI_API_KEY,
        googlePlacesKeyPresent: !!process.env.GOOGLE_PLACES_KEY,
        summary: {
          agentTotal: total,
          agentPassed: passed,
          legacyDiffs: diffs,
          failureBuckets,
        },
        agentFixtures: agentRows,
        legacyShadow: legacyRows,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n[agent-shadow] wrote report -> ${path.relative(ROOT, outPath)}`);
}

main().catch((err) => {
  console.error('[agent-shadow] fatal:', err);
  process.exit(1);
});
