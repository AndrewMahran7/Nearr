import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const detail = readFileSync(join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
const finalizer = readFileSync(join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');

assert.match(finalizer, /buildShareJobCandidatePayload/);
assert.match(finalizer, /mentionResults\.map/);
assert.match(detail, /mentionSlots\.map/);
assert.match(detail, /multiPlaceTitle\(effectiveMentionSlots\.length \|\| candidates\.length\)/);
assert.match(detail, /Choose which ones you want to save\./);
assert.match(detail, /is featured at/);
assert.match(detail, /I found a few possible locations for this one\./);
assert.match(detail, /Already on your map · View place/);
assert.match(detail, /Search for this place/);
assert.match(detail, /temporary issue/);
assert.match(detail, /selectCandidateWithinMention/);
assert.match(detail, /preselectedCandidateIds/);
assert.match(detail, /selectedUnsavedCandidates/);
assert.match(detail, /Promise\.allSettled/);
assert.match(detail, /removeSuccessfulSelections/);
assert.match(detail, /resolvingRef\.current/);
assert.match(detail, /__DEV__ && isPhase2PreviewId\(jobId\)/);
assert.match(detail, /automaticallyAdjustKeyboardInsets/);
assert.match(detail, /minHeight: 44/);

console.log('PASS Phase 2 grouped UI render contracts');