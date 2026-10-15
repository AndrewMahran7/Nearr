import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';

const Module = require('node:module');
const originalLoad = Module._load;
let fontScale = 1;
const colors = { text: '#27372c', textSecondary: '#626a5e', accent: '#b64615', surface: '#f7f4ec', surfaceElevated: '#eeece3' };
const typography = { heading: {}, caption: {}, label: {} };
const Pressable = ({ style, children, ...props }: any) => React.createElement('Pressable', { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style }, children);
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') return {
    Image: 'Image', Pressable, Text: 'Text', View: 'View',
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 320, height: 568, fontScale, scale: 2 }),
  };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors, typography }) };
  if (request.startsWith('@/')) return originalLoad(path.resolve(__dirname, '..', request.slice(2)), parent, isMain);
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { SelectedPlaceCard } = require('../components/map/FieldnotesMapChrome');
const saved = {
  id: 'saved-test', user_id: 'user-test', source_type: 'instagram', source_url: 'https://www.instagram.com/reel/example/',
  notes: 'Visit for the garden terrace and the breakfast with friends.', ai_note: null,
  place: { id: 'place-test', name: 'A long destination name with words that need room on a smaller iPhone', formatted_address: '123 Main Street, Santa Cruz, CA, USA' },
};
const allText = (node: any): string => !node ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(allText).join(' ') : allText(node.children);
async function main() {
  let assertions = 0;
  for (fontScale of [1, 1.5, 2.2]) {
    for (const imageKind of ['destination', 'source', 'unknown', 'missing']) {
      let opened = 0;
      let closed = 0;
      let renderer!: ReturnType<typeof TestRenderer.create>;
      await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(SelectedPlaceCard, {
        place: saved, imageUri: imageKind === 'missing' ? null : 'file:///image.jpg', imageKind: imageKind === 'missing' ? 'unknown' : imageKind,
        onOpen: () => opened++, onClose: () => closed++,
      })); });
      const output = allText(renderer.toJSON());
      assert.ok(output.indexOf(saved.place.name) < output.indexOf(saved.notes), 'identity precedes reason'); assertions++;
      assert.match(output, /View details/); assertions++;
      assert.doesNotMatch(output, /A place to remember|saved places|SAVED TO YOUR WORLD/); assertions++;
      const title = renderer.root.findAllByType('Text' as any).find((node) => node.props.children === saved.place.name)!;
      assert.equal(title.props.numberOfLines, fontScale >= 1.5 ? undefined : 2); assertions++;
      const buttons = renderer.root.findAllByType('Pressable' as any);
      buttons.find((node) => node.props.accessibilityLabel.startsWith('Open '))!.props.onPress();
      buttons.find((node) => node.props.accessibilityLabel === 'Close place preview')!.props.onPress();
      assert.equal(opened, 1); assertions++;
      assert.equal(closed, 1); assertions++;
      if (imageKind !== 'missing') {
        const image = renderer.root.findByType('Image' as any);
        assert.match(image.props.accessibilityLabel, imageKind === 'source' ? /^From your post:/ : imageKind === 'unknown' ? /^Saved image:/ : /^Destination photo:/); assertions++;
        await TestRenderer.act(async () => image.props.onError());
        assert.equal(renderer.root.findAllByType('Image' as any).length, 0, 'failed photo leaves readable identity without blank hero'); assertions++;
      }
      await TestRenderer.act(async () => renderer.unmount());
    }
  }
  console.log(`PASS selected card: ${assertions} assertions, identity-first, 3 text scales, 4 image states, exact open/close, truthful provenance and failed-image fallback`);
}
main().finally(() => { Module._load = originalLoad; }).catch((error) => { console.error(error); process.exitCode = 1; });
