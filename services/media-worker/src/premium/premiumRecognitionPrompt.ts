/**
 * The Premium runtime intentionally uses the parity prompt without additions.
 * This module is the named production boundary; the benchmark and runtime both
 * reach the exact same prompt/schema through runPremiumRecognitionInference.
 */
export {
  SOL_PARITY_INSTRUCTIONS as PREMIUM_RECOGNITION_INSTRUCTIONS,
  SOL_PARITY_PROMPT_VERSION as PREMIUM_RECOGNITION_PROMPT_VERSION,
  SOL_PARITY_SCHEMA as PREMIUM_RECOGNITION_SCHEMA,
  buildSolParityContext as buildPremiumRecognitionContext,
} from '../solParity/prompt.js';
