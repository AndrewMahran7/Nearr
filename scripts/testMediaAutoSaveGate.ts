import {
  evaluateMediaAutoSave,
  formatMediaAutoSaveDecisionLog,
  mediaAutoSaveAuthorized,
  mediaReviewDecision,
  DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD,
  MEDIA_AUTO_SAVE_MIN_SCORE,
  MEDIA_AUTO_SAVE_RULE_VERSION,
  resolveMediaAutoSaveThreshold,
} from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';
import type { MentionResult } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function mention(over: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: 'Parlor Woodfire',
    normalizedName: 'parlor woodfire',
    distinctiveTokens: ['parlor', 'woodfire'],
    category: 'restaurant',
    sources: ['speech'],
    nameEvidenceSources: ['speech'],
    timestamps: [1],
    mentionCount: 1,
    repeated: false,
    confidence: 0.95,
    geo: { city: 'Los Angeles', region: 'California', country: 'United States' },
    ...over,
  };
}

function result(over: Partial<MentionResult> = {}): MentionResult {
  const candidate = {
    googlePlaceId: 'google-parlor',
    name: 'Parlor Woodfire',
    formattedAddress: '123 Main St, Los Angeles, CA 90001',
    latitude: 34.05,
    longitude: -118.24,
    types: ['restaurant'],
    confidenceScore: 0.96,
    evidence: [],
    reasons: [],
  } as any;
  return {
    mentionId: 'm1',
    displayName: 'Parlor Woodfire',
    outcome: 'verified_single',
    query: 'Parlor Woodfire Los Angeles California',
    candidates: [candidate],
    scoring: [{
      googlePlaceId: candidate.googlePlaceId,
      name: candidate.name,
      rawScore: 100,
      normalizedScore: 0.97,
      reasons: [
        'business_type',
        'compact_name_match',
        'distinctive_token_match',
        'state_match',
        'distance_nearby',
      ],
      rejected: false,
      rejectionReason: null,
    }],
    ...over,
  };
}

function decide(m = mention(), r = result(), all = [r]) {
  return evaluateMediaAutoSave({ mention: m, result: r, allResults: all });
}

check('auto-save authorization requires exact canary user', mediaAutoSaveAuthorized({ enabled: true, canaryUserId: 'user-a', userId: 'user-a' }));
check('auto-save authorization rejects another user', !mediaAutoSaveAuthorized({ enabled: true, canaryUserId: 'user-a', userId: 'user-b' }));
check('auto-save authorization is global without a canary restriction', mediaAutoSaveAuthorized({ enabled: true, canaryUserId: null, userId: 'user-a' }));
check('auto-save authorization obeys kill switch', !mediaAutoSaveAuthorized({ enabled: false, canaryUserId: 'user-a', userId: 'user-a' }));
check('global auto-save authorization obeys kill switch', !mediaAutoSaveAuthorized({ enabled: false, canaryUserId: null, userId: 'user-a' }));
check('default gate threshold is 0.70', DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD === 0.70 && MEDIA_AUTO_SAVE_MIN_SCORE === 0.70);
check('absent threshold uses valid default', resolveMediaAutoSaveThreshold(undefined).value === 0.70 && resolveMediaAutoSaveThreshold(undefined).valid);
check('configured production threshold accepts 0.70', resolveMediaAutoSaveThreshold('0.70').value === 0.70);
check('configured threshold accepts inclusive zero', resolveMediaAutoSaveThreshold('0').value === 0);
check('configured threshold accepts inclusive one', resolveMediaAutoSaveThreshold('1').value === 1);
check('configured threshold rejects below zero', !resolveMediaAutoSaveThreshold('-0.01').valid);
check('configured threshold rejects above one', !resolveMediaAutoSaveThreshold('1.01').valid);
check('configured threshold rejects non-number', !resolveMediaAutoSaveThreshold('conservative').valid);

{
  const d = decide();
  check('one distinctive transcript mention with a strong provider match is eligible', d.eligible);
  check('gate emits versioned rule', d.ruleVersion === MEDIA_AUTO_SAVE_RULE_VERSION);
  check('gate returns deterministic score', d.confidenceScore === 0.97);
  check('gate explains the successful decision', d.reasonCodes.includes('single_plausible_candidate'));
}
{
  const d = decide(mention({ identityEvidenceKind: 'model_prior' }));
  check('model-prior recognition can never auto-save', !d.eligible && d.reasonCodes.includes('model_prior_unverified'));
}
{
  const alternative = mention({ displayName: 'South Cove', normalizedName: 'south cove' });
  const d = decide(mention({ identityAlternatives: [alternative] }));
  check('unresolved same-scene identity uncertainty blocks auto-save', !d.eligible && d.reasonCodes.includes('identity_hypothesis_uncertainty'));
}
{
  const naturalMention = mention({
    displayName: 'Griffith Park',
    normalizedName: 'griffith park',
    distinctiveTokens: ['griffith'],
    category: 'park',
    geo: { city: 'Los Angeles', region: 'California', country: 'United States' },
  });
  const naturalResult = result();
  naturalResult.candidates[0]!.name = 'Griffith Park';
  naturalResult.candidates[0]!.formattedAddress = 'Los Angeles, CA 90027';
  naturalResult.candidates[0]!.types = ['park', 'tourist_attraction'];
  naturalResult.scoring[0]!.name = 'Griffith Park';
  naturalResult.scoring[0]!.reasons = naturalResult.scoring[0]!.reasons.filter(
    (reason) => reason !== 'business_type',
  );
  check('provider-verified natural place needs no business taxonomy marker', decide(naturalMention, naturalResult, [naturalResult]).eligible);
}
{
  const woodsCoveMention = mention({
    displayName: 'Woods Cove',
    normalizedName: 'woods cove',
    distinctiveTokens: ['woods', 'cove'],
    category: 'beach',
    geo: { city: 'Laguna Beach', region: 'California', country: 'United States' },
  });
  const woodsCoveResult = result();
  woodsCoveResult.candidates[0]!.name = 'Woods Cove';
  woodsCoveResult.candidates[0]!.formattedAddress = 'Woods Cove, Laguna Beach, CA 92651';
  woodsCoveResult.candidates[0]!.primaryType = 'establishment';
  woodsCoveResult.candidates[0]!.types = ['establishment', 'natural_feature'];
  woodsCoveResult.scoring[0]!.name = 'Woods Cove';
  woodsCoveResult.scoring[0]!.reasons = woodsCoveResult.scoring[0]!.reasons.filter(
    (reason) => reason !== 'business_type',
  );
  check(
    'Woods Cove production shape auto-saves without a business marker',
    decide(woodsCoveMention, woodsCoveResult, [woodsCoveResult]).eligible,
  );
}
{
  const genericResult = result();
  genericResult.candidates[0]!.primaryType = 'establishment';
  genericResult.candidates[0]!.types = ['establishment', 'point_of_interest'];
  genericResult.scoring[0]!.reasons = genericResult.scoring[0]!.reasons.filter(
    (reason) => reason !== 'business_type',
  );
  const decision = decide(mention(), genericResult, [genericResult]);
  check(
    'generic establishment taxonomy cannot veto strong identity and context',
    decision.eligible,
  );
}
{
  const paradiseMention = mention({
    displayName: 'Paradise Falls',
    normalizedName: 'paradise falls',
    distinctiveTokens: ['paradise', 'falls'],
    category: 'hiking_trail',
    nameEvidenceSources: ['speech'],
    sources: ['speech', 'frame'],
    repeated: false,
  });
  const paradiseResult = result();
  paradiseResult.candidates[0]!.name = 'Paradise Falls';
  paradiseResult.candidates[0]!.formattedAddress = 'Wildwood Regional Park, 928 W Avenida De Los Arboles, Thousand Oaks, CA 91360';
  paradiseResult.candidates[0]!.primaryType = 'establishment';
  paradiseResult.candidates[0]!.types = ['establishment', 'point_of_interest'];
  paradiseResult.scoring[0]!.name = 'Paradise Falls';
  paradiseResult.scoring[0]!.normalizedScore = 0.9451;
  paradiseResult.scoring[0]!.reasons = [
    'compact_name_match',
    'distinctive_token_match',
    'state_match',
    'distance_nearby',
  ];
  check(
    'Paradise Falls production shape auto-saves from one named channel',
    decide(paradiseMention, paradiseResult, [paradiseResult]).eligible,
  );
}
{
  const r = result({ outcome: 'ambiguous_candidates' });
  check('one plausible candidate auto-saves despite the old ambiguous outcome', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.69;
  check('one plausible candidate at 0.69 auto-saves', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.68;
  check('one clearly matched candidate below the old threshold auto-saves', decide(mention(), r, [r]).eligible);
}
{
  const r = result({ outcome: 'ambiguous_candidates' });
  r.scoring[0]!.normalizedScore = 0.39;
  const d = decide(mention(), r, [r]);
  check('candidate below the resolver plausibility floor stays in review', !d.eligible && d.reasonCodes.includes('no_plausible_candidate'));
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.70;
  check('gate score 0.70 auto-saves when all requirements pass', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.71;
  check('gate score 0.71 auto-saves when all requirements pass', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates.push({
    ...r.candidates[0]!,
    googlePlaceId: 'google-competitor',
    name: 'Woodfire Parlor East',
  });
  r.scoring.push({
    ...r.scoring[0]!,
    googlePlaceId: 'google-competitor',
    name: 'Woodfire Parlor East',
    normalizedScore: 0.91,
  });
  const d = decide(mention(), r, [r]);
  check(
    'gate score 0.95 with a competing candidate remains blocked',
    !d.eligible && d.reasonCodes.includes('multiple_plausible_candidates'),
  );
}
{
  const r = result({ outcome: 'ambiguous_candidates' });
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates.push({
    ...r.candidates[0]!,
    googlePlaceId: 'google-westside',
    name: 'Parlor Woodfire Westside',
  });
  r.scoring.push({
    ...r.scoring[0]!,
    googlePlaceId: 'google-westside',
    name: 'Parlor Woodfire Westside',
    normalizedScore: 0.94,
  });
  const d = decide(mention(), r, [r]);
  check(
    'two close same-name branches remain blocked',
    !d.eligible && d.reasonCodes.includes('branch_ambiguity'),
  );
}
for (const source of ['speech', 'visible_text', 'caption'] as const) {
  const d = decide(mention({ sources: [source], nameEvidenceSources: [source], repeated: false }));
  check(`one ${source} name channel is sufficient`, d.eligible);
}
{
  const d = decide(mention({ sources: [], nameEvidenceSources: [], repeated: false }));
  check('missing transcript, OCR, caption, and frame channels is not a veto', d.eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter(
    (reason) => reason !== 'business_type' && reason !== 'distinctive_token_match',
  );
  check('positive provider taxonomy and distinctive markers are not vetoes', decide(mention(), r, [r]).eligible);
}
{
  const m = mention({
    displayName: "Webb's Grainworks",
    normalizedName: "webb's grainworks",
    distinctiveTokens: ["webb's", 'grainworks'],
  });
  const r = result({ outcome: 'ambiguous_candidates' });
  r.candidates[0]!.name = "Webb's | Distillery & Brewery";
  r.scoring[0]!.name = r.candidates[0]!.name;
  r.scoring[0]!.normalizedScore = 0.68;
  r.scoring[0]!.reasons = ['meaningful_name_match', 'distinctive_token_match'];
  check('one weaker but semantically plausible candidate auto-saves', decide(m, r, [r]).eligible);
}
{
  const m = mention({
    category: 'park',
    sources: ['frame'],
    nameEvidenceSources: ['frame'],
    repeated: false,
  });
  const r = result();
  r.scoring[0]!.reasons.push('expected_category_match');
  const d = decide(m, r, [r]);
  check('one grounded frame identity is sufficient', d.eligible);
  check('visual evidence is not a separate veto or reason', d.reasonCodes.includes('single_plausible_candidate'));
}
check('model confidence is diagnostic only', decide(mention({ confidence: 0.01 })).eligible);
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  check(
    'gate score 0.95 with host-only confusion remains blocked',
    (() => {
      const d = decide(mention({ hostVenueName: 'Brewery X', relationshipType: 'located_at' }), r, [r]);
      return !d.eligible && d.reasonCodes.includes('host_relationship');
    })(),
  );
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates[0]!.latitude = undefined;
  const d = decide(mention(), r, [r]);
  check('gate score 0.95 without valid coordinates remains blocked', !d.eligible && d.reasonCodes.includes('provider_identity_invalid'));
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates[0]!.googlePlaceId = '';
  const d = decide(mention(), r, [r]);
  check('gate score 0.95 without a provider Place ID remains blocked', !d.eligible && d.reasonCodes.includes('provider_identity_invalid'));
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter((reason) => reason !== 'state_match');
  check('missing positive state marker is supporting, not a veto', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter((reason) => reason !== 'distance_nearby');
  check('missing positive city proximity marker is supporting, not a veto', decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter((reason) => reason !== 'distance_nearby');
  r.scoring[0]!.reasons.push('distance_close');
  const d = decide(mention(), r, [r]);
  check('conflicting locality remains blocked', !d.eligible && d.reasonCodes.includes('location_conflict'));
}
{
  const r = result();
  r.scoring[0]!.reasons.push('permanently_closed');
  check('permanently closed rejected', !decide(mention(), r, [r]).eligible);
}
{
  const a = result();
  const b = result({ mentionId: 'm2', displayName: 'Duplicate Slot' });
  const d = decide(mention(), a, [a, b]);
  check('same canonical place across slots rejected', !d.eligible && d.reasonCodes.includes('canonical_place_ambiguity'));
}
{
  const eligible = result();
  const ambiguous = result({
    mentionId: 'm2',
    displayName: 'Joe Pizza',
    outcome: 'ambiguous_candidates',
    candidates: [{ ...result().candidates[0], googlePlaceId: 'google-joe' } as any],
  });
  const all = [eligible, ambiguous];
  check('mixed post keeps eligible slot independent', decide(mention(), eligible, all).eligible);
  check('mixed post keeps ambiguous slot for review', !decide(mention({ id: 'm2' }), ambiguous, all).eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter(
    (reason) => reason !== 'compact_name_match' && reason !== 'strong_name_match',
  );
  r.scoring[0]!.reasons.push('meaningful_name_match');
  const d = decide(
    mention({
      displayName: 'Cathedral Peak',
      normalizedName: 'cathedral peak',
      distinctiveTokens: ['cathedral', 'peak'],
    }),
    r,
    [r],
  );
  check(
    'weak generic name with insufficient identity support stays in review',
    !d.eligible && d.reasonCodes.includes('no_plausible_candidate'),
  );
}
{
  const broadMention = mention({
    displayName: 'Kyrgyzstan',
    normalizedName: 'kyrgyzstan',
    distinctiveTokens: ['kyrgyzstan'],
    category: 'scenic_spot',
  });
  const broadResult = result();
  broadResult.candidates[0]!.name = 'The Best Scenic Road in Kyrgyzstan';
  broadResult.scoring[0]!.name = broadResult.candidates[0]!.name;
  const d = decide(broadMention, broadResult, [broadResult]);
  check(
    'one-token broad geography expanded into a provider name stays in review',
    !d.eligible && d.reasonCodes.includes('no_plausible_candidate'),
  );
}
{
  const unrelatedMention = mention({
    displayName: 'Paradise Falls',
    normalizedName: 'paradise falls',
    distinctiveTokens: ['paradise', 'falls'],
    category: 'hiking_trail',
  });
  const unrelatedResult = result({ outcome: 'ambiguous_candidates' });
  unrelatedResult.candidates[0]!.name = 'Paradise Dental Group';
  unrelatedResult.scoring[0]!.name = 'Paradise Dental Group';
  unrelatedResult.scoring[0]!.normalizedScore = 0.82;
  unrelatedResult.scoring[0]!.reasons = [
    'meaningful_name_match',
    'distinctive_token_match',
    'expected_category_mismatch_soft',
  ];
  const d = decide(unrelatedMention, unrelatedResult, [unrelatedResult]);
  check('obviously unrelated provider entity stays in review', !d.eligible && d.reasonCodes.includes('no_plausible_candidate'));
}
{
  const routeMention = mention({
    displayName: 'Table Rock',
    normalizedName: 'table rock',
    distinctiveTokens: ['table', 'rock'],
  });
  const routeResult = result({ outcome: 'ambiguous_candidates' });
  routeResult.candidates[0]!.name = 'Table Rock Drive';
  routeResult.candidates[0]!.types = ['route'];
  routeResult.scoring[0]!.name = 'Table Rock Drive';
  routeResult.scoring[0]!.normalizedScore = 0.71;
  routeResult.scoring[0]!.reasons = ['strong_name_match', 'distinctive_token_match'];
  const d = decide(routeMention, routeResult, [routeResult]);
  check('address-like provider entity is not a plausible saved place', !d.eligible && d.reasonCodes.includes('no_plausible_candidate'));
}
{
  const trailMention = mention({
    displayName: 'June Lake Loop Trail',
    normalizedName: 'june lake loop trail',
    distinctiveTokens: ['june', 'lake', 'loop'],
    category: 'hiking_trail',
  });
  const trailResult = result({ outcome: 'ambiguous_candidates' });
  trailResult.candidates[0]!.name = 'Reversed Peak Loop Trail';
  trailResult.scoring[0]!.name = 'Reversed Peak Loop Trail';
  trailResult.scoring[0]!.normalizedScore = 0.86;
  trailResult.scoring[0]!.reasons = ['meaningful_name_match', 'distinctive_token_match'];
  const d = decide(trailMention, trailResult, [trailResult]);
  check('shared generic loop/trail wording cannot make an unrelated trail plausible', !d.eligible && d.reasonCodes.includes('no_plausible_candidate'));
}
{
  const noResult = result({ outcome: 'no_match', candidates: [], scoring: [] });
  const d = decide(mention(), noResult, [noResult]);
  check('zero plausible candidates stays in review', !d.eligible && d.reasonCodes.includes('no_plausible_candidate'));
}
{
  const exactBrandMention = mention({
    displayName: 'Nobu',
    normalizedName: 'nobu',
    distinctiveTokens: ['nobu'],
  });
  const exactBrandResult = result();
  exactBrandResult.candidates[0]!.name = 'Nobu';
  exactBrandResult.scoring[0]!.name = 'Nobu';
  check(
    'exact one-word brand remains eligible',
    decide(exactBrandMention, exactBrandResult, [exactBrandResult]).eligible,
  );
}
{
  const eligible = result();
  const hiddenInvalidAlternative = result({
    mentionId: 'm2',
    displayName: 'Invalid extraction',
    outcome: 'no_match',
    candidates: [],
    scoring: [],
  });
  check(
    'hidden invalid alternatives do not reject one valid verified candidate',
    decide(mention(), eligible, [eligible, hiddenInvalidAlternative]).eligible,
  );
}
{
  const eligible = result();
  eligible.scoring.push({
    googlePlaceId: 'garbage-alternative',
    name: 'TikTok Inc.',
    rawScore: -1_000,
    normalizedScore: 0,
    reasons: ['platform_noise_rejected'],
    rejected: true,
    rejectionReason: 'platform_noise',
  });
  check(
    'one meaningful candidate plus a rejected garbage alternative auto-saves',
    decide(mention(), eligible, [eligible]).eligible,
  );
}
{
  const first = result();
  const second = result({
    mentionId: 'm2',
    displayName: 'Second Place',
    candidates: [{ ...result().candidates[0]!, googlePlaceId: 'google-second', name: 'Second Place' } as any],
    scoring: [{
      ...result().scoring[0]!,
      googlePlaceId: 'google-second',
      name: 'Second Place',
    }],
  });
  const all = [first, second];
  check('two logical places auto-save independently', decide(mention(), first, all).eligible && decide(mention({ id: 'm2', displayName: 'Second Place', normalizedName: 'second place', distinctiveTokens: ['second'] }), second, all).eligible);
}
{
  const one = result();
  check('one unresolved result with one option uses single review', mediaReviewDecision([one]) === 'candidate_confirmation');
  const branch = result();
  branch.candidates.push({ ...branch.candidates[0]!, googlePlaceId: 'branch-2' });
  check('one logical result with two options uses multi review', mediaReviewDecision([branch]) === 'multi_candidate_confirmation');
  check('multiple unresolved logical results use multi review', mediaReviewDecision([one, branch]) === 'multi_candidate_confirmation');
}
{
  const d = decide();
  const notification = composeShareCompletionNotification({
    jobId: 'job-single-plausible',
    status: d.eligible ? 'completed' : 'needs_help',
    savedPlaceId: d.eligible ? 'saved-1' : null,
    candidateCount: d.eligible ? 0 : 1,
  });
  check('one-candidate auto-save cannot generate unresolved notification', notification.data.type === 'share_job_completed');
}
{
  const d = decide();
  const line = formatMediaAutoSaveDecisionLog({
    jobId: 'job-1',
    logicalPlaceId: 'm1',
    decision: d,
    finalDecision: 'auto_save',
    finalReasonCodes: d.reasonCodes,
  });
  for (const field of [
    'job_id=', 'logical_place_id=', 'raw_candidate_count=', 'plausible_candidate_count=',
    'selected_provider_id=', 'selected_score=', 'rejection_reasons=',
    'explicit_conflict_flags=', 'final_decision=', 'decision_reason=',
  ]) {
    check(`decision log includes ${field}`, line.includes(field));
  }
  check('decision log excludes transcripts and candidate names', !line.includes('Parlor Woodfire'));
}

console.log(failures === 0 ? '\nALL MEDIA AUTO-SAVE GATE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
