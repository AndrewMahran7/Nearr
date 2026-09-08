import type { VayrinIdentityLead } from './vayrinPresentation';

export const NAMED_LEAD_AUTO_RECOVERY_POLICY = 'named-lead-auto-v1';

export type NamedLeadRecoveryTarget = {
  logicalResultId: string;
  expectedName: string;
  query: string;
};

/**
 * Only observable, machine-produced named leads qualify. This planner does
 * not accept arbitrary user text, broad areas, model priors, or correction
 * flows, which keeps ordinary map/manual searches outside automatic saving.
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
    .filter((lead) => lead.mentionId.trim() && lead.displayName.trim())
    .map((lead) => ({
      logicalResultId: lead.mentionId.trim(),
      expectedName: lead.displayName.trim(),
      query: lead.suggestedQuery.trim(),
    }));
}
