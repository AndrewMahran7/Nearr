import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { LightPalette, DarkPalette } from '../constants/colors';
import { Radius, Spacing } from '../constants/spacing';
import * as policy from '../lib/vayrinCandidateConfirmation';
import { reconcileMultiPlaceBatch, toggleBatchRow, clearAllEligibleBatchRows, selectAllEligibleBatchRows, selectedBatchTargets } from '../lib/multiPlaceBatch';
import { buildVayrinCandidateFixtureJob } from '../lib/vayrinCandidateFixtures';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';

const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
let palette = LightPalette, width = 390, fontScale = 1;
const Pressable = ({ children, style, ...props }: any) => React.createElement('Pressable', { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style }, children);
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return { Pressable, Text: 'Text', View: 'View', useWindowDimensions: () => ({ width, height: 844, fontScale }), StyleSheet: { create: (s: any) => s, hairlineWidth: 1 } };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === '@/components/CandidatePhotoCarousel') return { CandidatePhotoCarousel: 'CandidatePhotoCarousel' };
  if (request === '@/constants') return { Radius, Spacing };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: palette, typography: { heading: { fontSize: 23 }, bodyStrong: { fontSize: 17 } } }) };
  if (request === '@/lib/vayrinCandidateConfirmation') return policy;
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { CandidateConfirmationCard } = require('../components/CandidateConfirmationCard.tsx') as typeof import('../components/CandidateConfirmationCard');
const textOf = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(' ');
const flatten = (style: any): any => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
let rendered = 0;
try {
  for (const mode of [LightPalette, DarkPalette]) for (const device of [{ width: 320, fontScale: 1 }, { width: 390, fontScale: 1 }, { width: 430, fontScale: 1.3 }, { width: 375, fontScale: 2 }]) for (const photos of [0, 1, 5]) {
    palette = mode; width = device.width; fontScale = device.fontScale;
    const longName = 'A very long coastal botanical garden, lookout and historic trail destination';
    const candidate = { googlePlaceId: 'place', name: longName, formattedAddress: 'A long real address, coastal district, California, United States', types: ['park'], photoUrls: Array.from({ length: photos }, (_, index) => `https://test.invalid/photo-${index}`), matchStrength: 'high' as const };
    let selections = 0;
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => { tree = TestRenderer.create(React.createElement(CandidateConfirmationCard, { candidate, locality: candidate.formattedAddress, compact: true, selectable: true, selected: false, selectionRole: 'checkbox', onPress: () => selections++, presentationActive: true })); });
    assert.match(textOf(tree.toJSON()), /Possible match/);
    assert.doesNotMatch(textOf(tree.toJSON()), /High match|Best match|confidence|%/);
    const title = tree.root.findAllByType('Text' as any).find(node => node.children.includes(longName))!;
    assert.ok(title); assert.equal(title.props.numberOfLines, undefined, 'critical names grow instead of truncating');
    assert.equal(flatten(title.props.style).color, palette.text, 'real component uses appearance text token');
    const choice = tree.root.findByProps({ testID: 'candidate-selection-control' });
    assert.equal(choice.props.accessibilityRole, 'checkbox');
    assert.deepEqual(choice.props.accessibilityState, { checked: false });
    TestRenderer.act(() => choice.props.onPress()); assert.equal(selections, 1);
    const photo = tree.root.findByType('CandidatePhotoCarousel' as any);
    assert.equal(photo.props.onPress, undefined, 'image does not share the select callback');
    let ancestor = photo.parent;
    while (ancestor) { assert.notEqual(ancestor.type, Pressable, 'gallery never nests inside the selection responder'); ancestor = ancestor.parent; }
    assert.equal(photo.props.initialPhotoUrls?.length ?? 0, photos);
    assert.equal(photo.props.active, true);
    assert.equal(photo.props.variant, width < 360 || fontScale > 1.25 ? 'carousel' : 'thumbnail');
    const selectStyle = flatten(tree.root.findAllByType('Pressable' as any).find(node => node.props.testID === 'candidate-selection-control')!.props.style);
    assert.ok(selectStyle.width >= 44 && selectStyle.height >= 44);
    TestRenderer.act(() => tree.unmount()); rendered++;
  }
  const broad = { googlePlaceId: 'area', name: 'Hydra', types: ['locality'], formattedAddress: 'Greece' };
  const tree = TestRenderer.create(React.createElement(CandidateConfirmationCard, { candidate: broad }));
  assert.match(textOf(tree.toJSON()), /AREA MATCH/); assert.match(textOf(tree.toJSON()), /narrowed to this area/);
  assert.match(textOf(tree.toJSON()), /Check the name and location before saving/); tree.unmount();
} finally { Module._load = originalLoad; }

// Actual batch policy still differentiates an omitted selection from a rejection.
const detail = buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-multi-three-resolved'));
let batch = reconcileMultiPlaceBatch({ jobId: 'review', slots: detail.mentionSlots });
const first = batch.order[0]!;
batch = toggleBatchRow(batch, first);
assert.equal(batch.rows[first]!.userDismissed, false);
batch = clearAllEligibleBatchRows(batch); assert.equal(selectedBatchTargets(batch).length, 0);
batch = selectAllEligibleBatchRows(batch); assert.equal(selectedBatchTargets(batch).length, 3);

const read = (p: string) => readFileSync(p, 'utf8');
const route = read('app/share-jobs/[jobId].tsx');
const activity = read('app/share-jobs/index.tsx');
const photos = read('components/CandidatePhotoCarousel.tsx');
assert.match(route, /testID="mention-save-checkbox"/);
assert.match(route, /onPress=\{\(\) => toggleBatchSelection\(row\)\}/);
assert.match(route, /onPress=\{\(\) => toggleMentionDisclosure\(row\.logicalPlaceId\)\}/);
assert.match(route, /selectedPendingCount === 0 \? 'Select a place to save'/);
assert.match(route, /disabled=\{selectedPendingCount === 0 \|\| busy\}/);
assert.match(route, /batch\.rows\[id\]\?\.persistence === 'pending'/);
assert.match(route, /if \(!reduceMotion\) LayoutAnimation\.configureNext/);
assert.match(photos, /Destination photo/); assert.match(photos, /From your video/);
assert.match(photos, /prefetchAdjacent=\{false\}/); assert.match(photos, /visitedPhotoIndexes\.has\(index\)/);
assert.match(activity, /<FlatList data=\{activityItems\}/);
assert.match(activity, /initialNumToRender=\{8\} maxToRenderPerBatch=\{6\}/);
assert.ok(activity.indexOf("title: 'Needs your check'") < activity.indexOf("title: 'Finding places'"));
assert.ok(activity.indexOf("title: 'Finding places'") < activity.indexOf("title: 'On your map'"));
assert.match(activity, /You're all caught up/);
console.log(`PASS Fieldnotes review: ${rendered} actual component renders across 2 appearances, 4 width/text configurations and 0/1/5 photos; independent controls, provenance, omission, disabled save, motion and virtualized Activity`);
