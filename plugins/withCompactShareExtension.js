const fs = require('fs');
const path = require('path');
const { IOSConfig, withFinalizedMod } = require('expo/config-plugins');

const CONTROLLER_RELATIVE_PATH = path.join(
  'native',
  'share-extension',
  'ShareExtensionViewController.swift',
);

function copyCompactController({ projectRoot, platformProjectRoot, targetName }) {
  const source = path.join(projectRoot, CONTROLLER_RELATIVE_PATH);
  const target = path.join(
    platformProjectRoot,
    targetName,
    'ShareExtensionViewController.swift',
  );

  if (!fs.existsSync(source)) {
    throw new Error(`[withCompactShareExtension] Missing native controller: ${source}`);
  }
  if (!fs.existsSync(path.dirname(target))) {
    throw new Error(
      `[withCompactShareExtension] expo-share-extension target was not generated: ${path.dirname(target)}`,
    );
  }

  fs.copyFileSync(source, target);
  return target;
}

/**
 * Replaces the generated package controller with Nearr's authoritative,
 * structurally tested implementation. A finalized mod is required here:
 * withXcodeProject mods compose in reverse registration order, so a second
 * Xcode mod registered after expo-share-extension runs before its target mod.
 * Finalized mods run after every regular iOS mod and can safely access the
 * generated extension directory without depending on plugin-list ordering.
 */
function withCompactShareExtension(config) {
  return withFinalizedMod(config, ['ios', (modConfig) => {
    const targetName = `${IOSConfig.XcodeUtils.sanitizedName(modConfig.name)}ShareExtension`;
    copyCompactController({
      projectRoot: modConfig.modRequest.projectRoot,
      platformProjectRoot: modConfig.modRequest.platformProjectRoot,
      targetName,
    });
    return modConfig;
  }]);
}

module.exports = withCompactShareExtension;
module.exports.copyCompactController = copyCompactController;
