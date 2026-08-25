import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const detail = readFileSync(join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
const multiCard = readFileSync(join(process.cwd(), 'components/MultiPlaceCandidateCard.tsx'), 'utf8');
const finalizer = readFileSync(join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');

assert.match(finalizer, /buildShareJobCandidatePayload/);
assert.match(finalizer, /mentionResults\.map/);
assert.match(detail, /const mentionSlots = detail\.mentionSlots/);
assert.match(detail, /const reviewSlots = useMemo/);
assert.match(detail, /reconcileMultiPlaceBatch/);
assert.match(detail, /data=\{batch\.order\}/);
assert.match(detail, /Vayrin found a few places in this video\./);
assert.match(detail, /Match each moment to the right place\./);
assert.match(multiCard, /Already saved · this video will be attached/);
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
