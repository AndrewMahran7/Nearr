import assert from 'node:assert/strict';

import {
  assessSourceEntityCandidate,
  buildExplicitSourceEntityQuery,
  detectExplicitSourceEntity,
  type ExplicitSourceEntity,
} from '../lib/sourceEntitySemanticConsistency';
import { planAutomaticCompletion } from '../lib/automaticCompletion';
import { reuseSavedPlaceBySourceOnly, resolveRecognitionCachePolicy } from '../supabase/functions/_shared/recognitionCachePolicy';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { buildQueryPlan } from '../supabase/functions/process-share-link/resolver/queryBuilder';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';

type Provider = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  types: string[];
  primaryType: string;
  confidenceScore: number;
  reasons: string[];
};

const provider = (name: string, type: string, address: string, id = name): Provider => ({
  googlePlaceId: `provider:${id}`,
  name,
  formattedAddress: address,
  latitude: -37.82,
  longitude: 145.04,
  types: [type],
  primaryType: type,
  confidenceScore: 0.91,
  reasons: ['compact_name_match'],
});

const strongEntity = (overrides: Partial<ExplicitSourceEntity> = {}): ExplicitSourceEntity => ({
  name: 'Wave Three Smokehouse',
  entityType: 'business',
  category: 'food',
  sources: ['platform_title', 'creator_handle', 'official_domain', 'first_party_language'],
  strength: 'strong',
  relation: 'SOURCE_BUSINESS_IS_TARGET',
  country: 'Australia',
  locationHint: 'Hawthorn',
  confidence: 0.96,
  ...overrides,
});

const evidenceFor = (entity: ExplicitSourceEntity | null, overrides: Record<string, unknown> = {}) => ({
  isRoundup: false,
  address: null,
  addresses: [],
  venueNameHints: ['Hawthorn'],
  venueNameHintsFromHandle: [],
  taggedLocation: null,
  handles: { posterHandle: null, posterNameHint: null, venueHandles: [] },
  explicitSourceEntity: entity,
  ...overrides,
});

const gate = (entity: ExplicitSourceEntity | null, candidates: Provider[]) => evaluateMetadataAutoSave({
  result: { decision: 'candidate_confirmation', cleanSearchQuery: entity?.name ?? 'Hawthorn', candidates },
  evidence: evidenceFor(entity),
});

const tests: Array<[string, () => void]> = [
  ['1 Third-Wave-style source blocks shared-token wellness collision', () => {
    const title = 'Third Wave BBQ on Instagram: book your table';
    const description = 'Book now at thirdwavebbq.com.au @thirdwavebbqofficial. Our locations: Hawthorn and Albert Park.';
    const handles = extractHandles({ platform: 'instagram', title, description, html: '' });
    const evidence = extractEvidence({ platform: 'instagram', title, description, handles });
    const entity = evidence.explicitSourceEntity;
    assert.equal(entity?.strength, 'strong');
    assert.equal(entity?.relation, 'SOURCE_BUSINESS_IS_TARGET');
    assert.equal(entity?.country, 'Australia');
    assert.match(buildQueryPlan(evidence).queries[0] ?? '', /^Third Wave BBQ\b/);
    const wrong = provider('Hawthorn Healing Arts Center, LLC', 'wellness_center', '39 Louisiana Ave, Bend, OR 97703, USA');
    const decision = gate(entity!, [wrong]);
    assert.equal(decision.eligible, false);
    assert.equal(decision.plausibleCandidateCount, 0);
    assert.ok(decision.candidateRejectionReasons.includes('source_entity_semantic_conflict'));
  }],
  ['2 exact restaurant branch wins and source query is first', () => {
    const entity = strongEntity();
    const exact = provider('Wave Three Smokehouse Hawthorn', 'barbecue_restaurant', '232 Riversdale Rd, Hawthorn East VIC, Australia');
    const wrong = provider('Hawthorn Healing Center', 'wellness_center', 'Bend, OR, USA');
    const decision = gate(entity, [exact, wrong]);
    assert.equal(decision.eligible, true);
    assert.equal(decision.selectedProviderId, exact.googlePlaceId);
    assert.equal(buildExplicitSourceEntityQuery(entity), 'Wave Three Smokehouse Hawthorn restaurant Australia');
  }],
  ['3 restaurant travel post resolves Mount Fuji instead of restaurant', () => {
    const entity = detectExplicitSourceEntity({
      platform: 'instagram', title: 'Harbor Grill on Instagram: Japan trip',
      description: 'Our team hiked Mount Fuji. harborgrill.com @harborgrillofficial',
    });
    assert.equal(entity?.relation, 'SOURCE_BUSINESS_PROMOTES_OTHER_PLACE');
    const mountain = provider('Mount Fuji', 'natural_feature', 'Kitayama, Fujinomiya, Shizuoka, Japan');
    assert.equal(assessSourceEntityCandidate(entity, mountain).hardContradiction, false);
  }],
  ['4 hotel advert with stock beach footage keeps the hotel target', () => {
    const entity = detectExplicitSourceEntity({
      platform: 'instagram', title: 'Coral House Hotel on Instagram: Escape today',
      description: 'Book now. Stay with us at coralhousehotel.com @coralhousehotelofficial.',
    });
    assert.equal(entity?.strength, 'strong');
    assert.equal(entity?.relation, 'SOURCE_BUSINESS_IS_TARGET');
    assert.equal(assessSourceEntityCandidate(entity, provider('Coral House Hotel', 'hotel', 'Queensland, Australia')).verdict, 'SUPPORTS');
  }],
  ['5 generic creator hidden-cliff post does not become a business', () => {
    const entity = detectExplicitSourceEntity({
      platform: 'instagram', title: 'adventurelover92 on Instagram: hidden cliff',
      description: 'Found this hidden cliff after a long hike', creatorHandle: 'adventurelover92',
    });
    assert.notEqual(entity?.strength, 'strong');
  }],
  ['6 weak identity token is not forced', () => {
    const entity = detectExplicitSourceEntity({ platform: 'instagram', title: 'Sunset on Instagram: wow', description: 'sunset view' });
    assert.equal(entity?.strength, 'weak');
    assert.equal(assessSourceEntityCandidate(entity, provider('Sunset Beach', 'beach', 'California, USA')).verdict, 'UNKNOWN');
  }],
  ['7 shared-token dental collision is blocked for hotel source', () => {
    const entity = strongEntity({ name: 'Sunset Hotel', category: 'lodging', locationHint: null });
    const assessment = assessSourceEntityCandidate(entity, provider('Sunset Dental Center', 'dentist', 'Bend, OR, USA'));
    assert.equal(assessment.hardContradiction, true);
    assert.ok(assessment.reasons.includes('provider_category_conflict_blocked'));
  }],
  ['8 category-compatible close-name candidate remains viable', () => {
    const entity = strongEntity({ name: 'Harbor Brew Cafe', locationHint: null });
    const candidate = provider('Harbor Brew Cafe Downtown', 'cafe', 'Melbourne VIC, Australia');
    assert.equal(assessSourceEntityCandidate(entity, candidate).verdict, 'SUPPORTS');
  }],
  ['9 weak provider support plus country conflict is blocked', () => {
    const entity = strongEntity({ name: 'North Star Cafe', locationHint: null });
    const candidate = provider('North Star Cafe', 'cafe', 'Seattle, WA, USA');
    const assessment = assessSourceEntityCandidate(entity, candidate);
    assert.equal(assessment.geographyCompatibility, 'conflict');
    assert.equal(assessment.hardContradiction, true);
  }],
  ['10 explicit travel context permits a different country', () => {
    const entity = strongEntity({ relation: 'SOURCE_BUSINESS_PROMOTES_OTHER_PLACE' });
    assert.equal(assessSourceEntityCandidate(entity, provider('Mount Fuji', 'natural_feature', 'Shizuoka, Japan')).hardContradiction, false);
  }],
  ['11 multi-location content preserves sibling targets', () => {
    const entity = strongEntity({ relation: 'VIDEO_CONTAINS_MULTIPLE_TARGETS' });
    for (const sibling of ['Wave Three Smokehouse Hawthorn', 'Wave Three Smokehouse Albert Park']) {
      assert.equal(assessSourceEntityCandidate(entity, provider(sibling, 'restaurant', 'Victoria, Australia')).hardContradiction, false);
    }
  }],
  ['12 provider parent is rejected while exact source entity is preserved', () => {
    const entity = strongEntity({ name: 'Skyline Rooftop Restaurant', country: 'United States', locationHint: null });
    const exact = provider('Skyline Rooftop Restaurant', 'restaurant', 'Chicago, IL, USA', 'exact');
    const parent = provider('Skyline Hotel', 'hotel', 'Chicago, IL, USA', 'parent');
    const decision = gate(entity, [exact, parent]);
    assert.equal(decision.eligible, true);
    assert.equal(decision.selectedProviderId, exact.googlePlaceId);
    assert.equal(decision.semanticConflictBlockedCount, 1);
  }],
  ['13 wrong-place correction cannot authorize source-only cache reuse', () => {
    const policy = resolveRecognitionCachePolicy(() => 'true');
    assert.equal(reuseSavedPlaceBySourceOnly(policy), false);
    const wrong = provider('Hawthorn Healing Center', 'wellness_center', 'Bend, OR, USA');
    assert.equal(assessSourceEntityCandidate(strongEntity(), wrong).hardContradiction, true);
  }],
  ['14 fresh model/provider agreement remains autosave-eligible', () => {
    const exact = provider('Wave Three Smokehouse Hawthorn', 'restaurant', 'Hawthorn East VIC, Australia');
    const decision = gate(strongEntity(), [exact]);
    assert.equal(decision.eligible, true);
    assert.equal(decision.sourceEntityCandidateAgreement, 'supports');
  }],
  ['15 absurd soft alternative is filtered from automatic completion', () => {
    const exact = provider('Wave Three Smokehouse Hawthorn', 'restaurant', 'Hawthorn East VIC, Australia');
    const absurd = { ...provider('Hawthorn Healing Center', 'wellness_center', 'Bend, OR, USA'), reasons: ['source_entity_semantic_conflict'] };
    const plan = planAutomaticCompletion([
      { ...exact, exactIdentityStrength: 'candidate_bound' },
      absurd,
    ]);
    assert.equal(plan.action, 'save');
    assert.deepEqual(plan.action === 'save' ? plan.alternatives : [], []);
  }],
  ['16 no defensible candidate escalates instead of saving', () => {
    const wrong = provider('Hawthorn Healing Center', 'wellness_center', 'Bend, OR, USA');
    const decision = gate(strongEntity(), [wrong]);
    const plan = planAutomaticCompletion(decision.plausibleProviderIds.map(() => wrong));
    assert.equal(decision.eligible, false);
    assert.equal(plan.action, 'escalate');
  }],
];

let passed = 0;
for (const [name, run] of tests) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}
assert.equal(passed, 16);
console.log(`PASS source entity semantic consistency matrix (${passed}/16)`);
