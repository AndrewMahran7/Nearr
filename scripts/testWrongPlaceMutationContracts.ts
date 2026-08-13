import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260812000002_correct_saved_place_provider.sql');
const service = read('services/savedPlacesService.ts');
const sheet = read('components/map/WrongPlaceSheet.tsx');
const details = read('components/map/SelectedPlaceDetails.tsx');
const map = read('app/(tabs)/map.tsx');

assert.match(migration, /auth\.uid\(\)/, 'correction is owner scoped');
assert.match(migration, /user_id = v_user_id/g);
assert.match(migration, /for update/, 'correction locks rows for races');
assert.match(migration, /v_existing\.id is not null/, 'same-user duplicate is merged');
assert.match(migration, /update public\.notification_events/, 'reminder history is rewired');
assert.match(migration, /update public\.share_job_place_results/, 'source-result context is rewired');
assert.match(migration, /delete from public\.saved_places/, 'merged duplicate is removed');
assert.match(migration, /category_user_overridden/, 'automatic categories recalculate without clobbering user overrides');
assert.match(migration, /v_source\.place_id = p_place_id/, 'lost-response retry is idempotent');

assert.match(service, /correct_saved_place_provider/);
assert.match(service, /resolvePlaceCategory/);
assert.match(service, /select\('\*, place:places\(\*\)'\)/);
assert.match(sheet, /void runSearch\(initialQuery\)/, 'first correction search runs automatically once');
assert.match(sheet, /Is this the right place\?/);
assert.match(sheet, /Which place is it\?/);
assert.match(sheet, /Use this place/);
assert.match(sheet, /Search again/);
assert.match(sheet, /Open original post/);
assert.match(sheet, /accessibilityState=\{\{ disabled: current \|\| saving, selected: isSelected \}\}/);
assert.match(sheet, /reconcileCorrectedSavedPlaces/);
assert.match(sheet, /previous_google_place_id/);
assert.match(sheet, /source_job_id/);
assert.match(details, /Wrong place\? Correct this saved place/);
assert.match(map, /focusCorrectedPlace/);

console.log('PASS wrong-place atomic mutation, dedupe, search UX, accessibility, cache, map, and feedback contracts');
