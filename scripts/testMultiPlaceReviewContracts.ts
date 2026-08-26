import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const detail = read('app/share-jobs/[jobId].tsx');
const resultContract = read('lib/shareJobResult.ts');
const finalizer = read('supabase/functions/process-share-jobs/index.ts');

assert.match(detail, /reconcileMultiPlaceBatch/, 'Realtime data reconciles into one keyed batch');
assert.match(detail, /data=\{batch\.order\}/, 'mentions render through one virtualized list');
assert.match(detail, /keyExtractor=\{\(id\) => id\}/, 'array index is never the row key');
assert.match(detail, /Place \$\{index \+ 1\} of \$\{total\}/, 'row position is announced');
assert.match(detail, /CandidateConfirmationCard/, 'expanded mentions reuse the shared compact candidate row');
assert.match(detail, /expandedMentionId/, 'one scalar owns progressive disclosure');
assert.match(detail, /accessibilityState=\{\{ expanded \}\}/, 'mention summaries announce disclosure state');
assert.match(detail, /visibleMentionCandidates\(row\)/, 'candidate presentation is capped without truncating the model');
assert.match(detail, /SourceEvidenceGallery/);
assert.match(detail, /batchCounts\.total > 0/, 'zero selection hides the dominant footer');
assert.match(detail, /styles\.batchFooter/, 'final batch action is sticky outside row cards');
assert.doesNotMatch(detail, /batch\.order\.slice\(/, 'UI does not slice logical rows to five');
assert.doesNotMatch(detail, /Choose the right place/, 'candidate accordions are removed');
assert.match(detail, /None of these/);
assert.match(detail, /Search another place/);
assert.match(detail, /void runBatchSearch\(row\.logicalPlaceId/, 'opening unmatched search runs its prefilled query');

const batchSearchStart = detail.indexOf('function renderBatchSearch');
const batchSearchEnd = detail.indexOf('function renderBatchRow');
assert.ok(batchSearchStart >= 0 && batchSearchEnd > batchSearchStart);
const batchSearch = detail.slice(batchSearchStart, batchSearchEnd);
assert.doesNotMatch(batchSearch, /persistCandidate|handleSaveManual|Save place/, 'inline search only returns a candidate to its row');
assert.match(batchSearch, /renderBatchCandidateChoice/, 'search results use the row candidate chooser');

const batchChoiceStart = detail.indexOf('function renderBatchCandidateChoice');
const batchChoiceEnd = detail.indexOf('function renderBatchSearch');
assert.ok(batchChoiceStart >= 0 && batchChoiceEnd > batchChoiceStart);
assert.match(
  detail.slice(batchChoiceStart, batchChoiceEnd),
  /selectBatchCandidate/,
  'search result selection merges into the row',
);

assert.match(resultContract, /saveState\?: 'pending' \| 'auto_saved' \| 'already_saved'/);
assert.match(resultContract, /savedPlaceId\?: string \| null/);
assert.match(finalizer, /mentionResults\.map/, 'mixed review payload retains auto-saved and unresolved logical rows');
assert.match(finalizer, /savedResultByMentionId/, 'auto-saved logical rows retain saved ids');

console.log('PASS multi-place review UI, accessibility, sticky-save, and persisted-result contracts');
