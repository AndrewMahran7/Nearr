import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sync = read('app/share.tsx');
const asyncDetail = read('app/share-jobs/[jobId].tsx');
const queue = read('app/share-jobs/index.tsx');
const handoff = read('components/ShareJobHandoff.tsx');
const header = read('components/VayrinPresentationHeader.tsx');
const correction = read('components/map/WrongPlaceSheet.tsx');
const ordinaryDetail = read('components/map/SelectedPlaceDetails.tsx');

for (const [name, source] of [['sync share', sync], ['async detail', asyncDetail], ['queue', queue], ['handoff', handoff]] as const) {
  assert.match(source, /isVayrinProductUiEnabled/, `${name} is gated`);
}

assert.match(sync, /mapSyncShareToVayrinPresentation/, 'sync outcomes use the shared mapper');
assert.match(asyncDetail, /mapShareJobToVayrinPresentation/, 'durable outcomes use the shared mapper');
assert.match(correction, /buildVayrinPresentation/, 'Vayrin correction copy uses the shared mapper');
assert.match(asyncDetail, /normalizeVayrinIdentityLeads|vayrinPresentation\.leads/, 'durable UI keeps non-Places leads');
assert.match(asyncDetail, /Not verified yet/, 'lead cards do not claim verification');
assert.match(asyncDetail, /selectAllEligibleBatchRows/, 'Multi-Select owns safe Save all semantics');
assert.match(asyncDetail, /title="Not it"/, 'strong result correction uses canonical action');
assert.match(sync, /'Not it'/, 'sync correction uses canonical action');

assert.match(header, /accessibilityRole="summary"/);
assert.match(header, /accessibilityLiveRegion=/);
assert.match(asyncDetail, /accessibilityRole="checkbox"/, 'multi selection stays accessible');
assert.match(asyncDetail, /accessibilityState=\{\{ checked:/, 'radio and checkbox selection expose state');

assert.match(correction, /finderMode\?: boolean/, 'Vayrin correction is explicitly scoped');
assert.match(correction, /finderMode = false/, 'ordinary correction defaults to Nearr-only');
assert.doesNotMatch(ordinaryDetail, /VAYRIN|Vayrin/, 'Vayrin does not leak into ordinary saved-place detail');
assert.doesNotMatch(correction, /Let's find the right place\./, 'correction does not duplicate first-person Vayrin copy');
assert.doesNotMatch(
  asyncDetail,
  /We couldn't (?:check right now|open this one just now)/,
  'shared Vayrin states use neutral failure copy',
);

// No generated/proxy mascot asset is introduced while the canonical asset set
// is absent. The presentation remains text-first and themed in both modes.
assert.doesNotMatch(header, /Image|Svg|require\(/);
assert.match(header, /useTheme/);
assert.match(header, /#FF6A1A/, 'canonical orange is the only fixed brand accent');
for (const [name, source] of [
  ['sync share', sync],
  ['async detail', asyncDetail],
  ['queue', queue],
  ['handoff', handoff],
  ['correction', correction],
] as const) {
  assert.doesNotMatch(
    source,
    /hasVisibleVayrinArt\s*:\s*true/,
    `${name} cannot opt into first-person copy before canonical art is rendered`,
  );
}

console.log('PASS Vayrin feature gate, UI wiring, boundaries, and accessibility contracts');
