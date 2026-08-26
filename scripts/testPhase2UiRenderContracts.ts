import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const detail = readFileSync(join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
const confirmationCard = readFileSync(join(process.cwd(), 'components/CandidateConfirmationCard.tsx'), 'utf8');
const multiReview = readFileSync(join(process.cwd(), 'lib/vayrinMultiPlaceReview.ts'), 'utf8');
const finalizer = readFileSync(join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');

assert.match(finalizer, /buildShareJobCandidatePayload/);
assert.match(finalizer, /mentionResults\.map/);
assert.match(detail, /const mentionSlots = detail\.mentionSlots/);
assert.match(detail, /const reviewSlots = useMemo/);
assert.match(detail, /reconcileMultiPlaceBatch/);
assert.match(detail, /data=\{batch\.order\}/);
assert.match(detail, /\{batch\.order\.length\} places found/);
assert.match(detail, /Open one place at a time to review its matches\./);
assert.match(confirmationCard, /Already on your map/);
assert.match(multiReview, /Already saved · source attached/);
assert.match(detail, /Search for this place/);
assert.match(detail, /visibleMentionCandidates/);
assert.match(detail, /selectedBatchTargets/);
assert.match(detail, /Promise\.allSettled/);
assert.match(detail, /applyBatchSaveOutcomes/);
assert.match(detail, /resolvingRef\.current/);
assert.match(detail, /__DEV__ && isPhase2PreviewId\(id\)/);
assert.match(detail, /automaticallyAdjustKeyboardInsets/);
assert.match(detail, /minHeight: 44/);

console.log('PASS Phase 2 grouped UI render contracts');
