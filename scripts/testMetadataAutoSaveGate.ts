import assert from 'node:assert/strict';

import {
  METADATA_AUTO_SAVE_RULE_VERSION,
  evaluateMetadataAutoSave,
  formatMetadataAutoSaveDecisionLog,
} from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { planFromResolverDecision } from '../supabase/functions/process-share-jobs/decisionMapping';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { buildQueryPlan } from '../supabase/functions/process-share-link/resolver/queryBuilder';

const santaFe = {
  googlePlaceId: 'ChIJxRuQrqwv3YARWdKYfs8FIBY',
  name: 'Santa Fe Importers Seal Beach',
  formattedAddress: '12430 Seal Beach Blvd B, Seal Beach, CA 90740, USA',
  latitude: 33.78155760000001,
  longitude: -118.0715926,
  businessStatus: 'OPERATIONAL',
  confidenceScore: 0.6063273449765341,
  reasons: ['business_type', 'meaningful_name_match', 'state_match'],
};

const santaFeDecision = evaluateMetadataAutoSave({
  result: { decision: 'candidate_confirmation', candidates: [santaFe] },
  evidence: {
    isRoundup: false,
    address: { raw: '12430 Seal Beach Blvd B' },
    addresses: [
      { raw: '12430 Seal Beach Blvd B' },
      { raw: '1401 Santa Fe Ave' },
    ],
  },
});

assert.equal(santaFeDecision.ruleVersion, METADATA_AUTO_SAVE_RULE_VERSION);
assert.equal(santaFeDecision.rawCandidateCount, 1);
assert.equal(santaFeDecision.plausibleCandidateCount, 1);
assert.equal(santaFeDecision.selectedProviderId, santaFe.googlePlaceId);
assert.equal(santaFeDecision.confidenceScore, santaFe.confidenceScore);
assert.deepEqual(santaFeDecision.reasonCodes, ['exact_identity_supported']);
assert.equal(santaFeDecision.eligible, true, 'the exact Santa Fe screenshot shape must auto-save');

const sameAddressParentSubstitution = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_confirmation',
    candidates: [{
      ...santaFe,
      googlePlaceId: 'parent-complex-provider',
      name: 'Example Shopping Center',
      formattedAddress: '3333 Bristol St, Costa Mesa, CA 92626, USA',
      confidenceScore: 0.98,
      reasons: ['business_type', 'compact_name_match', 'address_verified'],
    }],
  },
  evidence: {
    address: { raw: '3333 Bristol St' },
    addresses: [{ raw: '3333 Bristol St' }],
    venueNameHints: ['Example Restaurant'],
  },
});
assert.equal(
  sameAddressParentSubstitution.eligible,
  false,
  'a shared address must not turn a parent complex into the named tenant',
);
assert.deepEqual(
  sameAddressParentSubstitution.explicitConflictFlags,
  ['source_named_candidate_mismatch'],
);

const handleSpellingWithIndependentCaptionName = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_confirmation',
    candidates: [{
      ...santaFe,
      googlePlaceId: 'capones-provider',
      name: "Capone's Italian Cucina",
      formattedAddress: '19688 Beach Blvd #10, Huntington Beach, CA 92648, USA',
      confidenceScore: 0.96,
      reasons: ['business_type', 'address_verified'],
    }],
  },
  evidence: {
    rawTitle: 'Lily | OC Food + Things to Do in Orange County on Instagram',
    rawDescription: '@capones_cucina - 19688 Beach Blvd, Huntington Beach, CA',
    address: {
      raw: '19688 Beach Blvd',
      venue: 'Capones Italian Cucina',
      venueSource: 'tagged_venue_handle',
    },
    addresses: [{ raw: '19688 Beach Blvd' }],
    venueNameHints: ['Things to Do'],
    venueNameHintsFromHandle: [],
    handles: {
      posterHandle: 'ocfeed',
      posterNameHint: 'Lily | OC Food + Things to Do in Orange County',
      venueHandles: ['capones_cucina'],
    },
  },
});
assert.equal(
  handleSpellingWithIndependentCaptionName.eligible,
  true,
  'independently written exact business name plus address must preserve autosave despite handle punctuation',
);

const santaFePlan = planFromResolverDecision({
  decision: santaFeDecision.eligible ? 'auto_save' : 'candidate_confirmation',
  safeToAutoSave: santaFeDecision.eligible,
  hasPrimaryCandidate: true,
  candidateCount: 1,
});
assert.deepEqual(santaFePlan, { route: 'auto_save' }, 'Santa Fe cannot become Needs you / Quick Check');

const log = formatMetadataAutoSaveDecisionLog({ jobId: 'santa-fe-job', decision: santaFeDecision });
assert.match(log, /raw_candidate_count=1/);
assert.match(log, /plausible_candidate_count=1/);
assert.match(log, /final_decision=auto_save/);

const cases: Array<[string, Parameters<typeof evaluateMetadataAutoSave>[0], string]> = [
  [
    'explicit location conflict',
    {
      result: { decision: 'candidate_confirmation', candidates: [santaFe] },
      evidence: { address: { raw: '999 Other St' }, addresses: [{ raw: '999 Other St' }] },
    },
    'location_conflict',
  ],
  [
    'invalid coordinates',
    {
      result: {
        decision: 'candidate_confirmation',
        candidates: [{ ...santaFe, latitude: null }],
      },
      evidence: {},
    },
    'provider_coordinates_invalid',
  ],
  [
    'permanent closure',
    {
      result: {
        decision: 'candidate_confirmation',
        candidates: [{ ...santaFe, businessStatus: 'CLOSED_PERMANENTLY' }],
      },
      evidence: {},
    },
    'provider_permanently_closed',
  ],
];

for (const [name, input, reason] of cases) {
  const decision = evaluateMetadataAutoSave(input);
  assert.equal(decision.eligible, false, `${name} must remain review/manual`);
  assert.ok(
    decision.reasonCodes.includes(reason) || decision.explicitConflictFlags.includes(reason),
    `${name} must preserve its concrete blocker`,
  );
}

// Ranking is presentation-only: ordinary 2-3 way ambiguity cannot establish
// the exact source identity.
const ordinaryAmbiguity = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_picker',
    candidates: [santaFe, { ...santaFe, googlePlaceId: 'other-provider' }],
  },
  evidence: {},
});
assert.equal(ordinaryAmbiguity.eligible, false);
assert.equal(ordinaryAmbiguity.selectedProviderId, santaFe.googlePlaceId);
assert.equal(ordinaryAmbiguity.plausibleCandidateCount, 2);
assert.deepEqual(ordinaryAmbiguity.reasonCodes, ['related_place_not_distinguished']);

const resolverLabelCannotVetoStrongSingleton = evaluateMetadataAutoSave({
  result: { decision: 'manual_fallback', candidates: [santaFe] },
  evidence: {},
});
assert.equal(
  resolverLabelCannotVetoStrongSingleton.eligible,
  false,
  'provider quality without source identity cannot authorize a singleton save',
);
assert.deepEqual(resolverLabelCannotVetoStrongSingleton.reasonCodes, ['exact_identity_unproven']);

const weakLoneSurvivor = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_confirmation',
    candidates: [{
      ...santaFe,
      googlePlaceId: 'weak-leftover',
      name: 'Unrelated Business',
      confidenceScore: 0.5,
      reasons: ['business_type'],
    }],
  },
  evidence: {},
});
assert.equal(weakLoneSurvivor.eligible, false, 'a weak lone survivor must never auto-save');
assert.deepEqual(weakLoneSurvivor.reasonCodes, ['weak_singleton']);
assert.equal(weakLoneSurvivor.independentQualityGatePassed, false);
assert.equal(weakLoneSurvivor.independentQualityReason, 'independent_identity_evidence_missing');

// Reproduced metadata-path P0: creator identity was mislabelled as a venue
// handle, queried as "Oliversamiee", and a single unrelated Places result was
// accepted despite carrying only a generic business-type score.
const creatorOnly = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_confirmation',
    cleanSearchQuery: 'Oliversamiee',
    candidates: [{
      ...santaFe,
      googlePlaceId: 'olivers-unrelated-provider',
      name: "Oliver's - Olive Oil & Balsamic Tasting Gallery",
      confidenceScore: 0.5,
      reasons: ['business_type'],
    }],
  },
  evidence: {
    venueNameHints: ['Oliversamiee'],
    venueNameHintsFromHandle: ['Oliversamiee'],
    handles: {
      posterHandle: 'oliversamiee',
      posterNameHint: 'Oliversamiee',
      venueHandles: ['oliversamiee'],
    },
  },
});
assert.equal(creatorOnly.eligible, false, 'creator identity alone must never auto-save');
assert.deepEqual(creatorOnly.explicitConflictFlags, ['creator_identity_only']);
assert.equal(creatorOnly.selectedProviderId, 'olivers-unrelated-provider');

// Positive compatibility: a business-owned creator post remains eligible when
// the caption independently names the venue. The creator is context; the
// explicit caption venue is the identity evidence.
const corroboratedCreator = evaluateMetadataAutoSave({
  result: {
    decision: 'candidate_confirmation',
    cleanSearchQuery: 'Some Coffee Irvine',
    candidates: [{
      ...santaFe,
      googlePlaceId: 'some-coffee-provider',
      name: 'Some Coffee',
      confidenceScore: 0.86,
      reasons: ['meaningful_name_match', 'business_type'],
    }],
  },
  evidence: {
    venueNameHints: ['Some Coffee'],
    venueNameHintsFromHandle: [],
    handles: {
      posterHandle: 'somecoffee',
      posterNameHint: 'Somecoffee',
      venueHandles: [],
    },
  },
});
assert.equal(corroboratedCreator.eligible, true, 'independent explicit venue evidence preserves cheap resolution');
assert.deepEqual(corroboratedCreator.explicitConflictFlags, []);

const reproducedTitle = '@oliversamiee on Instagram: "My biggest backflip"';
const reproducedDescription = [
  'My biggest backflip. Been eyeing this up for years.',
  '@jonahlarson_ @seth__carp @leonard.pretorius @jonah.maliskas',
  '#cliffjumping #pnw',
].join(' ');
const reproducedHandles = extractHandles({
  platform: 'instagram',
  title: reproducedTitle,
  description: reproducedDescription,
  html: '',
});
assert.equal(reproducedHandles.posterHandle, 'oliversamiee');
assert.equal(reproducedHandles.venueHandles.includes('oliversamiee'), false);
const reproducedEvidence = extractEvidence({
  platform: 'instagram',
  title: reproducedTitle,
  description: reproducedDescription,
  handles: reproducedHandles,
});
const reproducedPlan = buildQueryPlan(reproducedEvidence);
assert.equal(
  reproducedPlan.queries.some((query) => /oliversamiee/i.test(query)),
  false,
  'the creator must not generate an Oliver Places query',
);

const creatorWithoutOtherAccounts = extractHandles({
  platform: 'instagram',
  title: reproducedTitle,
  description: 'Cliff jumping with no explicit place evidence.',
  html: '',
});
const noPlaceEvidence = extractEvidence({
  platform: 'instagram',
  title: reproducedTitle,
  description: 'Cliff jumping with no explicit place evidence.',
  handles: creatorWithoutOtherAccounts,
});
assert.deepEqual(buildQueryPlan(noPlaceEvidence).queries, []);

console.log('PASS exact Santa Fe metadata auto-save and explicit contradiction gates');
