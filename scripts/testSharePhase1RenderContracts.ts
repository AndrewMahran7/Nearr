import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './testFieldnotesReviewComponents';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const extension = read('ShareExtension.tsx');
const queue = read('app/share-jobs/index.tsx');
const detail = read('app/share-jobs/[jobId].tsx');
const error = read('app/_layout.tsx');
const mapEntry = read('components/map/ShareQueueButton.tsx');
const placeImage = read('components/PlaceImage.tsx');
const savedPlaceResult = read('components/SavedPlaceResult.tsx');
const candidateConfirmationCard = read('components/CandidateConfirmationCard.tsx');
const shareJobsSheet = read('components/ShareJobsSheet.tsx');

assert.doesNotMatch(extension, /height: '100%'/);
assert.match(extension, /backgroundColor: 'transparent'/);
assert.match(extension, /completionView\(\{ kind: 'accepted'/);
assert.match(extension, /<Text style={asyncStyles\.primaryText}>\{view\.primary\}<\/Text>/);
assert.match(extension, /<Text style={asyncStyles\.secondaryText}>\{view\.secondary\}<\/Text>/);
assert.doesNotMatch(extension, /SharedPreview|previewImage/);
assert.match(extension, /completionActionsRef\.current\?\.openNearr\(SHARE_JOBS_DEEPLINK_PATH\)/);
assert.match(extension, /createCompletionActions/, 'Done and Open Nearr are once-latched');
assert.match(extension, /<AsyncSurface onClose=\{finish\} showClose=\{false\}>/);

assert.match(queue, /title="Activity"/);
assert.equal((queue.match(/>Finding your places<\/Text>/g) ?? []).length, 1, 'the editorial heading appears once');
assert.match(queue, /splitPlaceAddress/);
assert.match(queue, /title: 'Needs your check'/);
assert.match(queue, /title: 'Finding places'/);
assert.match(queue, /You're all caught up/);
assert.match(queue, /numberOfLines=\{2\}[\s\S]*?jobTitle/);
assert.match(queue, /<PlaceImage/);
assert.match(queue, /size=\{hasContent \? 'queue' : 'compact'\}/);
assert.match(queue, /title: 'On your map'/);
assert.match(queue, /Clear completed/);
assert.match(queue, /icon="close"/);

// The quick-check heading/body now come from the pure payload mapping
// (lib/shareJobDetailState); see scripts/testShareJobDetailState.ts.
assert.match(detail, /detail\.copy\.title/);
assert.match(detail, /PHASE_1_COPY\.alreadySavedHeading/);
assert.match(detail, /<SavedPlaceResult/, 'completed jobs use the dedicated saved-result screen');
assert.match(savedPlaceResult, /title="View on map"/, 'saved-result screen keeps the map CTA');
assert.match(detail, /useState\(false\)/, 'alternative search starts collapsed');
assert.match(detail, /title=\{broadSingle \? 'Not this area' : 'Not this place'\}/);
assert.match(detail, /accessibilityLabel=\{`None of these for \$\{row\.extractedName\}`\}/);
assert.match(detail, /LayoutAnimation\.Presets\.easeInEaseOut/);
assert.match(detail, /automaticallyAdjustKeyboardInsets/);
assert.match(detail, /View original post/);
assert.match(detail, /This post will leave Activity\./);
assert.match(candidateConfirmationCard, /typography\.bodyStrong : typography\.heading, styles\.name\]\}>\{candidate\.name\}/, 'critical candidate names remain content-sized in compact and full views');
assert.match(savedPlaceResult, /<PlaceImage/, 'saved-result hero and alternatives use the shared place image resolver');
assert.match(detail, /<ShareJobsSheet onDismiss=\{backToQueue\} size="detail">/);
const completedBranch = detail.slice(detail.indexOf('// Terminal success'), detail.indexOf('// Terminal dismissed'));
assert.doesNotMatch(completedBranch, /renderJobFooter|Remove this save/, 'terminal saved state has no removal action');

assert.match(error, /Nearr hit a snag/);
assert.match(error, /Your saved places are safe/);
assert.match(error, /Diagnostic copied/);
assert.match(error, /Copy diagnostic/);
assert.match(mapEntry, /const queueCount = useActiveQueueCount\(\)/);
assert.match(mapEntry, /canReachShareQueue/);
assert.match(mapEntry, /queueCount > 0 \?/);
assert.match(mapEntry, /minHeight: 44/);
assert.match(error, /presentation: 'transparentModal'/);
assert.match(error, /contentStyle: \{ backgroundColor: 'transparent' \}/);
assert.match(placeImage, /getCachedPlaceRichDetails/);
assert.match(placeImage, /selectPlaceImageUri/);
assert.match(placeImage, /accessibilityLabel/);
assert.doesNotMatch(shareJobsSheet, /<View style=\{styles\.dragIndicator\}/, 'a sheet without a drag gesture has no fake drag affordance');
assert.match(shareJobsSheet, /height: '46%'/);
assert.match(shareJobsSheet, /height: '92%'/);
assert.match(shareJobsSheet, /fontScale > 1\.25 \|\| height < 700/);
assert.match(shareJobsSheet, /expandedForAccess && styles\.detailSheet/);

console.log('PASS Phase 1 render contracts');
