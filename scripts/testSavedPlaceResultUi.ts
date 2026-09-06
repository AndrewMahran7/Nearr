import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

import {
  buildSavedPlaceResultViewModel,
  savedResultStatusLabel,
  sourceForSavedResult,
} from '../lib/savedPlaceResult';
import type { SavedPlaceWithPlace } from '../types';

const saved = {
  id: 'saved-primary',
  user_id: 'user',
  place_id: 'place-primary',
  radius_value: null,
  radius_unit: null,
  notes: null,
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/reel/current/',
  notifications_enabled: true,
  last_notified_at: null,
  notification_count: 0,
  reminder_opportunity_count: 0,
  archived_at: null,
  visited_at: null,
  reminders_exhausted_at: null,
  created_at: '2026-09-06T00:00:00Z',
  updated_at: '2026-09-06T00:00:00Z',
  place: {
    id: 'place-primary',
    google_place_id: 'google-primary',
    name: 'Río Secreto & Ancient Forest Overlook With A Very Long Name',
    formatted_address: '100 River Road, Nanaimo, BC, Canada',
    short_formatted_address: 'Nanaimo, BC, Canada',
    latitude: 49.16,
    longitude: -123.94,
    category: 'outdoors',
    google_maps_url: null,
    created_at: '2026-09-06T00:00:00Z',
  },
  sources: [
    {
      id: 'older-source', saved_place_id: 'saved-primary', user_id: 'user',
      identity_key: 'older', identity_version: 1, platform: 'tiktok', content_id: 'older',
      canonical_url: 'https://www.tiktok.com/@someone/video/1', original_url: null,
      creator_handle: null, creator_name: null, caption_excerpt: null, ai_note: null,
      thumbnail_url: 'https://images.example/older.jpg', is_primary: true,
      first_attached_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-01T00:00:00Z',
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    },
    {
      id: 'current-source', saved_place_id: 'saved-primary', user_id: 'user',
      identity_key: 'current', identity_version: 1, platform: 'instagram', content_id: 'current',
      canonical_url: 'https://www.instagram.com/reel/current/', original_url: null,
      creator_handle: null, creator_name: null, caption_excerpt: null, ai_note: null,
      thumbnail_url: 'https://images.example/current.jpg', is_primary: false,
      first_attached_at: '2026-09-06T00:00:00Z', last_seen_at: '2026-09-06T00:00:00Z',
      created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:00Z',
    },
  ],
} satisfies SavedPlaceWithPlace;

assert.equal(savedResultStatusLabel({ status: 'completed', savedPlaceId: saved.id, primaryOrigin: 'automatic' }), 'Saved automatically');
assert.equal(savedResultStatusLabel({ status: 'completed', savedPlaceId: saved.id, primaryOrigin: 'user_confirmed', decision: 'auto_save' }), 'Saved');
assert.equal(savedResultStatusLabel({ status: 'needs_help', savedPlaceId: saved.id, primaryOrigin: 'automatic' }), null, 'candidate/review state cannot claim saved success');
assert.equal(savedResultStatusLabel({ status: 'completed', savedPlaceId: null, primaryOrigin: 'automatic' }), null, 'completed without a durable saved id cannot claim success');
assert.equal(sourceForSavedResult(saved.sources, saved.source_url)?.id, 'current-source', 'media binds to this job source instead of the place primary source');

const primary = buildSavedPlaceResultViewModel({
  status: 'completed',
  savedPlaceId: saved.id,
  decision: 'auto_save',
  primaryOrigin: 'automatic',
  saved,
  candidate: { googlePlaceId: 'wrong-candidate-id', name: 'Stale candidate', sourceFrameUrl: 'https://images.example/frame.jpg' },
  sourcePlatform: 'instagram',
  sourceUrl: saved.source_url,
});
assert.ok(primary);
assert.equal(primary.name, saved.place.name, 'authoritative saved identity wins over stale candidate copy');
assert.equal(primary.googlePlaceId, saved.place.google_place_id);
assert.equal(primary.location, saved.place.short_formatted_address);
assert.equal(primary.sourceCopy, 'Saved from Instagram');
assert.equal(primary.sourceThumbnailUrl, 'https://images.example/current.jpg');
assert.equal(buildSavedPlaceResultViewModel({
  status: 'needs_help', savedPlaceId: null, decision: 'candidate_confirmation', primaryOrigin: null,
  saved: null, candidate: { name: 'Candidate only' }, sourcePlatform: null, sourceUrl: null,
}), null, 'candidate-only results never build the saved screen');

// Render the actual runtime component with minimal host mocks. This verifies
// conditional structure and event wiring without requiring a simulator.
const Module = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = Module._load;
const host = (name: string) => name;
const Pressable = ({ children, ...props }: any) => React.createElement('Pressable', props, typeof children === 'function' ? children({ pressed: false }) : children);
const FlatList = ({ data, renderItem, ItemSeparatorComponent, ...props }: any) => React.createElement(
  'FlatList',
  props,
  data.flatMap((item: any, index: number) => [
    React.createElement(React.Fragment, { key: item.resultId ?? index }, renderItem({ item, index })),
    index < data.length - 1 && ItemSeparatorComponent ? React.createElement(ItemSeparatorComponent, { key: `separator-${index}` }) : null,
  ]),
);
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'), FlatList, Pressable,
    ScrollView: host('ScrollView'), Text: host('Text'), View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  if (request === '@expo/vector-icons') return { Feather: host('Feather'), Ionicons: host('Ionicons') };
  if (request === '@/components/Button') return {
    Button: (props: any) => React.createElement('Button', props, props.title),
  };
  if (request === '@/components/PlaceImage') return {
    PlaceImage: (props: any) => React.createElement('PlaceImage', props),
  };
  if (request === '@/constants') return {
    Radius: { md: 12, lg: 18, pill: 999 },
    Spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28 },
  };
  if (request === '@/lib/sharePhase1Ui') return {
    splitPlaceAddress: (value: string | null | undefined) => ({ locality: value ? value.split(',').slice(-3).join(',').trim() : null }),
  };
  if (request === '@/lib/theme') return {
    useTheme: () => ({
      colors: {
        accent: '#ff6a1a', accentBorder: '#663311', accentSoft: '#22150c', bg: '#080808',
        border: '#333', primary: '#ff6a1a', surface: '#151515', surfaceElevated: '#202020',
        text: '#fff', textMuted: '#999', textSecondary: '#bbb',
      },
      typography: { body: {}, bodyStrong: {}, caption: {}, heading: {} },
    }),
  };
  return originalLoad(request, parent, isMain);
};

const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { SavedPlaceResult } = require('../components/SavedPlaceResult.tsx') as typeof import('../components/SavedPlaceResult');

const alternative = (id: string) => ({
  resultId: id,
  shareJobId: 'job',
  rank: id === 'alternative-2' ? 2 as const : 3 as const,
  savedPlaceId: null,
  candidate: {
    googlePlaceId: `google-${id}`,
    name: `Alternative ${id}`,
    formattedAddress: 'Parksville, BC, Canada',
    latitude: 49,
    longitude: -124,
    types: [],
    matchScore: null,
    aiNote: null,
    photoUrl: null,
    photoUrls: [],
    sourceFrameUrl: null,
    sourceTimestamps: [],
  },
});

function render(alternatives: any[] = [], pendingByResultId: Record<string, any> = {}) {
  const calls: string[] = [];
  const renderer = TestRenderer.create(React.createElement(SavedPlaceResult, {
    primary: primary!, sourceAvailable: true, alternatives, pendingByResultId,
    onWatchPost: () => calls.push('watch'), onWrongPlace: () => calls.push('wrong'),
    onAlternativeAction: (item: any, action: string) => calls.push(`${item.resultId}:${action}`),
    onViewOnMap: () => calls.push('map'),
  }));
  return { renderer, root: renderer.root, calls };
}

{
  const { root, calls } = render();
  assert.ok(root.findByProps({ testID: 'saved-place-primary-card' }));
  assert.equal(root.findAllByProps({ testID: 'soft-alternatives-review' }).length, 0, 'zero alternatives omit the section');
  assert.equal(root.findAllByProps({ accessibilityLabel: 'Similar result 1 of 1' }).length, 0, 'zero alternatives have no pagination');
  root.findByProps({ accessibilityLabel: 'Watch original Instagram post' }).props.onPress();
  root.findByProps({ accessibilityLabel: `Report that ${saved.place.name} is the wrong place` }).props.onPress();
  root.findByProps({ accessibilityLabel: `View ${saved.place.name} on map` }).props.onPress();
  assert.deepEqual(calls, ['watch', 'wrong', 'map'], 'primary actions are wired to the route handlers');
}

{
  const one = alternative('alternative-2');
  const { root, calls } = render([one]);
  assert.ok(root.findByProps({ testID: 'soft-alternatives-review' }));
  assert.equal(root.findAllByProps({ accessibilityLabel: 'Similar result 1 of 1' }).length, 0, 'one alternative has no meaningless dot');
  root.findByProps({ accessibilityLabel: `Save ${one.candidate.name} too` }).props.onPress();
  root.findByProps({ accessibilityLabel: `Use ${one.candidate.name} instead` }).props.onPress();
  root.findByProps({ accessibilityLabel: `Remove ${one.candidate.name} suggestion` }).props.onPress();
  assert.deepEqual(calls, ['alternative-2:keep', 'alternative-2:promote', 'alternative-2:remove']);
}

{
  const items = [alternative('alternative-2'), alternative('alternative-3')];
  const { root } = render(items, { 'alternative-2': 'keep' });
  assert.ok(root.findByProps({ accessibilityLabel: 'Similar result 1 of 2' }), 'multiple alternatives render actual-count pagination');
  assert.equal(root.findByProps({ accessibilityLabel: `Save ${items[0].candidate.name} too` }).props.accessibilityState.busy, true);
  assert.equal(root.findByProps({ accessibilityLabel: `Save ${items[1].candidate.name} too` }).props.accessibilityState.disabled, false, 'pending state is per item');
}

{
  const kept = { ...alternative('alternative-2'), savedPlaceId: 'saved-alternative' };
  const { root } = render([kept]);
  assert.ok(root.findByProps({ accessibilityLabel: `${kept.candidate.name} is saved` }), 'durably kept alternatives rehydrate as Saved');
  assert.equal(root.findAllByProps({ accessibilityLabel: `Remove ${kept.candidate.name} suggestion` }).length, 0, 'a kept map place is not exposed as suggestion removal');
}

const routeSource = readFileSync(join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
assert.match(routeSource, /if \(detail\.kind === 'completed'\)[\s\S]*?<ShareJobsHeader title="Saved place"/);
const completedBranch = routeSource.slice(routeSource.indexOf("if (detail.kind === 'completed')"), routeSource.indexOf("if (detail.kind === 'dismissed')"));
assert.doesNotMatch(completedBranch, /<VayrinPresentationHeader|title="Not it"|Place found|Keep \/ Save|Make primary/);
assert.match(completedBranch, /savedPlaceId: resultModel\.savedPlaceId[\s\S]*source: 'share_job_completed'/, 'map action follows the current rendered primary');
assert.match(completedBranch, /openOriginalPost\(\)/, 'Watch post reuses the validated source opener');
assert.match(completedBranch, /<WrongPlaceSheet/, 'Wrong place reuses the established correction sheet');
const alternativeHandler = routeSource.slice(routeSource.indexOf('const actOnSoftAlternative'), routeSource.indexOf('useEffect(() => {\n    void load()', routeSource.indexOf('const actOnSoftAlternative')));
assert.match(alternativeHandler, /promoteShareJobSoftAlternative\(alternative\.resultId, action === 'promote'\)/, 'Save too maps to the existing non-primary RPC mode');
assert.doesNotMatch(alternativeHandler, /rejectSavedPlaceRecognition|invalidateRecognition|user_rejected_recognition/, 'Save too cannot emit identity feedback or cache invalidation');

console.log('PASS saved-place result view model, rendered hierarchy, actions, carousel, and route wiring');
