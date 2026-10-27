import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';
import { OFFLINE_ONBOARDING_FIXTURES } from '../onboarding/fixtures/offlineOnboardingFixtures';

// Real Saved components, native host doubles. These assert behavior/layout
// contracts; they are deliberately not described as screenshots or device QA.
const Module = require('node:module');
const originalLoad = Module._load;
let fontScale = 1;
let hydratedPhotoUris = ['file:///saved-place.jpg'];
let hydratedPhotoKind: 'destination' | 'source' = 'destination';
const hydrationRequests: Array<{ trigger: string }> = [];
const colors = new Proxy({}, { get: (_target, key) => key === 'textInverse' ? '#FFFFFF' : '#263A32' });
const typography = { bodyStrong: {}, body: {}, caption: {}, label: {}, heading: {} };
const Pressable = ({ children, style, ...props }: any) => React.createElement('Pressable', {
  ...props, style: typeof style === 'function' ? style({ pressed: false }) : style,
}, typeof children === 'function' ? children({ pressed: false }) : children);
const FlatList = (props: any) => React.createElement('FlatList', props,
  props.ListHeaderComponent,
  props.data.length ? props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))) : props.ListEmptyComponent,
);
const Button = ({ title, ...props }: any) => React.createElement('Button', props, title);
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === '@/lib/i18n') return require('../lib/i18nEngine');
  if (request === '@/hooks/useLocale') return { useLocale: () => ({ locale: require('../lib/i18nEngine').i18n.language }) };
  if (request === 'react-native') return {
    Image: { resolveAssetSource: (asset: unknown) => asset },
    ActivityIndicator: 'ActivityIndicator', FlatList, Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
    Linking: { openSettings: async () => undefined }, Pressable, ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 375, height: 667, fontScale, scale: 2 }),
  };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors, typography }) };
  if (request === '@/lib/useReduceMotion') return { useReduceMotion: () => false };
  if (request.endsWith('/onboarding/assets/offlineOnboardingAssets')) return { offlineOnboardingMedia: () => ({ placePhotoAssets: [{ uri: 'file:///bundled-destination.jpg' }] }) };
  if (request === '@/lib/savedPlaceHydration') return { hydrateSavedPlace: async (args: { trigger: string }) => {
    hydrationRequests.push(args); return { details: { photoUrls: hydratedPhotoUris }, snapshot: { source: 'save_payload', photoProvenance: Object.fromEntries(hydratedPhotoUris.map((uri) => [uri, hydratedPhotoKind])) } };
  } };
  if (request === './PlaceImage') return { PlaceImage: 'PlaceImage' };
  if (request === '@/components') return { Button, Input: 'Input', SavedPlaceBrowseCard: originalLoad(path.resolve(__dirname, '../components/SavedPlaceBrowseCard.tsx'), parent, isMain).SavedPlaceBrowseCard };
  if (request.startsWith('@/')) return originalLoad(path.resolve(__dirname, '..', request.slice(2)), parent, isMain);
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { SavedPlacesLibrary } = require('../components/map/SavedPlacesLibrary.tsx');
const { SavedPlaceBrowseCard, SavedPlaceBrowseCardView } = require('../components/SavedPlaceBrowseCard.tsx');
const fixture = (index: number) => ({
  id: `saved-${index}`, user_id: 'local-test-user', created_at: new Date(2026, 0, 30 - index).toISOString(),
  notes: index === 0 ? 'A personal reason to go back with friends' : null, ai_note: null,
  source_type: index % 2 === 0 ? 'instagram' : 'manual', source_url: index % 2 === 0 ? `https://www.instagram.com/reel/test${index}/` : null,
  notifications_enabled: false, archived_at: null,
  place: { id: `place-${index}`, google_place_id: `google-${index}`, name: index === 0 ? 'A very long destination name with enough words to wrap on a smaller iPhone' : `Place ${index}`, formatted_address: '123 Long Example Street, Santa Cruz, CA, USA', latitude: 36.97, longitude: -122.03, nearr_category: 'restaurant' },
});
const text = (node: any): string => node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
async function main() {
  let assertions = 0;
  const { offlineSavedPlacePhoto } = require('../lib/offlineSavedPlacePhoto');
  for (const item of OFFLINE_ONBOARDING_FIXTURES) assert.equal(offlineSavedPlacePhoto(item.place.id), 'file:///bundled-destination.jpg');
  assert.equal(offlineSavedPlacePhoto('real-server-place-id'), null, 'never substitute demo photos for real places');
  const tutorial = { ...fixture(0), place: { ...fixture(0).place, id: OFFLINE_ONBOARDING_FIXTURES[0].place.id } };
  let tutorialCard!: ReturnType<typeof TestRenderer.create>;
  const beforeTutorialHydration = hydrationRequests.length;
  await TestRenderer.act(async () => { tutorialCard = TestRenderer.create(React.createElement(SavedPlaceBrowseCard, { saved: tutorial, onPress() {} })); });
  assert.deepEqual(tutorialCard.root.findByType('PlaceImage' as any).props.initialPhotoUrls, ['file:///bundled-destination.jpg']);
  assert.equal(hydrationRequests.length, beforeTutorialHydration, 'local tutorial image never requests provider hydration');
  await TestRenderer.act(async () => tutorialCard.unmount());
  for (const count of [0, 1, 3, 5, 20, 50, 51, 125]) {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const places = Array.from({ length: count }, (_v, index) => fixture(index));
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SavedPlacesLibrary, {
      savedPlaces: places, nearbyPlaces: [], locationState: 'unavailable', loading: false,
      requestLocationPermission: async () => false, onSelectPlace() {}, onSaveFromLink() {}, onSearchManually() {},
    })); });
    const list = renderer.root.findByType('FlatList' as any);
    assert.equal(list.props.data.length, count > 0 && count <= 50 ? count - 1 : count); assertions++;
    assert.equal(renderer.root.findAll((node) => node.type === SavedPlaceBrowseCardView && node.props.featured).length, count > 0 && count <= 50 ? 1 : 0); assertions++;
    const renderedIds = renderer.root.findAllByType(SavedPlaceBrowseCardView).map((node) => node.props.saved.id);
    assert.equal(new Set(renderedIds).size, count, 'each saved identity appears exactly once'); assertions++;
    if (count === 0) { assert.match(text(renderer.toJSON()), /No saved places yet/); assertions++; }
    if (count > 1) {
      await TestRenderer.act(async () => renderer.root.findByType('Input' as any).props.onChangeText('Place 1'));
      assert.equal(renderer.root.findAll((node) => node.type === SavedPlaceBrowseCardView && node.props.featured).length, 0); assertions++;
      assert.ok(renderer.root.findByType('FlatList' as any).props.data.every((item: any) => item.place.name.includes('Place 1'))); assertions++;
      await TestRenderer.act(async () => renderer.root.findByType('Input' as any).props.onChangeText('nothing-matches'));
      assert.match(text(renderer.toJSON()), /No matches/); assertions++;
    }
    await TestRenderer.act(async () => renderer.unmount());
  }
  for (fontScale of [1, 1.5, 2.2]) {
    let selected: unknown = null;
    const saved = fixture(0);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SavedPlaceBrowseCard, { saved, onPress: (place: unknown) => { selected = place; } })); });
    const button = renderer.root.findByType('Pressable' as any);
    button.props.onPress();
    assert.equal(selected, saved, 'selection preserves exact saved row'); assertions++;
    assert.match(button.props.accessibilityLabel, /Original post attached/); assertions++;
    const name = renderer.root.findAllByType('Text' as any).find((node) => node.props.children === saved.place.name)!;
    assert.equal(name.props.numberOfLines, fontScale >= 1.5 ? undefined : 2); assertions++;
    assert.equal(renderer.root.findByType('PlaceImage' as any).props.hydrationPolicy, 'saved_snapshot'); assertions++;
    assert.equal(renderer.root.findByType('PlaceImage' as any).props.preferPlacePhoto, true, 'cached destination imagery wins over source thumbnail'); assertions++;
    await TestRenderer.act(async () => renderer.unmount());
  }
  hydratedPhotoUris = ['file:///source-frame.jpg'];
  hydratedPhotoKind = 'source';
  let sourceRenderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => { sourceRenderer = TestRenderer.create(React.createElement(SavedPlaceBrowseCard, { saved: fixture(0), featured: true, onPress() {} })); });
  assert.equal(sourceRenderer.root.findByType('PlaceImage' as any).props.size, 72, 'source frame does not reserve a large destination hero'); assertions++;
  assert.match(text(sourceRenderer.toJSON()), /Post/, 'source frame has visible provenance'); assertions++;
  await TestRenderer.act(async () => sourceRenderer.unmount());
  fontScale = 1;
  hydratedPhotoKind = 'destination';
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};
  for (const hasPhoto of [false, true]) {
    hydratedPhotoUris = hasPhoto ? ['file:///saved-place.jpg'] : [];
    const beforeRequests = hydrationRequests.length;
    const saved = fixture(0);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SavedPlaceBrowseCard, { saved, featured: true, onPress() {} })); });
    const image = renderer.root.findByType('PlaceImage' as any);
    const button = renderer.root.findByType('Pressable' as any);
    assert.equal(image.props.size, hasPhoto ? 327 : 72, 'missing imagery cannot reserve a full-width hero'); assertions++;
    assert.equal(flatten(button.props.style).flexDirection, hasPhoto ? 'column' : 'row'); assertions++;
    assert.ok(text(renderer.toJSON()).includes(saved.place.name), 'real title survives the compact fallback'); assertions++;
    assert.equal(image.props.hydrationPolicy, 'saved_snapshot'); assertions++;
    assert.equal(hydrationRequests.length - beforeRequests, 1, 'visual fallback does not add hydration'); assertions++;
    assert.equal(hydrationRequests.at(-1)?.trigger, 'saved_library'); assertions++;
    if (hasPhoto) {
      await TestRenderer.act(async () => image.props.onResolvedKind('neutral'));
      assert.equal(renderer.root.findByType('PlaceImage' as any).props.size, 72, 'failed known photo collapses to compact fallback'); assertions++;
      assert.equal(hydrationRequests.length - beforeRequests, 1, 'image failure does not trigger new provider hydration'); assertions++;
    }
    await TestRenderer.act(async () => renderer.unmount());
  }
  console.log(`PASS Fieldnotes Saved components (${assertions} assertions): 0/1/3/5/20/50/51/125 places, no duplicate lead, search/empty, exact selection, 3 text scales, compact no-photo/source/failed-photo fallback, snapshot photo policy`);
}
main().finally(() => { Module._load = originalLoad; }).catch((error) => { console.error(error); process.exitCode = 1; });
