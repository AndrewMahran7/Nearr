import type { VayrinIdentityLead } from './vayrinPresentation';

export const NAMED_LEAD_AUTO_RECOVERY_POLICY = 'named-lead-auto-v2';

export type NamedLeadRecoveryTarget = {
  logicalResultId: string;
  expectedName: string;
  query: string;
};

/**
 * Review is sticky: a provider lookup cannot promote a weak model lead into
 * an automatic save. Only an already-decisive upstream identity may recover.
 */
export function planNamedLeadAutomaticRecovery(args: {
  jobId: string | null | undefined;
  status: string | null | undefined;
  savedPlaceId: string | null | undefined;
  leads: readonly VayrinIdentityLead[];
}): NamedLeadRecoveryTarget[] {
  // A partially completed multi-place job can already have the legacy
  // saved_place_id compatibility pointer while another slot still needs work.
  if (!args.jobId || !['needs_help', 'failed'].includes(args.status ?? '')) return [];
  return args.leads
    .filter((lead) => lead.evidenceKind === 'observable' && lead.resultType === 'RAW_NAME')
    .filter((lead) => (lead.confidence ?? 0) >= 0.9 && lead.upstreamSafetyDecision === 'AUTO_SAVE')
    .filter((lead) => lead.mentionId.trim() && lead.displayName.trim())
    .map((lead) => ({
      logicalResultId: lead.mentionId.trim(),
      expectedName: lead.displayName.trim(),
      query: lead.suggestedQuery.trim(),
    }));
}
