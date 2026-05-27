// supabase/functions/process-share-link/ai/hypotheses.ts
//
// Type-only module describing the "up to 3 AI hypotheses" shape
// that the optional Gemini enrichment layer will emit when called.
// The deterministic resolver does NOT depend on Gemini — if no
// hypotheses are supplied, the resolver still produces a decision
// from caption evidence + Places.

export type AIHypothesis = {
  placeName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning?: string;
};

export type AIHypothesisSet = {
  hypotheses: AIHypothesis[];
  modelUsed: string | null;
  promptVersion: string | null;
  /** True when the model timed out or failed; the resolver should
   *  treat the hypothesis set as empty. */
  degraded: boolean;
  degradedReason?: string;
};
