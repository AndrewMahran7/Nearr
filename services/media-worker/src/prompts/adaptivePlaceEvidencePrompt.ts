import { DistinctPlaceSignal } from '../types/evidence.js';
import { PLACE_EVIDENCE_SYSTEM_PROMPT, PROMPT_VERSION } from './placeEvidencePrompt.js';

export function recognitionPrompt(closedSignalVocabulary = false) {
  if (!closedSignalVocabulary) return { prompt: PLACE_EVIDENCE_SYSTEM_PROMPT, version: PROMPT_VERSION };
  return { version: PROMPT_VERSION + '+closed-signals-v1',
    prompt: PLACE_EVIDENCE_SYSTEM_PROMPT + '\n\nSchema clarification: every distinctPlaceSignals item must be exactly one of: ' +
      DistinctPlaceSignal.options.join(', ') + '. Use [] when none applies. Never invent another signal label.' };
}
