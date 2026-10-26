const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const xcode = require('xcode');
const { writeNativeLocales, LOCALES, NATIVE_KEYS } = require('../plugins/withNearrLocalization');
const projectRoot = path.resolve(__dirname, '..');
const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-native-locales-'));
fs.mkdirSync(path.join(nativeRoot,'NearrShareExtension'),{recursive:true});
fs.writeFileSync(path.join(nativeRoot,'NearrShareExtension','Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string></dict></plist>');
// Real xcode library and minimal valid host/extension graph. Deliberately no
// legacy Resources group: modern Expo projects do not create one.
const project = xcode.project(path.join(nativeRoot, 'test.pbxproj'));
project.hash = { project: { archiveVersion: 1, classes: {}, objectVersion: 54, rootObject: 'P', objects: {
  PBXProject: { P: { isa:'PBXProject', mainGroup:'G', targets:[{value:'T1',comment:'Nearr'},{value:'T2',comment:'NearrShareExtension'}], knownRegions:['en'] }, P_comment:'Project object' },
  PBXGroup: { G: {isa:'PBXGroup',children:[],sourceTree:'"<group>"'},G_comment:'Main' },
  PBXNativeTarget: { T1:{isa:'PBXNativeTarget',name:'Nearr',productType:'"com.apple.product-type.application"',buildPhases:[{value:'R1',comment:'Resources'}]}, T1_comment:'Nearr', T2:{isa:'PBXNativeTarget',name:'NearrShareExtension',productType:'"com.apple.product-type.app-extension"',buildPhases:[{value:'R2',comment:'Embed Foundation Extensions'}]}, T2_comment:'NearrShareExtension' },
  PBXResourcesBuildPhase:{R1:{isa:'PBXResourcesBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0},R1_comment:'Resources',R2:{isa:'PBXResourcesBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0},R2_comment:'Embed Foundation Extensions'},
  PBXBuildFile:{}, PBXFileReference:{}, PBXVariantGroup:{}
} } };
assert.equal(writeNativeLocales({projectRoot,platformProjectRoot:nativeRoot,project,buildNumber:'66'}),2);
function verify(p, root) {
  const variants=Object.entries(p.hash.project.objects.PBXVariantGroup).filter(([k])=>!k.endsWith('_comment'));
  assert.equal(variants.length,4,'two resource variant groups per target');
  for(const [,group] of variants) {
    assert.equal(group.children.length,10,'all ten locales belong to each variant');
    const names=group.children.map(child=>JSON.parse(p.pbxFileReferenceSection()[child.value].name)).sort();
    assert.deepEqual(names,[...LOCALES].sort());
  }
  for(const target of ['Nearr','NearrShareExtension']) for(const locale of LOCALES) {
    const catalog=JSON.parse(fs.readFileSync(path.join(projectRoot,'locales',`${locale}.json`),'utf8'));
    const text=fs.readFileSync(path.join(root,target,'NearrLocales',`${locale}.lproj`,'Localizable.strings'),'utf8');
    for(const key of NATIVE_KEYS) assert.ok(text.includes(`${JSON.stringify(key)} = ${JSON.stringify(catalog[key]||key)};`),`${target}/${locale}/${key}`);
    const plist=fs.readFileSync(path.join(root,target,'NearrLocales',`${locale}.lproj`,'InfoPlist.strings'),'utf8');
    assert.match(plist,/NSLocationWhenInUseUsageDescription/);
    assert.match(plist,/NSLocationAlwaysAndWhenInUseUsageDescription/);
  }
  const hostResources=p.pbxResourcesBuildPhaseObj('T1');
  const extensionResources=p.pbxResourcesBuildPhaseObj('T2');
  const resourcesSection=p.hash.project.objects.PBXResourcesBuildPhase;
  assert.equal(p.pbxNativeTargetSection().T1.buildPhases.filter(phase=>resourcesSection[phase.value]).length,1,'host has exactly one Resources phase');
  assert.equal(p.pbxNativeTargetSection().T2.buildPhases.filter(phase=>resourcesSection[phase.value]).length,1,'extension placeholder is reused as its single Resources phase');
  assert.equal(hostResources.files.length,2,'host contains only its two variant groups');
  assert.equal(extensionResources.files.length,2,'extension gets its own Resources phase and two variant groups');
  const hostRefs=hostResources.files.map(file=>p.pbxBuildFileSection()[file.value].fileRef);
  const extensionRefs=extensionResources.files.map(file=>p.pbxBuildFileSection()[file.value].fileRef);
  assert.equal(new Set([...hostRefs,...extensionRefs]).size,4,'no variant group is copied into both targets');
  assert.match(fs.readFileSync(path.join(root,'NearrShareExtension','Info.plist'),'utf8'),/<string>66<\/string>/,'extension build number is materialized for EAS remote-version rewriting');
}
verify(project,nativeRoot);
const before=project.writeSync();
assert.equal(writeNativeLocales({projectRoot,platformProjectRoot:nativeRoot,project,buildNumber:'66'}),2);
assert.equal(project.writeSync(),before,'prebuild is idempotent with no duplicate resources');
fs.writeFileSync(project.filepath,before);
const parsed=xcode.project(project.filepath);parsed.parseSync();verify(parsed,nativeRoot);
const report={verifiedAt:new Date().toISOString(),targets:2,locales:LOCALES,nativeKeys:NATIVE_KEYS.length,variantGroups:4,generatedStringFiles:40,idempotent:true,roundTripParsed:true,scope:'Native project generation only; no Swift compile, IPA, simulator, or physical device claim.'};
fs.mkdirSync(path.join(projectRoot,'artifacts/global-release/localization'),{recursive:true});
fs.writeFileSync(path.join(projectRoot,'artifacts/global-release/localization/native-resource-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log('PASS native localization: host + extension, 10 locales, 40 files, real PBX variant groups, idempotence and parser round trip');
