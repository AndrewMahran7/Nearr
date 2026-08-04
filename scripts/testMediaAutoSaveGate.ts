import {
  evaluateMediaAutoSave,
  mediaAutoSaveAuthorized,
  DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD,
  MEDIA_AUTO_SAVE_MIN_SCORE,
  MEDIA_AUTO_SAVE_RULE_VERSION,
  resolveMediaAutoSaveThreshold,
} from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
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
    sources: ['speech', 'visible_text'],
    nameEvidenceSources: ['speech', 'visible_text'],
    timestamps: [1, 8],
    mentionCount: 2,
    repeated: true,
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
  check('strict verified place is eligible', d.eligible);
  check('gate emits versioned rule', d.ruleVersion === MEDIA_AUTO_SAVE_RULE_VERSION);
  check('gate returns deterministic score', d.confidenceScore === 0.97);
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
  check('provider-verified natural place needs no street address', decide(naturalMention, naturalResult, [naturalResult]).eligible);
}
{
  const r = result({ outcome: 'ambiguous_candidates' });
  check('ambiguous result rejected', !decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.69;
  check('gate score 0.69 does not auto-save', !decide(mention(), r, [r]).eligible);
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
  r.candidates.push({ ...r.candidates[0]!, googlePlaceId: 'google-competitor' });
  check('gate score 0.95 with a competing candidate remains blocked', !decide(mention(), r, [r]).eligible);
}
{
  const r = result({ outcome: 'ambiguous_candidates' });
  r.scoring[0]!.normalizedScore = 0.95;
  check('gate score 0.95 with branch ambiguity remains blocked', !decide(mention(), r, [r]).eligible);
}
check('single name-evidence channel rejected', !decide(mention({ nameEvidenceSources: ['speech'] })).eligible);
check('model confidence is diagnostic only', decide(mention({ confidence: 0.01 })).eligible);
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  check(
    'gate score 0.95 with host-only confusion remains blocked',
    !decide(mention({ hostVenueName: 'Brewery X', relationshipType: 'located_at' }), r, [r]).eligible,
  );
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates[0]!.latitude = undefined;
  check('gate score 0.95 without valid coordinates remains blocked', !decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.normalizedScore = 0.95;
  r.candidates[0]!.googlePlaceId = '';
  check('gate score 0.95 without a provider Place ID remains blocked', !decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons = r.scoring[0]!.reasons.filter((reason) => reason !== 'state_match');
  check('missing state agreement rejected', !decide(mention(), r, [r]).eligible);
}
{
  const r = result();
  r.scoring[0]!.reasons.push('permanently_closed');
  check('permanently closed rejected', !decide(mention(), r, [r]).eligible);
}
{
  const a = result();
  const b = result({ mentionId: 'm2', displayName: 'Duplicate Slot' });
  check('same canonical place across slots rejected', !decide(mention(), a, [a, b]).eligible);
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

console.log(failures === 0 ? '\nALL MEDIA AUTO-SAVE GATE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);