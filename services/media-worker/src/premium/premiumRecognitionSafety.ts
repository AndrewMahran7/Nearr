import type { SolDestination, SourceEvidence } from '../solParity/types.js';
import type {
  PremiumCanonicalCandidate,
  PremiumCanonicalStatus,
  PremiumEvidenceBasis,
  PremiumSafetyDecision,
} from './premiumRecognitionTypes.js';

const MEMORY_LANGUAGE = /\b(?:famous|viral|well[- ]known|recognizable|internet|original video|model memory|remembered|iconic clip)\b/i;
const GENERIC_CLUE = /\b(?:public|outdoor|indoor|people|person|water|trees|building|restaurant|hotel|zoo|beach|lake|cliff)\b/i;

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function textContainsIdentity(text: string, name: string): boolean {
  const identity = normalize(name);
  return identity.length >= 3 && normalize(text).includes(identity);
}

export function inferPremiumEvidenceBasis(
  destination: SolDestination,
  evidence: SourceEvidence,
): PremiumEvidenceBasis {
  if (destination.supporting_clues.some((clue) => MEMORY_LANGUAGE.test(clue))) {
    return 'CONTEXTUAL_OR_MEMORY_PRIOR';
  }
  if (evidence.ocr.some((item) => textContainsIdentity(item.text, destination.name))) {
    return 'DIRECT_VISIBLE_IDENTITY';
  }
  const sourceText = [
    evidence.caption ?? '',
    ...evidence.transcript.map((item) => item.text),
  ].join(' ');
  if (textContainsIdentity(sourceText, destination.name)) return 'SOURCE_TEXT_IDENTITY';
  if (textContainsIdentity(evidence.source_location_context ?? '', destination.name)) {
    return 'CONTEXTUAL_OR_MEMORY_PRIOR';
  }
  return 'DISTINCTIVE_VISUAL_MATCH';
}

export function concreteDiscriminativeClueCount(clues: string[]): number {
  return clues.filter((clue) => {
    const words = normalize(clue).split(' ').filter(Boolean);
    return words.length >= 7 && !MEMORY_LANGUAGE.test(clue) &&
      (!GENERIC_CLUE.test(clue) || /\b(?:sign|address|logo|facade|shape|pattern|formation|skyline|inscription|route|shoreline|ledge|architecture)\b/i.test(clue));
  }).length;
}

export function evaluatePremiumRecognitionSafety(args: {
  hypothesis: SolDestination;
  evidenceBasis: PremiumEvidenceBasis;
  canonicalStatus: PremiumCanonicalStatus;
  canonical: PremiumCanonicalCandidate | null;
  hypothesisCount: number;
  destinationCount: number;
  allowDistinctiveVisualAutoSave?: boolean;
}): { decision: PremiumSafetyDecision; permissiveWouldAutoSave: boolean; reasons: string[] } {
  const { hypothesis } = args;
  const canonical = args.canonicalStatus === 'CANONICAL_EXACT' || args.canonicalStatus === 'CANONICAL_ALIAS';
  const dominant = args.hypothesisCount === 1 && args.destinationCount === 1;
  const noContradiction = hypothesis.contradictions.length === 0;
  const high = hypothesis.confidence === 'HIGH';
  const permissiveWouldAutoSave = canonical && dominant && noContradiction && high;
  const reasons: string[] = [];

  if (!hypothesis.name.trim()) {
    return { decision: 'REJECT', permissiveWouldAutoSave, reasons: ['missing_identity'] };
  }
  if (args.canonicalStatus === 'NAMED_LEAD') {
    return { decision: 'NAMED_LEAD', permissiveWouldAutoSave, reasons: ['provider_no_match_preserves_identity'] };
  }
  if (!canonical || !args.canonical) {
    return { decision: 'REVIEW', permissiveWouldAutoSave, reasons: ['canonicalization_ambiguous'] };
  }
  if (!dominant) reasons.push('multiple_destinations_or_hypotheses');
  if (!noContradiction) reasons.push('explicit_contradiction');
  if (!high) reasons.push('confidence_below_high');
  if (args.evidenceBasis === 'CONTEXTUAL_OR_MEMORY_PRIOR') reasons.push('memory_or_context_prior_never_autosaves');

  if (
    permissiveWouldAutoSave &&
    (args.evidenceBasis === 'DIRECT_VISIBLE_IDENTITY' || args.evidenceBasis === 'SOURCE_TEXT_IDENTITY')
  ) {
    return { decision: 'AUTO_SAVE', permissiveWouldAutoSave, reasons: ['specific_identity_source_grounded'] };
  }

  if (permissiveWouldAutoSave && args.evidenceBasis === 'DISTINCTIVE_VISUAL_MATCH') {
    const concrete = concreteDiscriminativeClueCount(hypothesis.supporting_clues);
    if (args.allowDistinctiveVisualAutoSave === true && concrete >= 2) {
      return { decision: 'AUTO_SAVE', permissiveWouldAutoSave, reasons: ['distinctive_visual_multiple_concrete_clues'] };
    }
    reasons.push(concrete < 2 ? 'visual_clues_not_discriminative_enough' : 'dev_visual_autosave_disabled');
  }

  return { decision: 'REVIEW', permissiveWouldAutoSave, reasons: reasons.length ? reasons : ['confirmation_required'] };
}
