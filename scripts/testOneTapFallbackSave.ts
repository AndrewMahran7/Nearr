import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fallbackCorrectionLabel,
  fallbackSaveLabel,
  preselectedFallbackCandidate,
  selectFallbackCandidate,
  usableFallbackCandidates,
} from '../lib/oneTapFallbackSave';
import { getVayrinCandidateFixture } from '../lib/vayrinCandidateFixtures';

const read = (path: string) => readFileSync(path, 'utf8');
const screen = read('app/share-jobs/[jobId].tsx');
const correction = read('components/map/WrongPlaceSheet.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const candidateSave = read('services/shareJobCandidateSave.ts');
const savedPlaces = read('services/savedPlacesService.ts');
const cacheV2 = read('supabase/migrations/20260906000004_recognition_cache_v2.sql');

const candidate = (id: string, name: string) => ({
  googlePlaceId: id,
  name,
  formattedAddress: `${name}, New York, United States`,
  latitude: 42,
  longitude: -74,
  rawTypes: ['natural_feature'],
});
const catskill = candidate('catskill', 'Catskill');
const second = candidate('second', 'Catskill Park');

// 1-2: the persisted suggestion itself triggers lookup; its card is context,
// not a prerequisite for the provider request.
assert.match(screen, /fallbackSuggestionSearchRef[\s\S]*runManualSearch\(lead\.suggestedQuery\)/);
assert.match(screen, /setSearchExpanded\(true\)[\s\S]*runManualSearch\(lead\.suggestedQuery\)/);

// 3-4: one usable provider result is selected and named immediately.
assert.equal(preselectedFallbackCandidate([catskill])?.googlePlaceId, 'catskill');
assert.equal(fallbackSaveLabel(' Catskill '), 'Save Catskill');
const catskillsFixture = getVayrinCandidateFixture('vayrin-confirm-catskills');
assert.equal(catskillsFixture?.suggestedQuery, 'Catskills New York United States');
assert.equal(catskillsFixture?.manualResults?.[0]?.name, 'Catskill');

// 5-6: only the sticky CTA reaches the canonical mutation; a result press only
// replaces selected ids.
assert.match(screen, /onPress=\{\(\) => void handleSaveCanonicalCandidates\(/);
const manualSearch = screen.slice(screen.indexOf('const runManualSearch'), screen.indexOf('function changeManualQuery'));
assert.doesNotMatch(manualSearch, /persistCandidate|handleSaveCanonicalCandidates|handleSaveStored/);
assert.match(screen, /onPress=\{\(\) => setManualSelectedIds\([\s\S]*selectFallbackCandidate/);
assert.match(card, /testID="compact-candidate-row"[\s\S]*onPress=\{selectable \? onPress : undefined\}|onPress=\{selectable \? onPress : undefined\}[\s\S]*testID="compact-candidate-row"/);

// 7-9: rank 1 is selected for multiple results, selecting rank 2 is exclusive,
// and the selected array is what the CTA commits.
assert.equal(preselectedFallbackCandidate([catskill, second])?.googlePlaceId, 'catskill');
assert.deepEqual(selectFallbackCandidate([catskill, second], 'second'), ['second']);
assert.equal(fallbackSaveLabel(second.name), 'Save Catskill Park');
assert.match(screen, /handleSaveCanonicalCandidates\(\s*manualSelected,\s*'raw_name_search'/);

// 10-13: empty/error states have no fake save, searches save nothing, selection
// survives save errors, and both provider/save retries remain available.
assert.equal(preselectedFallbackCandidate([]), null);
assert.match(screen, /title="Search another place"/);
assert.match(screen, /manualSelected\.length > 0 \? \(/);
assert.doesNotMatch(manualSearch, /markShareJobResolved|completeManualSave/);
const saveFlow = screen.slice(screen.indexOf('async function handleSaveCanonicalCandidates'), screen.indexOf('async function handleSaveBatch'));
assert.match(saveFlow, /catch \(err\)[\s\S]*Could not save/);
assert.doesNotMatch(saveFlow, /setManualSelectedIds\(\[\]\)/);
assert.match(screen, /manualSearchPhase === 'error' \? 'Retry' : 'Search'/);

// 14-19: the existing canonical save boundary still owns dedupe, one source
// attachment, user-note preservation, AI-note delivery, source groups, and the
// saved-place/source relationship consumed by the gallery.
assert.match(savedPlaces, /eq\('google_place_id', candidate\.googlePlaceId\)/);
assert.match(savedPlaces, /code === '23505'[\s\S]*enrichExistingSavedPlace/);
assert.match(savedPlaces, /attachSavedPlaceSource\(/);
assert.match(savedPlaces, /User notes are authored only/);
assert.match(screen, /fallbackAiNote/);
assert.match(candidateSave, /aiNote: args\.aiNote/);
assert.match(candidateSave, /source_group_manual_save_joined/);
assert.match(candidateSave, /sourceUrl: args\.sourceUrl/);

// 20: correction remains on the canonical correction RPC/idempotency path, so
// Cache V2 feedback revision, quarantine, support, and revalidation semantics
// are unchanged.
assert.match(correction, /correctSavedPlace\(/);
assert.match(correction, /correctionAttemptRef/);
assert.equal(fallbackCorrectionLabel('Third Wave BBQ'), 'Use Third Wave BBQ');
for (const contract of [
  /feedback_revision=ss\.feedback_revision\+1/,
  /whole_source_quarantined/,
  /recognition_identity_support/,
  /recognition_revalidation_tasks/,
  /recognition_cache_stale/,
]) assert.match(cacheV2, contract);

// 21-23: persistent safe-area CTA, keyboard accommodation, Dynamic Type, and
// untruncated generated copy for long place names.
assert.match(screen, /automaticallyAdjustKeyboardInsets/);
assert.match(screen, /quick-check-sticky-save-bar/);
assert.match(screen, /Math\.max\(safeAreaInsets\.bottom, Spacing\.sm\)/);
assert.doesNotMatch(`${screen}\n${card}`, /allowFontScaling=\{false\}/);
const longName = 'Nanaimo River Regional Park and Heritage Conservation Area';
assert.equal(fallbackSaveLabel(longName), `Save ${longName}`);

// 24-25: retired fallback copy does not return on either correction surface.
for (const source of [screen, correction]) {
  assert.doesNotMatch(source, /Needs search/i);
  assert.doesNotMatch(source, /Search needed/i);
}

// Bounded/usable filtering is shared by initial selection and rendering.
assert.deepEqual(
  usableFallbackCandidates([catskill, second, candidate('third', 'Third'), candidate('fourth', 'Fourth')])
    .map((item) => item.googlePlaceId),
  ['catskill', 'second', 'third'],
);
assert.equal(fallbackSaveLabel(null), 'Save place');

console.log('PASS one-tap fallback save: auto-search, rank-1 selection, explicit canonical save, recovery, layout, and copy');
