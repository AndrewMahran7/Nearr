import type { QualificationOutcome, RecognitionObservation } from './tutorialRecognitionCorpus';

export type TutorialSafetyFixture = {
  id: string;
  riskClass: string;
  expectedGooglePlaceId: string | null;
  observation: RecognitionObservation;
  expectedOutcome: QualificationOutcome;
};

const safeBase: RecognitionObservation = {
  terminalStatus: 'completed',
  decision: 'manual_fallback',
  returnedGooglePlaceIds: [],
  savedGooglePlaceIds: [],
  sourceAvailable: true,
  infrastructureFailure: null,
};

/** Final-decision fixtures complement extraction fixtures with the safety rule
 * that a plausible Google row is still wrong when its semantic identity is wrong. */
export const TUTORIAL_RECOGNITION_SAFETY_FIXTURES: TutorialSafetyFixture[] = [
  {
    id: 'creator-identity-wrong-singleton',
    riskClass: 'creator_identity_mistaken_for_venue',
    expectedGooglePlaceId: 'actual-place',
    observation: { ...safeBase, decision: 'candidate_confirmation', returnedGooglePlaceIds: ['creator-business'] },
    expectedOutcome: 'hard_fail',
  },
  {
    id: 'tagged-collaborator-wrong-singleton',
    riskClass: 'tagged_collaborator_mistaken_for_venue',
    expectedGooglePlaceId: 'actual-place',
    observation: { ...safeBase, decision: 'candidate_confirmation', returnedGooglePlaceIds: ['tagged-business'] },
    expectedOutcome: 'hard_fail',
  },
  {
    id: 'same-name-other-city',
    riskClass: 'same_name_wrong_city',
    expectedGooglePlaceId: 'correct-city-branch',
    observation: { ...safeBase, decision: 'auto_save', returnedGooglePlaceIds: ['wrong-city-branch'], savedGooglePlaceIds: ['wrong-city-branch'] },
    expectedOutcome: 'hard_fail',
  },
  {
    id: 'multiple-branches-remain-picker',
    riskClass: 'multiple_branches',
    expectedGooglePlaceId: 'branch-a',
    observation: { ...safeBase, decision: 'candidate_picker', returnedGooglePlaceIds: ['branch-a', 'branch-b'] },
    expectedOutcome: 'controlled_non_success',
  },
  {
    id: 'roundup-must-not-collapse',
    riskClass: 'roundup_or_list',
    expectedGooglePlaceId: null,
    observation: { ...safeBase, decision: 'candidate_picker', returnedGooglePlaceIds: ['place-a', 'place-b'] },
    expectedOutcome: 'controlled_non_success',
  },
  {
    id: 'weak-handle-only-stays-manual',
    riskClass: 'weak_handle_only_evidence',
    expectedGooglePlaceId: null,
    observation: safeBase,
    expectedOutcome: 'controlled_non_success',
  },
  {
    id: 'unavailable-source-is-infrastructure',
    riskClass: 'deleted_private_unavailable_source',
    expectedGooglePlaceId: 'actual-place',
    observation: { ...safeBase, sourceAvailable: false },
    expectedOutcome: 'infrastructure_failure',
  },
  {
    id: 'provider-redirect-is-infrastructure',
    riskClass: 'redirect_or_provider_page',
    expectedGooglePlaceId: 'actual-place',
    observation: { ...safeBase, infrastructureFailure: 'provider_or_interstitial_page' },
    expectedOutcome: 'infrastructure_failure',
  },
  {
    id: 'valid-google-row-wrong-business',
    riskClass: 'structurally_valid_wrong_singleton',
    expectedGooglePlaceId: 'expected-google-id',
    observation: { ...safeBase, decision: 'candidate_confirmation', returnedGooglePlaceIds: ['valid-wrong-google-id'] },
    expectedOutcome: 'hard_fail',
  },
];
