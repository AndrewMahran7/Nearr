const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

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
 * Runs after expo-share-extension's Xcode mod and replaces the package's
 * controller with Nearr's authoritative, structurally tested implementation.
 */
function withCompactShareExtension(config) {
  return withXcodeProject(config, (modConfig) => {
    const targetName = `${IOSConfig.XcodeUtils.sanitizedName(modConfig.name)}ShareExtension`;
    copyCompactController({
      projectRoot: modConfig.modRequest.projectRoot,
      platformProjectRoot: modConfig.modRequest.platformProjectRoot,
      targetName,
    });
    return modConfig;
  });
}

module.exports = withCompactShareExtension;
module.exports.copyCompactController = copyCompactController;
