const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const { withInfoPlist, withFinalizedMod } = require('expo/config-plugins');

const LOCALES = ['en-US', 'es-MX', 'es-ES', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans'];
const WHEN_IN_USE = 'Nearr uses your location to show nearby saved places while you use the app.';
const BACKGROUND = 'Nearr uses background location to remind you when a saved place is nearby, even when the app is closed.';
const NATIVE_KEYS = [
  'Preparing share…',
  'Opening Nearr…',
  'Couldn’t open Nearr',
  'Couldn’t start Nearr',
  'Couldn’t read this share',
  'Try again',
  'Close',
  'Nearr’s share extension couldn’t load. Try again or close this window.',
  'Instagram didn’t finish sending the link. Try again or close this window.',
  'Nearr couldn’t find a link in this item. Try again or close this window.',
  'Try opening Nearr again, or close this window and keep browsing.',
];

function strings(entries) {
  return Object.entries(entries).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`).join('\n') + '\n';
}

function writeNativeLocales({ projectRoot, platformProjectRoot, project }) {
  const targets = Object.entries(project.pbxNativeTargetSection()).filter(([key, target]) =>
    !key.endsWith('_comment') && /com.apple.product-type.(application|app-extension)/.test(target.productType));
  for (const [uuid, target] of targets) {
    const targetName = target.name.replaceAll('"', '');
    const groupName = `NearrLocales-${targetName}`;
    let groupId = project.findPBXGroupKey({ name: groupName });
    if (!groupId) {
      const group = project.addPbxGroup([], groupName);
      groupId = group.uuid;
      project.addToPbxGroup(groupId, project.getFirstProject().firstProject.mainGroup);
    }
    for (const resource of ['InfoPlist.strings', 'Localizable.strings']) {
      const existing = project.getPBXGroupByKey(groupId).children.find(child => child.comment === resource);
      let variantId = existing && existing.value;
      if (!variantId) {
        variantId = project.pbxCreateVariantGroup(resource);
        project.addToPbxGroup(variantId, groupId);
        const build = { uuid: project.generateUuid(), fileRef: variantId, basename: resource, target: uuid };
        project.addToPbxBuildFileSection(build);
        project.addToPbxResourcesBuildPhase(build);
      }
      for (const locale of LOCALES) {
        const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'locales', `${locale}.json`), 'utf8'));
        const entries = resource === 'InfoPlist.strings' ? {
          NSLocationWhenInUseUsageDescription: catalog[WHEN_IN_USE] || WHEN_IN_USE,
          NSLocationAlwaysAndWhenInUseUsageDescription: catalog[BACKGROUND] || BACKGROUND,
          NSLocationAlwaysUsageDescription: catalog[BACKGROUND] || BACKGROUND,
        } : Object.fromEntries(NATIVE_KEYS.map(key => [key, catalog[key] || key]));
        const relative = `${targetName}/NearrLocales/${locale}.lproj/${resource}`;
        const destination = path.join(platformProjectRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, strings(entries));
        if (!project.hasFile(relative)) {
          // Only the variant group belongs in Resources. addResourceFile assumes
          // a legacy PBXGroup named Resources, absent from modern Expo projects.
          const added = project.addFile(relative, variantId, { sourceTree: 'SOURCE_ROOT' });
          if (added) project.pbxFileReferenceSection()[added.fileRef].name = JSON.stringify(locale);
        }
        project.addKnownRegion(locale);
      }
    }
  }
  return targets.length;
}

module.exports = function withNearrLocalization(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.CFBundleLocalizations = LOCALES;
    mod.modResults.CFBundleDevelopmentRegion = 'en';
    mod.modResults.NSLocationWhenInUseUsageDescription = WHEN_IN_USE;
    mod.modResults.NSLocationAlwaysAndWhenInUseUsageDescription = BACKGROUND;
    return mod;
  });
  return withFinalizedMod(config, ['ios', mod => {
    const { projectRoot, platformProjectRoot } = mod.modRequest;
    const projectDirectory = fs.readdirSync(platformProjectRoot).find(name => name.endsWith('.xcodeproj'));
    if (!projectDirectory) throw new Error('Nearr localization: generated Xcode project missing');
    const filename = path.join(platformProjectRoot, projectDirectory, 'project.pbxproj');
    const project = xcode.project(filename);
    project.parseSync();
    if (writeNativeLocales({ projectRoot, platformProjectRoot, project }) < 2) throw new Error('Nearr localization: host and Share Extension targets required');
    fs.writeFileSync(filename, project.writeSync());
    return mod;
  }]);
};

module.exports.writeNativeLocales = writeNativeLocales;
module.exports.NATIVE_KEYS = NATIVE_KEYS;
module.exports.LOCALES = LOCALES;
