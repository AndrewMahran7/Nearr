// Metro config.
//
// expo-share-extension requires `share.js` to be a recognized source
// extension so that index.share.js is picked as the entry point for the
// share-extension bundle (separate from the host app's index.js).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @param {import('expo/metro-config').MetroConfig} config */
function withShareExtension(config) {
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'share.js'];
  return config;
}

/**
 * Isolate the Phase 2 media worker (services/media-worker) from Metro.
 *
 * It is a SEPARATE Node/Docker package with server-only dependencies
 * (yt-dlp / ffmpeg / puppeteer / sharp, etc.) and its own node_modules. Nothing
 * in the mobile app imports it, but we block-list the path so Metro never
 * crawls or bundles it into the React Native bundle even by accident.
 *
 * @param {import('expo/metro-config').MetroConfig} config
 */
function withMediaWorkerIgnored(config) {
  const workerDir = path.join(__dirname, 'services', 'media-worker');
  const escaped = workerDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocked = new RegExp(`^${escaped}[\\\\/].*`);

  const existing = config.resolver.blockList;
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  config.resolver.blockList = [...list, blocked];
  return config;
}

module.exports = withMediaWorkerIgnored(withShareExtension(getDefaultConfig(__dirname)));
