import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const react = read('ShareExtension.tsx');
const nativePatch = read('patches/expo-share-extension+1.10.7.patch');

assert.match(react, /backgroundColor: 'transparent'/);
assert.match(react, /height: '100%'/);
assert.doesNotMatch(react, /SharedPreview|previewImage/);
assert.match(nativePatch, /view\.backgroundColor = \.clear/);
assert.match(nativePatch, /min\(max\(requestedHeight, 190\), 240\)/);
assert.match(nativePatch, /safeAreaInsets\.bottom/);
assert.match(nativePatch, /flexibleTopMargin/);
assert.doesNotMatch(nativePatch, /\+.*flexibleHeight/);

console.log('PASS compact share-extension contract');