/** Experimental taxonomy interpretation only; never edits observations or save policy. */
import type { AnalyzeInput, AnalyzeOutput } from '../providers/model.js';
import type { PlaceCandidateEvidence, SceneEnvironmentType } from '../types/evidence.js';
import { evaluateNormalResultSpecificity, type NormalResultSpecificity } from './normalResultSpecificity.js';
import { parseAdaptiveRecognitionConfig, type AdaptiveRecognitionConfig } from '../../../../lib/adaptiveRecognitionConfig.ts';

export const ADAPTIVE_TAXONOMY_VERSION = 'adaptive-natural-scene-compatibility.v1';
type SpecificityInput = Pick<AnalyzeOutput, 'evidence' | 'recognitionFailureClass'> & { terminalDecision?: string | null };
export type AdaptiveSpecificitySource = Pick<AnalyzeInput, 'metadataTitle' | 'metadataDescription' | 'transcript' | 'ocr' | 'ocrExtracted'>;
type Adjustment = { index: number; category: string; observed: SceneEnvironmentType; classifierCompatibility: SceneEnvironmentType };

// Water is part of a hiking scene; the landward view is part of a shore/falls/lake.
// No business, person, brand, urban, indoor, unknown, or generic-category expansion.
const COMPATIBILITY: Readonly<Record<string, Readonly<Partial<Record<SceneEnvironmentType, SceneEnvironmentType>>>>> = {
  hiking_trail: { natural_water: 'natural_land' },
  beach: { natural_land: 'natural_water' },
  waterfall: { natural_land: 'natural_water' },
  lake: { natural_land: 'natural_water' },
};
const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const FEATURE_CUE: Readonly<Record<string, RegExp>> = {
  hiking_trail: /\b(?:trail|hike|hiking|falls?|waterfall|cliff|canyon|ridge)\b/i,
  beach: /\b(?:beach|shore|coast|cove|bay)\b/i,
  waterfall: /\b(?:falls?|waterfall|cascade)\b/i,
  lake: /\b(?:lake|lagoon|pond)\b/i,
};
function literalNameEvidence(place: PlaceCandidateEvidence, source: AdaptiveSpecificitySource): boolean {
  if (place.identityEvidenceKind === 'model_prior' || place.role === 'passing_mention') return false;
  const name = fold(place.name);
  return !!name && place.explicitEvidence.some((e) => {
    const actual = e.source === 'caption' ? [source.metadataTitle, source.metadataDescription].filter(Boolean).join(' ') :
      e.source === 'speech' ? source.transcript.map((s) => s.text).join(' ') :
      e.source === 'visible_text' && source.ocrExtracted === true ? source.ocr.map((s) => s.text).join(' ') : '';
    return !!actual && fold(actual).includes(fold(e.value)) &&
    ['caption', 'speech', 'visible_text'].includes(e.source) && (` ${fold(e.value)} `).includes(` ${name} `) &&
    FEATURE_CUE[place.category ?? '']?.test(fold(e.value)) &&
    !/\b(?:filmed|shot|sponsored|presented|powered|tour) by\b|\b(?:wearing|using|not|former)\b/.test(fold(e.value));
  });
}

/** Inject `.specificity` into the live Automatic Deep evaluator seam, not just logging. */
export function evaluateAdaptiveNormalSpecificity(input: SpecificityInput, options?: AdaptiveRecognitionConfig, source?: AdaptiveSpecificitySource): {
  specificity: NormalResultSpecificity;
  trace: { version: string; enabled: boolean; baseline: NormalResultSpecificity; adjustments: Adjustment[]; changed: boolean };
} {
  const config = parseAdaptiveRecognitionConfig(options), baseline = evaluateNormalResultSpecificity(input);
  const trace = { version: ADAPTIVE_TAXONOMY_VERSION, enabled: config.taxonomyCompatibility,
    baseline, adjustments: [] as Adjustment[], changed: false };
  if (!config.taxonomyCompatibility || !source || baseline.rejectionReason !== 'IDENTITY_DIVERGENCE') return { specificity: baseline, trace };
  const places = input.evidence.places.map((place, index) => {
    const observed = place.sceneSignature?.environmentType;
    const compatible = observed && place.category ? COMPATIBILITY[place.category]?.[observed] : undefined;
    if (!compatible || !observed || !place.sceneSignature || !literalNameEvidence(place, source)) return place;
    trace.adjustments.push({ index, category: place.category!, observed, classifierCompatibility: compatible });
    // This private classifier view is never returned as evidence or passed to a model/resolver.
    return { ...place, sceneSignature: { ...place.sceneSignature, environmentType: compatible } };
  });
  if (!trace.adjustments.length) return { specificity: baseline, trace };
  const reevaluated = evaluateNormalResultSpecificity({ ...input, evidence: { ...input.evidence, places } });
  // Every baseline guard still executes, including incomplete multis and broad parents.
  if (!reevaluated.specific) return { specificity: baseline, trace };
  trace.changed = true;
  return { specificity: reevaluated, trace };
}
