import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { LightPalette, DarkPalette } from '../constants/colors';
import { Spacing } from '../constants/spacing';
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
let colors = LightPalette, reduced = false;
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 } };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === '@/constants') return { Spacing };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors, typography: { title: { fontSize: 30 }, heading: { fontSize: 23 } } }) };
  if (request === '@/lib/useReduceMotion') return { useReduceMotion: () => reduced };
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { ShareJobLoadingState } = require('../components/ShareJobLoadingState') as typeof import('../components/ShareJobLoadingState');
const { ShareJobsHeader } = require('../components/ShareJobsHeader') as typeof import('../components/ShareJobsHeader');
const flatten = (style: any) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
try {
  for (const palette of [LightPalette, DarkPalette]) for (const reduce of [false, true]) {
    colors = palette; reduced = reduce;
    const loading = TestRenderer.create(React.createElement(ShareJobLoadingState));
    const intro = loading.root.findByProps({ testID: 'share-job-loading-intro' });
    const style = flatten(intro.props.style);
    assert.equal(style.flex, undefined, 'loading is content-sized, not a full-height centered state');
    assert.notEqual(style.justifyContent, 'center');
    assert.ok(style.paddingHorizontal >= 16);
    const title = loading.root.findByProps({ accessibilityRole: 'header' });
    assert.equal(flatten(title.props.style).color, palette.text);
    assert.equal(title.props.numberOfLines, undefined);
    const indicators = loading.root.findAllByType('ActivityIndicator' as any);
    assert.equal(indicators.length, reduced ? 0 : 1);
    if (!reduced) assert.equal(indicators[0]!.props.size, 'small');
    assert.equal(loading.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityLabel, 'Loading this find');
    loading.unmount();

    let backs = 0;
    const header = TestRenderer.create(React.createElement(ShareJobsHeader, { title: 'Quick Check', onBack: () => backs++, refreshing: true, reduceMotion: reduced }));
    const status = header.root.findByProps({ accessibilityRole: 'progressbar' });
    assert.equal(status.props.accessibilityLabel, 'Updating this find');
    assert.deepEqual([status.props.style.width, status.props.style.height], [44, 44]);
    assert.equal(header.root.findAllByType('ActivityIndicator' as any).length, reduced ? 0 : 1);
    header.root.findByProps({ accessibilityLabel: 'Back' }).props.onPress();
    assert.equal(backs, 1, 'refresh progress does not block navigation');
    header.update(React.createElement(ShareJobsHeader, { title: 'Quick Check', onBack: () => backs++, refreshing: false, reduceMotion: reduced }));
    assert.equal(header.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0);
    const spacer = header.root.findAllByType('View' as any).find(node => node.props.style?.width === 44 && node.props.style?.height === 44)!;
    assert.ok(spacer, 'idle and refreshing headers retain the same trailing slot');
    header.unmount();
  }
} finally { Module._load = originalLoad; }
const route = readFileSync('app/share-jobs/[jobId].tsx', 'utf8');
assert.match(route, /if \(loading && !job\)/, 'existing job content is retained during refresh');
const initial = route.slice(route.indexOf('if (loading && !job)'), route.indexOf('// Only a row that truly disappeared'));
assert.match(initial, /<ShareJobLoadingState/);
assert.doesNotMatch(initial, /styles\.centered|<ActivityIndicator/);
assert.match(route, /refreshing=\{refreshing && !!job\}/);
assert.match(route, /setRefreshing\(pendingLoadsRef\.current > 0\)/, 'overlapping existing requests retain progress until all settle');
assert.match(route, /setLoadFailure\(j \? null : 'not_found'\)/);
assert.match(route, /isRetryableLoadFailure\(loadFailure\)/);
assert.match(route, /setInterval\(\(\) => void load\(\), 4000\)/, 'poll cadence is unchanged');
console.log('PASS Quick Check loading: actual light/dark and reduced-motion renders, compact top hierarchy, stable inline refresh slot, retained job content, back/retry and unchanged polling');
