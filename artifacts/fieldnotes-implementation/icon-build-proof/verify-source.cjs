// Source and installed Expo SDK icon-generation proof. Does not modify native projects.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const sharp = require(process.env.NEARR_SHARP_MODULE || 'C:/Users/andre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const load = name => require(require.resolve(name, { paths: [root] }));
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
(async () => {
  // Read local build inputs without printing or recording any credential values.
  for (const file of ['.env', '.env.local']) {
    const filePath = path.join(root, file);
    if (fs.existsSync(filePath)) load('dotenv').config({ path: filePath, quiet: true });
  }
  const config = load('@expo/config').getConfig(root).exp;
  const source = path.resolve(root, config.ios?.icon || config.icon);
  const winner = path.join(root, 'artifacts/fieldnotes-implementation/icon-study/winner-icon-1024.png');
  const out = path.join(__dirname, 'generated/ios/Nearr');
  const iconset = path.join(out, 'Images.xcassets/AppIcon.appiconset');
  fs.mkdirSync(iconset, { recursive: true });
  const icons = load('@expo/prebuild-config/build/plugins/icons/withIosIcons.js');
  const images = await icons.generateUniversalIconAsync(root, { icon: source, cacheKey: 'fieldnotes-implementation-icon-proof', iosNamedProjectRoot: out, platform: 'ios' });
  fs.writeFileSync(path.join(iconset, 'Contents.json'), JSON.stringify({ images, info: { version: 1, author: 'expo' } }, null, 2) + '\n');
  const generated = path.join(iconset, images[0].filename);
  const [sourcePixels, generatedPixels] = await Promise.all([sharp(source).removeAlpha().raw().toBuffer(), sharp(generated).removeAlpha().raw().toBuffer()]);
  const sourceMetadata = await sharp(source).metadata();
  const generatedMetadata = await sharp(generated).metadata();
  const proof = {
    scope: 'Implementation source and installed Expo generator only; final IPA pending',
    configuration: { name: config.name, version: config.version, bundleIdentifier: config.ios?.bundleIdentifier, expoIcon: config.icon, iosIcon: config.ios?.icon, appearance: config.userInterfaceStyle, appEnv: config.extra?.appEnv, backendEnv: config.extra?.backendEnv },
    toolchain: { expo: load('expo/package.json').version, prebuildConfig: load('@expo/prebuild-config/package.json').version, configTypes: load('@expo/config-types/package.json').version },
    source: { path: path.relative(root, source).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(source)), width: sourceMetadata.width, height: sourceMetadata.height, channels: sourceMetadata.channels, space: sourceMetadata.space, hasAlpha: sourceMetadata.hasAlpha },
    winnerBytesEqual: fs.readFileSync(source).equals(fs.readFileSync(winner)),
    generated: { path: path.relative(root, generated).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(generated)), width: generatedMetadata.width, height: generatedMetadata.height, hasAlpha: generatedMetadata.hasAlpha },
    decodedPixelsEqual: sourcePixels.equals(generatedPixels),
    sourceDecodedRgbSha256: sha(sourcePixels),
    generatedDecodedRgbSha256: sha(generatedPixels),
    finalIpaInspected: false,
    installedIosHomeScreenInspected: false,
  };
  fs.writeFileSync(path.join(__dirname, 'source-generator-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
