import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { copyCompactController } = require('../plugins/withCompactShareExtension') as {
  copyCompactController: (args: {
    projectRoot: string;
    platformProjectRoot: string;
    targetName: string;
  }) => string;
};

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const react = read('ShareExtension.tsx');
const authoritativeSwift = read('native/share-extension/ShareExtensionViewController.swift');
const infoPlistPlugin = read(
  'node_modules/expo-share-extension/plugin/build/withShareExtensionInfoPlist.js',
);
const compactPlugin = read('plugins/withCompactShareExtension.js');
const appConfig = JSON.parse(read('app.json')) as {
  expo: { plugins: Array<string | [string, { height?: number }]> };
};

// Exercise the same deterministic copy performed after expo-share-extension's
// Xcode mod. The structural checks below inspect this generated output, not a
// locally mutated package file.
const generatedRoot = mkdtempSync(join(tmpdir(), 'nearr-share-plugin-'));
const targetName = 'NearrShareExtension';
mkdirSync(join(generatedRoot, targetName), { recursive: true });
const generatedSwiftPath = copyCompactController({
  projectRoot: process.cwd(),
  platformProjectRoot: generatedRoot,
  targetName,
});
const swift = readFileSync(generatedSwiftPath, 'utf8');
assert.equal(swift, authoritativeSwift, 'generated controller exactly matches authoritative Swift');

function stripSwiftLiteralsAndComments(source: string): string {
  let output = '';
  let index = 0;
  let state: 'code' | 'lineComment' | 'blockComment' | 'string' = 'code';
  let blockDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'lineComment';
        output += '  ';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'blockComment';
        blockDepth = 1;
        output += '  ';
        index += 2;
        continue;
      }
      if (char === '"') {
        state = 'string';
        output += ' ';
        index += 1;
        continue;
      }
      output += char;
      index += 1;
      continue;
    }
    if (state === 'lineComment') {
      if (char === '\n') {
        state = 'code';
        output += '\n';
      } else {
        output += ' ';
      }
      index += 1;
      continue;
    }
    if (state === 'blockComment') {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        output += '  ';
        index += 2;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        output += '  ';
        index += 2;
        if (blockDepth === 0) state = 'code';
      } else {
        output += char === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (char === '\\') {
      output += '  ';
      index += 2;
    } else if (char === '"') {
      state = 'code';
      output += ' ';
      index += 1;
    } else {
      output += char === '\n' ? '\n' : ' ';
      index += 1;
    }
  }

  assert.equal(state, 'code', 'Swift source has an unterminated comment or string');
  return output;
}

function assertBalanced(source: string, open: string, close: string): void {
  let depth = 0;
  for (const char of source) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    assert.ok(depth >= 0, `Swift source closes ${close} before matching ${open}`);
  }
  assert.equal(depth, 0, `Swift source has unbalanced ${open}${close}`);
}

function braceDepthAt(source: string, index: number): number {
  let depth = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
  }
  return depth;
}

const strippedSwift = stripSwiftLiteralsAndComments(swift);
assertBalanced(strippedSwift, '{', '}');
assertBalanced(strippedSwift, '(', ')');
assertBalanced(strippedSwift, '[', ']');

const classIndex = strippedSwift.indexOf('class ShareExtensionViewController');
assert.ok(classIndex >= 0, 'generated package source declares the expected principal class');
assert.equal(braceDepthAt(strippedSwift, classIndex), 0, 'principal class is at file scope');

for (const declaration of [
  'private let compactSurfaceView',
  'private var compactSurfaceHeightConstraint',
  'override func viewDidLoad',
  'private func setupCompactSurface',
  'private func applyCompactLayout',
  'private func configureRootView',
  'private func setupNotificationCenterObserver',
  'private func cleanupAfterClose',
]) {
  const index = strippedSwift.indexOf(declaration);
  assert.ok(index >= 0, `missing Swift declaration: ${declaration}`);
  assert.equal(braceDepthAt(strippedSwift, index), 1, `${declaration} must be at class scope`);
}

// Outer host bounds remain transparent. Only the native compact surface is
// dark, rounded, height-constrained, and anchored to the controller bottom.
assert.match(swift, /view\.backgroundColor = \.clear/);
assert.match(swift, /view\.isOpaque = false/);
assert.match(swift, /compactSurfaceView\.backgroundColor = compactSurfaceColor/);
assert.match(swift, /compactSurfaceView\.bottomAnchor\.constraint\(equalTo: view\.bottomAnchor\)/);
assert.match(swift, /compactSurfaceView\.heightAnchor\.constraint\(equalToConstant: requestedCompactHeight\)/);
assert.match(swift, /layer\.maskedCorners = \[\.layerMinXMinYCorner, \.layerMaxXMinYCorner\]/);
assert.match(swift, /preferredContentSize = target/);
assert.match(swift, /maximumAccessibleHeight: CGFloat = 420/);
assert.match(swift, /preferredContentSizeCategory\.isAccessibilityCategory/);

// Both startup and React content are confined to the compact native surface.
assert.match(swift, /compactSurfaceView\.addSubview\(loadingIndicator\)/);
assert.match(swift, /loadingLabel\.text = "Preparing share…"/);
assert.match(swift, /title\.text = isBundleFailure \? "Couldn’t start Nearr" : "Couldn’t read this share"/);
assert.match(swift, /retry\.setTitle\("Try again"/);
assert.match(swift, /closeButton\.setTitle\("Close"/);
assert.match(swift, /compactSurfaceView\.addSubview\(rootView\)/);
assert.match(swift, /rootView\.topAnchor\.constraint\(equalTo: compactSurfaceView\.topAnchor\)/);
assert.match(swift, /rootView\.bottomAnchor\.constraint\(equalTo: compactSurfaceView\.bottomAnchor\)/);
assert.doesNotMatch(swift, /rootView\.topAnchor\.constraint\(equalTo: view\.topAnchor\)/);
assert.doesNotMatch(swift, /view\.backgroundColor = compactSurfaceColor/);

const plugin = appConfig.expo.plugins.find(
  (entry): entry is [string, { height?: number }] =>
    Array.isArray(entry) && entry[0] === 'expo-share-extension',
);
assert.ok(plugin, 'expo-share-extension config plugin is enabled');
assert.equal(plugin[1].height, 360, 'normal compact height stays within the 340–380pt target');
const sharePluginIndex = appConfig.expo.plugins.indexOf(plugin);
assert.equal(
  appConfig.expo.plugins[sharePluginIndex + 1],
  './plugins/withCompactShareExtension',
  'controller override stays adjacent to expo-share-extension in config',
);
assert.match(compactPlugin, /return withFinalizedMod\(config, \['ios'/);
assert.doesNotMatch(compactPlugin, /return withXcodeProject\(/);
assert.match(infoPlistPlugin, /NSExtensionPrincipalClass:/);
assert.match(infoPlistPlugin, /ShareExtensionViewController/);
assert.match(infoPlistPlugin, /NSExtensionPointIdentifier: "com\.apple\.share-services"/);
assert.doesNotMatch(infoPlistPlugin, /NSExtensionMainStoryboard/);

// React fills only the native surface and contributes no fake screen-sized
// card, spacer, or opaque background of its own.
assert.match(react, /contentContainerStyle={asyncStyles\.contentContainer}/);
assert.match(react, /backgroundColor: 'transparent'/);
assert.match(react, /<SafeAreaView style={asyncStyles\.surface}>/);
assert.doesNotMatch(react, /height: '100%'/);
assert.doesNotMatch(react, /minHeight:\s*(?:[5-9]\d\d|\d{4})/);
assert.doesNotMatch(react, /SharedPreview|previewImage/);

// The extension is a separate process. It always runs its embedded bundle and
// never depends on the host app's Metro session for its first frame.
assert.match(swift, /return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
assert.doesNotMatch(swift, /RCTBundleURLProvider\.sharedSettings/);
assert.match(swift, /extension_js_bundle_failure/);

// Instagram providers may advertise several representations. They are loaded
// independently, every media branch balances its DispatchGroup via defer, and
// a never-returning NSItemProvider is bounded by a deterministic deadline.
assert.match(swift, /let hasURL = provider\.hasItemConformingToTypeIdentifier/);
assert.match(swift, /let hasPropertyList = provider\.hasItemConformingToTypeIdentifier/);
assert.match(swift, /let hasText = provider\.hasItemConformingToTypeIdentifier/);
assert.match(swift, /if hasURL \{/);
assert.match(swift, /if hasPropertyList \{/);
assert.match(swift, /if hasText \{/);
assert.ok((swift.match(/defer \{ group\.leave\(\) \}/g) ?? []).length >= 2, 'media guards always leave group');
assert.match(swift, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ Self\.payloadDeadline\)/);
assert.match(swift, /finish\("timeout"\)/);
assert.match(swift, /firstHTTPURL\(in: results\)/);
assert.match(swift, /firstHTTPURL\(in: text\)/);

// Preserve the already encoded query once. URLQueryItem would escape '%' a
// second time and prevent the host route from recognizing the social URL.
assert.match(swift, /urlComponents\.percentEncodedQuery = queryString/);
assert.doesNotMatch(swift, /urlComponents\.queryItems = queryItems/);
assert.match(swift, /extension_open_host_attempt/);
assert.match(swift, /extension_open_host_success/);
assert.match(swift, /extension_open_host_failure/);
assert.match(swift, /extension_invoked/);
assert.match(swift, /extension_payload_started/);
assert.match(swift, /extension_url_extracted/);
assert.doesNotMatch(swift, /openURL\(url\)\s*\n\s*self\.close\(\)/);

console.log('PASS compact native share-extension layout and Swift structure');
