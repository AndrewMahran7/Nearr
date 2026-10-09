import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';

// Real Saved components, native host doubles. These assert behavior/layout
// contracts; they are deliberately not described as screenshots or device QA.
const Module = require('node:module');
const originalLoad = Module._load;
let fontScale = 1;
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
  if (request === 'react-native') return {
    ActivityIndicator: 'ActivityIndicator', FlatList, Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
    Linking: { openSettings: async () => undefined }, Pressable, ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 375, height: 667, fontScale, scale: 2 }),
  };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors, typography }) };
  if (request === '@/lib/savedPlaceHydration') return { hydrateSavedPlace: async () => ({ details: { photoUrls: ['file:///saved-place.jpg'] } }) };
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
  for (const count of [0, 1, 5, 20, 100]) {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const places = Array.from({ length: count }, (_v, index) => fixture(index));
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SavedPlacesLibrary, {
      savedPlaces: places, nearbyPlaces: [], locationState: 'unavailable', loading: false,
      requestLocationPermission: async () => false, onSelectPlace() {}, onSaveFromLink() {}, onSearchManually() {},
    })); });
    const list = renderer.root.findByType('FlatList' as any);
    assert.equal(list.props.data.length, Math.max(0, count - 1)); assertions++;
    assert.equal(renderer.root.findAll((node) => node.type === SavedPlaceBrowseCardView && node.props.featured).length, count > 0 ? 1 : 0); assertions++;
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
    await TestRenderer.act(async () => renderer.unmount());
  }
  console.log(`PASS Fieldnotes Saved components (${assertions} assertions): 0/1/5/20/100 places, no duplicate lead, search/empty, exact selection, 3 text scales, snapshot photo policy`);
}
main().finally(() => { Module._load = originalLoad; }).catch((error) => { console.error(error); process.exitCode = 1; });
