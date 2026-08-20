/**
 * lib/vayrin/productMapping.ts
 *
 * Maps Vayrin's hypothesis strengths onto Nearr's EXISTING share-job outcomes.
 *
 * There is deliberately NO second state machine here. `process-share-jobs/
 * decisionMapping.ts` already owns the job routes (`auto_save` and
 * `needs_help` with modes `single | picker | multi | manual`), and every
 * notification, every screen, and every realtime subscription is built on
 * those. Vayrin produces a `ResolverDecision` in that same closed vocabulary
 * and hands it to the existing mapper — so a Vayrin result travels through the
 * identical code path a metadata result travels through today.
 *
 * PURE. No imports, no I/O — unit-tested from ts-node.
 */

import type { HypothesisStrength } from './geoEvidence';

/** Exactly the vocabulary `decisionMapping.planFromResolverDecision` accepts.
 *  Duplicated as a type-only mirror rather than imported, because that module
 *  lives in the Deno function tree and this one must stay importable from
 *  ts-node and the worker. The unit test asserts the two stay identical. */
export type ResolverDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'candidate_picker'
  | 'multi_candidate_confirmation'
  | 'manual_fallback'
  | 'failed';

export type VayrinOutcome = {
  decision: ResolverDecision;
  /** Whether Vayrin believes this is silently saveable. NEVER sufficient on its
   *  own: `decisionMapping` still requires the resolver's own `safeToAutoSave`
   *  gate AND `mediaEvidenceAutoSaveEligible` to agree. This flag can only ever
   *  make the outcome stricter than those two, never looser. */
  autoSaveEligible: boolean;
  /** Closed-vocabulary code for diagnostics. Never model prose. */
  reason: VayrinOutcomeReason;
};

export type VayrinOutcomeReason =
  | 'strong_single_verified'
  | 'likely_single'
  | 'multiple_leads_one_place'
  | 'multiple_distinct_places'
  | 'coarse_geography_only'
  | 'no_useful_evidence';

export type VayrinResultShape = {
  /** Strengths of the hypotheses for the PRIMARY place, best first. */
  primaryStrengths: HypothesisStrength[];
  /** How many DISTINCT real-world places the video shows (scene groups that
   *  produced at least one usable hypothesis). */
  distinctPlaceCount: number;
};

/**
 * Decide the job outcome.
 *
 * The ordering matters and encodes the product rule that a wrong confident save
 * is worse than good leads:
 *
 *   multiple distinct places  -> multi. Never collapsed into one save, even if
 *                                the first one is individually strong. A weekend
 *                                recap that silently saves only the hotel has
 *                                lost the other four places the user shared it
 *                                for.
 *   one strong hypothesis     -> auto_save (subject to the existing gates).
 *   one likely hypothesis     -> confirm.
 *   several credible leads    -> picker.
 *   coarse geography only     -> confirm, NOT discarded. Knowing the city is a
 *                                real narrowing, and `suggestedQuery` carries it
 *                                into the manual search the user would otherwise
 *                                start from nothing.
 *   nothing                   -> manual.
 */
export function mapVayrinResult(result: VayrinResultShape): VayrinOutcome {
  const strengths = result.primaryStrengths.filter((s) => s !== 'none');

  if (result.distinctPlaceCount > 1) {
    return {
      decision: 'multi_candidate_confirmation',
      autoSaveEligible: false,
      reason: 'multiple_distinct_places',
    };
  }

  if (strengths.length === 0) {
    return { decision: 'manual_fallback', autoSaveEligible: false, reason: 'no_useful_evidence' };
  }

  const best = strengths[0]!;

  if (best === 'strong') {
    // A second, equally-specific competitor means we are not actually sure
    // WHICH place it is — that is a picker, not a silent save.
    const contested = strengths.filter((s) => s === 'strong' || s === 'likely').length > 1;
    if (contested) {
      return {
        decision: 'candidate_picker',
        autoSaveEligible: false,
        reason: 'multiple_leads_one_place',
      };
    }
    return { decision: 'auto_save', autoSaveEligible: true, reason: 'strong_single_verified' };
  }

  if (best === 'likely') {
    const competitors = strengths.filter((s) => s === 'likely' || s === 'lead').length;
    if (competitors > 1) {
      return {
        decision: 'candidate_picker',
        autoSaveEligible: false,
        reason: 'multiple_leads_one_place',
      };
    }
    return {
      decision: 'candidate_confirmation',
      autoSaveEligible: false,
      reason: 'likely_single',
    };
  }

  if (best === 'lead') {
    return strengths.length > 1
      ? { decision: 'candidate_picker', autoSaveEligible: false, reason: 'multiple_leads_one_place' }
      : { decision: 'candidate_confirmation', autoSaveEligible: false, reason: 'likely_single' };
  }

  // coarse_only. Deliberately NOT manual_fallback: we know something useful and
  // throwing it away would make the user start their search from zero.
  return {
    decision: 'candidate_confirmation',
    autoSaveEligible: false,
    reason: 'coarse_geography_only',
  };
}
