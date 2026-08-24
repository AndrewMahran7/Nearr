/**
 * Pure product-language adapter for Vayrin result surfaces.
 *
 * Recognition and persistence keep their existing enums. This module only
 * decides how an already-computed outcome should be explained to a person, so
 * synchronous and durable share flows cannot drift into different language.
 */

import type { ShareJobDetailState } from './shareJobDetailState';

export type VayrinPresentationKind =
  | 'ready'
  | 'looking'
  | 'found'
  | 'likely'
  | 'leads_candidates'
  | 'leads_unverified'
  | 'multi_found'
  | 'multi_partial'
  | 'no_evidence'
  | 'technical_failure'
  | 'correcting'
  | 'saved';

export type VayrinPresentationSource = 'sync' | 'async';

export type VayrinIdentityLead = {
  mentionId: string;
  displayName: string;
  contextLabel: string | null;
  evidenceKind: 'observable' | 'model_prior';
  timestamps: number[];
  suggestedQuery: string;
};

export type VayrinPresentation = {
  kind: VayrinPresentationKind;
  headline: string;
  body: string;
  primaryAction: string | null;
  secondaryAction: string | null;
  /** Copy may speak in first person only when canonical Vayrin artwork is
   * visibly rendered beside it. Current product call sites use the no-art
   * default; the component never fabricates a mascot. */
  artVisible: boolean;
  leads: VayrinIdentityLead[];
};

export type VayrinPresentationContext = {
  hasVisibleVayrinArt?: boolean;
};

export type VayrinDomainState = {
  kind: VayrinPresentationKind;
  source: VayrinPresentationSource;
  placeName?: string | null;
  placeCount?: number;
  ageMs?: number;
  leads?: VayrinIdentityLead[];
  alreadySaved?: boolean;
};

type ShareJobPresentationInput = {
  status?: string | null;
  decision?: string | null;
  candidate_payload?: unknown;
  failure_reason?: string | null;
  needs_help_reason?: string | null;
  created_at?: string | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function timestamps(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .slice(0, 12);
}

/** Read the optional frozen Vayrin Core lead shape without requiring Core to
 * be merged into this isolated branch. Unknown/malformed data is ignored. */
export function normalizeVayrinIdentityLeads(payload: unknown): VayrinIdentityLead[] {
  const slots = record(payload)?.mentionSlots;
  if (!Array.isArray(slots)) return [];
  const leads: VayrinIdentityLead[] = [];
  const seen = new Set<string>();

  for (const rawSlot of slots.slice(0, 10)) {
    const slot = record(rawSlot);
    if (!slot) continue;
    const mentionId = text(slot.mentionId);
    if (!mentionId) continue;
    const identities = Array.isArray(slot.identityHypotheses) ? slot.identityHypotheses : [];
    for (const rawIdentity of identities.slice(0, 6)) {
      const identity = record(rawIdentity);
      const displayName = text(identity?.name);
      if (!identity || !displayName) continue;
      const contextLabel = text(identity.contextLabel) ?? text(slot.contextLabel);
      const key = `${mentionId}:${displayName.toLocaleLowerCase()}:${contextLabel?.toLocaleLowerCase() ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push({
        mentionId,
        displayName,
        contextLabel,
        evidenceKind: identity.evidenceKind === 'model_prior' ? 'model_prior' : 'observable',
        timestamps: timestamps(identity.timestamps),
        suggestedQuery: [displayName, contextLabel].filter(Boolean).join(' '),
      });
      if (leads.length === 12) return leads;
    }
  }
  return leads;
}

function countUsableSlots(payload: unknown): { total: number; resolved: number; unresolved: number } {
  const slots = record(payload)?.mentionSlots;
  if (!Array.isArray(slots)) return { total: 0, resolved: 0, unresolved: 0 };
  let total = 0;
  let resolved = 0;
  let unresolved = 0;
  for (const rawSlot of slots.slice(0, 10)) {
    const slot = record(rawSlot);
    if (!slot || !text(slot.mentionId)) continue;
    total += 1;
    const outcome = text(slot.outcome);
    if (outcome === 'verified_single') resolved += 1;
    else unresolved += 1;
  }
  return { total, resolved, unresolved };
}

function failureIsUnsupported(reason: string | null | undefined): boolean {
  return /unsupported|private_or_unavailable|duration_too_long|media_unavailable/i.test(reason ?? '');
}

function voiceCopy(artVisible: boolean, noArt: string, withArt: string): string {
  return artVisible ? withArt : noArt;
}

export function buildVayrinPresentation(
  state: VayrinDomainState,
  context: VayrinPresentationContext = {},
): VayrinPresentation {
  const leads = state.leads ?? [];
  const count = Math.max(0, Math.floor(state.placeCount ?? 0));
  const place = text(state.placeName);
  const artVisible = context.hasVisibleVayrinArt === true;
  const base = { artVisible, leads };

  switch (state.kind) {
    case 'ready':
      return {
        ...base,
        kind: 'ready',
        headline: voiceCopy(artVisible, 'Just ask Vayrin.', 'Just ask me.'),
        body: voiceCopy(
          artVisible,
          'Share a video or paste its link. Vayrin will find the place.',
          "Share a video or paste its link. I'll find the place.",
        ),
        primaryAction: 'Ask Vayrin',
        secondaryAction: null,
      };
    case 'looking': {
      const long = (state.ageMs ?? 0) >= 15_000;
      return {
        ...base,
        kind: 'looking',
        headline: long
          ? voiceCopy(artVisible, 'Vayrin is still looking.', "I'm still looking.")
          : voiceCopy(artVisible, 'Vayrin is looking\u2026', "I'm looking\u2026"),
        body: long
          ? "This one's tricky. You can leave — Nearr will keep working."
          : state.source === 'async'
            ? 'This usually takes a few seconds. You can leave while Nearr keeps working.'
            : 'This usually takes a few seconds.',
        primaryAction: null,
        secondaryAction: null,
      };
    }
    case 'found':
      return {
        ...base,
        kind: 'found',
        headline: voiceCopy(artVisible, 'Found it.', 'I found it.'),
        body: place
          ? `${place} — ${state.alreadySaved ? 'already on your map.' : 'saved to your map.'}`
          : state.alreadySaved ? 'This place is already on your map.' : 'Saved to your map.',
        primaryAction: 'View on map',
        secondaryAction: 'Not it',
      };
    case 'likely':
      return {
        ...base,
        kind: 'likely',
        headline: 'Is this the place?',
        body: 'Compare it with the video, then save it.',
        primaryAction: 'Save this place',
        secondaryAction: 'Not this place',
      };
    case 'leads_candidates':
      return {
        ...base,
        kind: 'leads_candidates',
        headline: 'Which one is it?',
        body: 'Choose the place that matches the video.',
        primaryAction: 'Choose',
        secondaryAction: 'None of these',
      };
    case 'leads_unverified':
      return {
        ...base,
        kind: 'leads_unverified',
        headline: 'A few names may match.',
        body: 'Search them to choose an exact place.',
        primaryAction: 'Search places',
        secondaryAction: 'Search for the place',
      };
    case 'multi_found':
      return {
        ...base,
        kind: 'multi_found',
        headline: voiceCopy(
          artVisible,
          `Vayrin found ${count} ${count === 1 ? 'place' : 'places'}.`,
          `I found ${count} ${count === 1 ? 'place' : 'places'}.`,
        ),
        body: 'Save the ones you want.',
        primaryAction: 'Save selected',
        secondaryAction: 'Save all',
      };
    case 'multi_partial':
      return {
        ...base,
        kind: 'multi_partial',
        headline: count > 0
          ? voiceCopy(
              artVisible,
              `Vayrin found ${count} ${count === 1 ? 'place' : 'places'}.`,
              `I found ${count} ${count === 1 ? 'place' : 'places'}.`,
            )
          : voiceCopy(artVisible, 'Vayrin found a few leads.', "I've got a few leads."),
        body: count > 0
          ? 'Some are ready to save. A few still need your help.'
          : 'This video shows several places, but none are verified yet.',
        primaryAction: 'Save selected',
        secondaryAction: 'Review leads',
      };
    case 'technical_failure':
      return {
        ...base,
        kind: 'technical_failure',
        headline: voiceCopy(artVisible, 'Something went wrong.', "Sorry — that one's on me."),
        body: 'Nearr could not finish checking this video.',
        primaryAction: 'Try again',
        secondaryAction: 'Search manually',
      };
    case 'correcting':
      return {
        ...base,
        kind: 'correcting',
        headline: 'Search for the place.',
        body: 'Choose the result that matches the video.',
        primaryAction: 'Use this place',
        secondaryAction: 'Search again',
      };
    case 'saved':
      return {
        ...base,
        kind: 'saved',
        headline: voiceCopy(artVisible, 'All set.', "I've got it."),
        body: "It's on your map. Nearr has it from here.",
        primaryAction: 'View on map',
        secondaryAction: 'Done',
      };
    case 'no_evidence':
    default:
      return {
        ...base,
        kind: 'no_evidence',
        headline: "Couldn't pin this one down.",
        body: voiceCopy(
          artVisible,
          'Search by name or location to choose the place.',
          'There was not enough evidence in this video.',
        ),
        primaryAction: 'Search manually',
        secondaryAction: 'Try another video',
      };
  }
}

/** Durable job adapter. Persisted candidates remain authoritative; identity
 * hypotheses only add an honest lead surface when no exact candidate exists. */
export function mapShareJobToVayrinPresentation(
  detail: ShareJobDetailState,
  job: ShareJobPresentationInput | null | undefined,
  nowMs = Date.now(),
  context: VayrinPresentationContext = {},
): VayrinPresentation {
  const leads = normalizeVayrinIdentityLeads(job?.candidate_payload);
  const hasModelPrior = leads.some((lead) => lead.evidenceKind === 'model_prior');
  const slots = countUsableSlots(job?.candidate_payload);
  const created = job?.created_at ? new Date(job.created_at).getTime() : nowMs;
  const ageMs = Number.isFinite(created) ? Math.max(0, nowMs - created) : 0;

  if (detail.kind === 'processing') {
    return buildVayrinPresentation({ kind: 'looking', source: 'async', ageMs }, context);
  }
  // Defense in depth: an unverified memory-based hypothesis can never inherit
  // strong-result language even if an inconsistent payload says completed.
  if (detail.kind === 'completed' && !hasModelPrior) {
    return buildVayrinPresentation({
      kind: 'found',
      source: 'async',
      placeName: detail.savedPlaceName ?? detail.candidates[0]?.name,
      alreadySaved: detail.alreadySaved,
    }, context);
  }
  if (detail.kind === 'multi') {
    const total = slots.total || detail.mentionSlots.length || detail.candidates.length;
    return buildVayrinPresentation({
      kind: slots.unresolved > 0 || leads.length > 0 ? 'multi_partial' : 'multi_found',
      source: 'async',
      placeCount: slots.unresolved > 0 ? slots.resolved : total,
      leads,
    }, context);
  }
  if (detail.kind === 'picker') {
    return buildVayrinPresentation({ kind: 'leads_candidates', source: 'async', leads }, context);
  }
  if (detail.kind === 'confirm') {
    return buildVayrinPresentation({ kind: 'likely', source: 'async', leads }, context);
  }
  if (leads.length > 0 || hasModelPrior) {
    return buildVayrinPresentation({ kind: 'leads_unverified', source: 'async', leads }, context);
  }
  if (detail.kind === 'manual' && job?.status === 'failed') {
    return buildVayrinPresentation({ kind: 'technical_failure', source: 'async' }, context);
  }
  if (detail.kind === 'manual' && failureIsUnsupported(job?.failure_reason ?? job?.needs_help_reason)) {
    return {
      ...buildVayrinPresentation({ kind: 'no_evidence', source: 'async' }, context),
      headline: voiceCopy(
        context.hasVisibleVayrinArt === true,
        "Vayrin can't open this one.",
        "I can't open this one.",
      ),
      body: 'Try sharing the video itself, or a link to the post.',
      primaryAction: 'Try another video',
      secondaryAction: 'Search manually',
    };
  }
  return buildVayrinPresentation({ kind: 'no_evidence', source: 'async' }, context);
}

export type SyncSharePresentationInput = {
  phase: 'idle' | 'parsing' | 'searching' | 'saving' | 'choose' | 'multi-choose' | 'failed' | 'saved';
  candidateCount?: number;
  placeName?: string | null;
  technicalFailure?: boolean;
};

export function mapSyncShareToVayrinPresentation(
  input: SyncSharePresentationInput,
  context: VayrinPresentationContext = {},
): VayrinPresentation {
  if (input.phase === 'idle') return buildVayrinPresentation({ kind: 'ready', source: 'sync' }, context);
  if (input.phase === 'parsing' || input.phase === 'searching' || input.phase === 'saving') {
    return buildVayrinPresentation({ kind: 'looking', source: 'sync' }, context);
  }
  if (input.phase === 'saved') {
    return buildVayrinPresentation({ kind: 'found', source: 'sync', placeName: input.placeName }, context);
  }
  if (input.phase === 'multi-choose') {
    return buildVayrinPresentation(
      { kind: 'multi_found', source: 'sync', placeCount: input.candidateCount },
      context,
    );
  }
  if (input.phase === 'choose') {
    return buildVayrinPresentation({
      kind: (input.candidateCount ?? 0) > 1 ? 'leads_candidates' : 'likely',
      source: 'sync',
    }, context);
  }
  return buildVayrinPresentation({
    kind: input.technicalFailure ? 'technical_failure' : 'no_evidence',
    source: 'sync',
  }, context);
}
