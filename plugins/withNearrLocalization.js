const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const plist = require('@expo/plist').default;
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

function ensureTargetResourcesPhase(project, targetUuid) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const section = project.hash.project.objects.PBXResourcesBuildPhase || {};
  const existing = target.buildPhases.find(phase => section[phase.value]);
  if (existing) {
    // expo-share-extension creates all three empty native phases with the
    // placeholder label "Embed Foundation Extensions". Relabel its resource
    // phase so node-xcode can find it by target instead of creating a second
    // PBXResourcesBuildPhase (which Xcode warns may build incorrectly).
    existing.comment = 'Resources';
    section[`${existing.value}_comment`] = 'Resources';
    return section[existing.value];
  }
  const added = project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);
  return added.buildPhase;
}

function ensureExtensionVersionPreAction({ platformProjectRoot, projectName, hostTargetUuid, hostTargetName, extensionTargetName }) {
  const schemePath = path.join(platformProjectRoot, `${projectName}.xcodeproj`, 'xcshareddata', 'xcschemes', `${projectName}.xcscheme`);
  if (!fs.existsSync(schemePath)) throw new Error(`Nearr localization: missing shared scheme ${schemePath}`);
  let scheme = fs.readFileSync(schemePath, 'utf8');
  const title = 'Sync Share Extension build number';
  if (scheme.includes(`title = "${title}"`)) return;
  const anchor = '      <BuildActionEntries>';
  if (!scheme.includes(anchor)) throw new Error('Nearr localization: shared scheme BuildActionEntries missing');
  const script = `HOST_BUILD="\${EAS_BUILD_IOS_BUILD_NUMBER:-}"\nif [ -z "\${HOST_BUILD}" ]; then\n  HOST_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "\${PROJECT_DIR}/${hostTargetName}/Info.plist")\nfi\necho "Syncing ${extensionTargetName} CFBundleVersion to \${HOST_BUILD}"\n/usr/libexec/PlistBuddy -c "Set :CFBundleVersion \${HOST_BUILD}" "\${PROJECT_DIR}/${extensionTargetName}/Info.plist"`;
  const escaped = script.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\n', '&#10;');
  const preAction = `      <PreActions>\n         <ExecutionAction\n            ActionType = "Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction">\n            <ActionContent\n               title = "${title}"\n               scriptText = "${escaped}">\n               <EnvironmentBuildable>\n                  <BuildableReference\n                     BuildableIdentifier = "primary"\n                     BlueprintIdentifier = "${hostTargetUuid}"\n                     BuildableName = "${hostTargetName}.app"\n                     BlueprintName = "${hostTargetName}"\n                     ReferencedContainer = "container:${projectName}.xcodeproj">\n                  </BuildableReference>\n               </EnvironmentBuildable>\n            </ActionContent>\n         </ExecutionAction>\n      </PreActions>\n`;
  scheme = scheme.replace(anchor, preAction + anchor);
  fs.writeFileSync(schemePath, scheme);
}

function writeNativeLocales({ projectRoot, platformProjectRoot, project, buildNumber = '1' }) {
  const targets = Object.entries(project.pbxNativeTargetSection()).filter(([key, target]) =>
    !key.endsWith('_comment') && /com.apple.product-type.(application|app-extension)/.test(target.productType));
  for (const [uuid, target] of targets) {
    const targetName = target.name.replaceAll('"', '');
    const groupName = `NearrLocales-${targetName}`;
    if (/com.apple.product-type.app-extension/.test(target.productType)) {
      const infoPath = path.join(platformProjectRoot, targetName, 'Info.plist');
      if (!fs.existsSync(infoPath)) throw new Error(`Nearr localization: missing ${targetName}/Info.plist`);
      const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
      // EAS remote versioning rewrites literal CFBundleVersion values after
      // prebuild. expo-share-extension emits $(CURRENT_PROJECT_VERSION), which
      // leaves the nested bundle at 1 while the host is incremented remotely.
      info.CFBundleVersion = String(buildNumber);
      fs.writeFileSync(infoPath, plist.build(info));
    }
    // Normalize or create one target-scoped Resources phase before adding
    // variant groups. node-xcode otherwise falls back to the first target.
    const resourcesPhase = ensureTargetResourcesPhase(project, uuid);
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
        const build = { uuid: project.generateUuid(), fileRef: variantId, basename: resource, group: 'Resources', target: uuid };
        project.addToPbxBuildFileSection(build);
        resourcesPhase.files.push({ value: build.uuid, comment: `${resource} in Resources` });
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
    if (writeNativeLocales({ projectRoot, platformProjectRoot, project, buildNumber: mod.ios?.buildNumber || '1' }) < 2) throw new Error('Nearr localization: host and Share Extension targets required');
    fs.writeFileSync(filename, project.writeSync());
    const targets = Object.entries(project.pbxNativeTargetSection()).filter(([key]) => !key.endsWith('_comment'));
    const host = targets.find(([, target]) => /com.apple.product-type.application/.test(target.productType));
    const extension = targets.find(([, target]) => /com.apple.product-type.app-extension/.test(target.productType));
    if (!host || !extension) throw new Error('Nearr localization: host and Share Extension targets required');
    const projectName = projectDirectory.slice(0, -'.xcodeproj'.length);
    ensureExtensionVersionPreAction({
      platformProjectRoot,
      projectName,
      hostTargetUuid: host[0],
      hostTargetName: host[1].name.replaceAll('"', ''),
      extensionTargetName: extension[1].name.replaceAll('"', ''),
    });
    return mod;
  }]);
};

module.exports.writeNativeLocales = writeNativeLocales;
module.exports.ensureTargetResourcesPhase = ensureTargetResourcesPhase;
module.exports.ensureExtensionVersionPreAction = ensureExtensionVersionPreAction;
module.exports.NATIVE_KEYS = NATIVE_KEYS;
module.exports.LOCALES = LOCALES;
