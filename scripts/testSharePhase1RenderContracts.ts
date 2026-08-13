import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const extension = read('ShareExtension.tsx');
const queue = read('app/share-jobs/index.tsx');
const detail = read('app/share-jobs/[jobId].tsx');
const error = read('app/_layout.tsx');
const mapEntry = read('components/map/ShareQueueButton.tsx');
const placeImage = read('components/PlaceImage.tsx');
const shareJobsSheet = read('components/ShareJobsSheet.tsx');

assert.doesNotMatch(extension, /height: '100%'/);
assert.match(extension, /backgroundColor: NEARR_SURFACE/);
assert.match(extension, /completionView\(\{ kind: 'accepted'/);
assert.match(extension, /<Text style={asyncStyles\.primaryText}>\{view\.primary\}<\/Text>/);
assert.match(extension, /<Text style={asyncStyles\.secondaryText}>\{view\.secondary\}<\/Text>/);
assert.doesNotMatch(extension, /SharedPreview|previewImage/);
assert.match(extension, /completionActionsRef\.current\?\.openNearr\(SHARE_JOBS_DEEPLINK_PATH\)/);
assert.match(extension, /createCompletionActions/, 'Done and Open Nearr are once-latched');
assert.match(extension, /<AsyncSurface onClose=\{finish\} showClose=\{false\}>/);

assert.match(queue, /title="Your queue"/);
assert.equal((queue.match(/queueIntro\(count\)/g) ?? []).length, 1, 'queue count appears once');
assert.match(queue, /splitPlaceAddress/);
assert.match(queue, /Needs you/);
assert.match(queue, /Working/);
assert.match(queue, /QUEUE_EMPTY_COPY\.title/);
assert.match(queue, /numberOfLines=\{2\}[\s\S]*?jobTitle/);
assert.match(queue, /<PlaceImage/);
assert.match(queue, /size=\{hasContent \? 'queue' : 'compact'\}/);
assert.match(queue, /Recently completed/);
assert.match(queue, /Clear completed/);
assert.match(queue, /icon="close"/);

assert.match(detail, /PHASE_1_COPY\.suggestedHeading/);
assert.match(detail, /PHASE_1_COPY\.alreadySavedHeading/);
assert.match(detail, /PHASE_1_COPY\.viewOnMap/);
assert.match(detail, /useState\(false\)/, 'alternative search starts collapsed');
assert.match(detail, /PHASE_1_COPY\.alternativeAction/);
assert.match(detail, /LayoutAnimation\.Presets\.easeInEaseOut/);
assert.match(detail, /automaticallyAdjustKeyboardInsets/);
assert.match(detail, /View original post/);
assert.match(detail, /PHASE_1_COPY\.removeMessage/);
assert.match(detail, /numberOfLines=\{2\}[\s\S]*?single\?\.name/);
assert.match(detail, /<PlaceImage/);
assert.match(detail, /<ShareJobsSheet onDismiss=\{backToQueue\} size="detail">/);
const completedBranch = detail.slice(detail.indexOf("detailMode === 'completed'"), detail.indexOf("detailMode === 'dismissed'"));
assert.doesNotMatch(completedBranch, /renderJobFooter|Remove this save/, 'terminal saved state has no removal action');

assert.match(error, /Nearr hit a snag/);
assert.match(error, /Your saved places are safe/);
assert.match(error, /Diagnostic copied/);
assert.match(error, /Copy diagnostic/);
assert.match(mapEntry, /needsHelp > 0 \?/);
assert.match(mapEntry, /minHeight: 44/);
assert.match(error, /presentation: 'transparentModal'/);
assert.match(error, /contentStyle: \{ backgroundColor: 'transparent' \}/);
assert.match(placeImage, /getCachedPlaceRichDetails/);
assert.match(placeImage, /selectPlaceImageUri/);
assert.match(placeImage, /accessibilityLabel/);
assert.match(shareJobsSheet, /dragIndicator/);
assert.match(shareJobsSheet, /height: '46%'/);
assert.match(shareJobsSheet, /height: '76%'/);
assert.match(shareJobsSheet, /height: '92%'/);

console.log('PASS Phase 1 render contracts');
