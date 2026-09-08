import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFindRightPlace } from '../lib/findRightPlace';
import { normalizeResolutionName } from '../lib/contextAwarePlacesResolution';
import { planNamedLeadAutomaticRecovery } from '../lib/namedLeadAutomaticRecovery';

assert.equal(normalizeResolutionName('Nagarkot ZipCoaster'), 'nagarkot zip coaster');
assert.equal(normalizeResolutionName('Nagarkot Zip Coaster'), 'nagarkot zip coaster');
const candidate = {
  googlePlaceId: 'ChIJCcqtRAAF6zkR1HoTXkm6RNc', name: 'Nagarkot Zip Coaster',
  formattedAddress: 'Mahamanjushree Nagarkot 44812, Nepal', latitude: 27.7171758,
  longitude: 85.518039, types: ['establishment', 'point_of_interest', 'tourist_attraction'],
};
assert.equal(planFindRightPlace({
  query: 'Nagarkot ZipCoaster Nagarkot Nepal', expectedName: 'Nagarkot ZipCoaster', candidates: [candidate],
}).action, 'auto_resolve');
assert.equal(planFindRightPlace({
  query: 'Nagarkot ZipCoaster', expectedName: 'Nagarkot ZipCoaster',
  candidates: [candidate, { ...candidate, googlePlaceId: 'second' }],
}).action, 'choose');
assert.equal(planFindRightPlace({
  query: 'Nagarkot ZipCoaster', expectedName: 'Nagarkot ZipCoaster',
  candidates: [{ ...candidate, formattedAddress: 'Colorado, US', reasons: ['country_mismatch'] }],
}).action, 'no_match');

const lead = { mentionId: 'premium-destination-1', displayName: 'Nagarkot ZipCoaster',
  contextLabel: 'Nagarkot, Bagmati Province, Nepal', evidenceKind: 'observable' as const,
  timestamps: [1], suggestedQuery: 'Nagarkot ZipCoaster Nagarkot Nepal', resultType: 'RAW_NAME' as const };
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'needs_help', savedPlaceId: null, leads: [lead] }).length, 1);
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'needs_help', savedPlaceId: null,
  leads: [{ ...lead, evidenceKind: 'model_prior' }] }).length, 0);
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'needs_help', savedPlaceId: 'partial-save', leads: [lead] }).length, 1);
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'completed', savedPlaceId: 'saved', leads: [lead] }).length, 0);

const migration = readFileSync('supabase/migrations/20260907000001_named_lead_automatic_completion.sql', 'utf8');
const ambiguityFix = readFileSync('supabase/migrations/20260907000002_fix_named_lead_saved_place_ambiguity.sql', 'utf8');
const pointerFix = readFileSync('supabase/migrations/20260907000003_fix_named_lead_job_pointer_ambiguity.sql', 'utf8');
assert.match(migration, /for update/);
assert.match(migration, /'automatic',p_confidence_score/);
assert.match(migration, /attach_saved_place_source/);
assert.doesNotMatch(migration, /recognition_identity_support|USER_CONFIRMED|apply_recognition_feedback|resolve_share_job/);
assert.match(ambiguityFix, /sp\.place_id=v_place/);
assert.match(pointerFix, /sj\.saved_place_id/);
const screen = readFileSync('app/share-jobs/[jobId].tsx', 'utf8');
assert.match(screen, /claimNamedLeadAutoRecovery/);
assert.match(screen, /autoCompleteNamedLead/);
console.log('named-lead automatic completion contracts: ok');
