// Metro config.
//
// expo-share-extension requires `share.js` to be a recognized source
// extension so that index.share.js is picked as the entry point for the
// share-extension bundle (separate from the host app's index.js).
const { getDefaultConfig } = require('expo/metro-config');

/** @param {import('expo/metro-config').MetroConfig} config */
function withShareExtension(config) {
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'share.js'];
  return config;
}

module.exports = withShareExtension(getDefaultConfig(__dirname));
