import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const react = read('ShareExtension.tsx');
const nativePatch = read('patches/expo-share-extension+1.10.7.patch');

assert.match(react, /backgroundColor: NEARR_SURFACE/);
assert.match(react, /contentContainerStyle={asyncStyles\.contentContainer}/);
assert.match(react, /justifyContent: 'center'/);
assert.doesNotMatch(react, /height: '100%'/);
assert.doesNotMatch(react, /SharedPreview|previewImage/);
assert.match(nativePatch, /applyCompactPreferredContentSize\(\)/);
assert.match(nativePatch, /preferredContentSize = target/);
assert.match(nativePatch, /rootView\.topAnchor\.constraint\(equalTo: view\.topAnchor\)/);
assert.match(nativePatch, /rootView\.bottomAnchor\.constraint\(equalTo: view\.bottomAnchor\)/);
assert.match(nativePatch, /view\.backgroundColor = extensionBackground/);
assert.doesNotMatch(nativePatch, /\+.*rootView\.frame = CGRect/);

console.log('PASS compact share-extension contract');
