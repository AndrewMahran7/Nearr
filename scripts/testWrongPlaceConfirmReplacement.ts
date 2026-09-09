import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planFindRightPlace } from '../lib/findRightPlace';
import { planWrongPlaceCorrection, reconcileCorrectedSavedPlaces } from '../lib/wrongPlaceCorrection';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sheet = read('components/map/WrongPlaceSheet.tsx');
const service = read('services/savedPlacesService.ts');
const map = read('app/(tabs)/map.tsx');
const job = read('app/share-jobs/[jobId].tsx');
const migration = read('supabase/migrations/20260906000004_recognition_cache_v2.sql');
const multiSource = read('supabase/migrations/20260822000003_correct_saved_place_multi_source.sql');

const replacement = {
  googlePlaceId: 'third-wave-albert-park',
  name: 'Third Wave BBQ Albert Park',
  formattedAddress: 'Albert Park VIC 3206, Australia',
  latitude: -37.84,
  longitude: 144.95,
  rawTypes: ['restaurant'],
};

const cases: Array<[string, () => void]> = [
  ['search returns one result', () => {
    const plan = planFindRightPlace({ query: 'Third Wave BBQ', expectedName: 'Third Wave BBQ', candidates: [replacement] });
    assert.equal(plan.action, 'auto_resolve');
  }],
  ['selecting does not mutate immediately', () => {
    assert.match(sheet, /onPress=\{\(\) => selectCandidate\(candidate\)\}/);
    assert.doesNotMatch(sheet, /void apply\(resolutionPlan\.candidate\)/);
  }],
  ['selected state is visible', () => {
    assert.match(sheet, /isSelected \? styles\.rowSelected/);
    assert.match(sheet, /check-circle/);
  }],
  ['Use named place is visible in the persistent footer', () => {
    const scrollEnd = sheet.indexOf('</ScrollView>');
    const action = sheet.indexOf("title={saving ? 'Saving…' : fallbackCorrectionLabel(chosen.name)}");
    assert.ok(scrollEnd > -1 && action > scrollEnd);
  }],
  ['Use this place is enabled only with a valid selection', () => {
    assert.match(sheet, /\{chosen \? \([\s\S]*disabled=\{saving\}[\s\S]*\) : null\}/);
  }],
  ['tap commits the canonical correction', () => {
    assert.match(sheet, /onPress=\{\(\) => void apply\(chosen\)\}/);
    assert.match(service, /'correct_saved_place_provider_v2'/);
  }],
  ['duplicate tap is idempotent', () => {
    assert.match(sheet, /if \(saveInFlightRef\.current\) return/);
    assert.match(sheet, /correctionAttemptRef\.current = \{ candidateId: candidate\.googlePlaceId, key: idempotencyKey \}/);
  }],
  ['success closes and updates the result', () => {
    assert.ok(sheet.indexOf('onCorrected(result.saved)') < sheet.indexOf('onClose()', sheet.indexOf('onCorrected(result.saved)')));
  }],
  ['View on map targets the replacement', () => {
    assert.match(map, /focusCorrectedPlace/);
    assert.match(job, /openExistingPlace\(\{ savedPlaceId: updated\.id/);
  }],
  ['failure preserves selection', () => {
    const catchBody = sheet.slice(sheet.indexOf('} catch (caught) {'), sheet.indexOf('} finally {'));
    assert.match(catchBody, /setSaveError\(message\)/);
    assert.doesNotMatch(catchBody, /setSelected\(null\)/);
  }],
  ['retry reuses the same correction attempt', () => {
    assert.match(sheet, /existingAttempt\?\.candidateId === candidate\.googlePlaceId[\s\S]*\? existingAttempt\.key/);
    assert.match(sheet, /fallbackCorrectionLabel\(chosen\?\.name\)/);
  }],
  ['existing replacement dedupes', () => {
    assert.match(multiSource, /v_merge_source_id/);
    assert.deepEqual(reconcileCorrectedSavedPlaces(
      [{ id: 'wrong' }, { id: 'existing' }, { id: 'sibling' }],
      { id: 'wrong' },
      'existing',
    ), [{ id: 'wrong' }, { id: 'sibling' }]);
  }],
  ['source and video relationships are preserved', () => {
    assert.match(multiSource, /jsonb_agg\(to_jsonb\(s\)/);
    assert.match(service, /sources:saved_place_sources\(\*\)/);
  }],
  ['user note is preserved', () => {
    const plan = planWrongPlaceCorrection({
      savedPlaceId: 'saved', ownerUserId: 'owner', actingUserId: 'owner', currentGooglePlaceId: 'wrong',
      userNote: 'Order brisket', aiNote: 'From source', sourceType: 'instagram', sourceUrl: 'https://example.com/post', ruleVersion: 'v1',
    }, replacement);
    assert.equal(plan.ok && plan.preserved.userNote, 'Order brisket');
  }],
  ['source-linked AI note is preserved', () => {
    assert.match(multiSource, /ai_note = coalesce\(public\.saved_place_sources\.ai_note, excluded\.ai_note\)/);
  }],
  ['Cache V2 invalidation fires through the canonical endpoint', () => {
    assert.match(service, /correct_saved_place_provider_v2/);
    assert.match(migration, /apply_recognition_feedback_v2\(new\.id,old\.place_id,new\.place_id/);
  }],
  ['stale cache answer cannot remain eligible', () => {
    assert.match(migration, /feedback_revision=ss\.feedback_revision\+1/);
    assert.match(migration, /state='QUARANTINED'/);
  }],
  ['multi-place sibling is preserved', () => {
    assert.match(migration, /where id=v_answer\.id/);
    assert.match(migration, /whole_source_quarantined=ss\.whole_source_quarantined or v_scope='\*'/);
  }],
  ['Search again causes no mutation', () => {
    const search = sheet.slice(sheet.indexOf('const runSearch'), sheet.indexOf('useEffect(() =>', sheet.indexOf('const runSearch')));
    assert.match(search, /setSelected\(null\)/);
    assert.doesNotMatch(search, /correctSavedPlace|rejectSavedPlaceRecognition/);
  }],
  ['cancel causes no mutation', () => {
    const close = sheet.slice(sheet.indexOf('const close = useCallback'), sheet.indexOf('return (', sheet.indexOf('const close = useCallback')));
    assert.doesNotMatch(close, /correctSavedPlace|rejectSavedPlaceRecognition/);
  }],
  ["This isn't the place retains explicit rejection semantics", () => {
    assert.match(sheet, /rejectSavedPlaceRecognition\(saved\.id\)/);
    assert.match(sheet, /Mark this result as wrong\?/);
  }],
  ['keyboard does not hide the CTA', () => {
    assert.match(sheet, /KeyboardAvoidingView/);
    assert.match(sheet, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  }],
  ['Dynamic Type can shrink the result list while keeping the CTA exposed', () => {
    assert.match(sheet, /maxHeight: '88%'/);
    assert.match(sheet, /list: \{ marginTop: Spacing\.sm, flexShrink: 1 \}/);
  }],
  ['accessibility exposes result, selected, button, loading, and error states', () => {
    assert.match(sheet, /accessibilityRole="radio"/);
    assert.match(sheet, /checked: isSelected/);
    assert.match(sheet, /candidate\.formattedAddress/);
    assert.match(sheet, /accessibilityLabel=\{saving \? 'Saving correction' : fallbackCorrectionLabel\(chosen\.name\)\}/);
    assert.match(sheet, /accessibilityRole="alert"/);
  }],
];

let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failures) process.exitCode = 1;
else console.log(`PASS all ${cases.length} wrong-place confirmation cases`);
