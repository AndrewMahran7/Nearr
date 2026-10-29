// Offline/static proof for the tracked source and pinned transform versions.
// Does NOT substitute for inspecting unavailable signed/cached bundles.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const babel=require('@babel/core');
const sourceRef='4e6b60e9b6e727381eeac98d8361d01423e95210';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024});
const source=file=>git('show',`${sourceRef}:${file}`);
const lock=JSON.parse(source('package-lock.json'));
const versions={};
for(const pkg of ['babel-preset-expo','@expo/metro-config','metro','react-native','expo']) {
  versions[pkg]=require(`${pkg}/package.json`).version;
  assert.equal(versions[pkg],lock.packages[`node_modules/${pkg}`].version);
}
const config=source('babel.config.js');
assert.match(config,/presets: \['babel-preset-expo'\]/);
assert.match(config,/plugins: \['react-native-reanimated\/plugin'\]/);
const original={private:process.env.GEMINI_API_KEY,public:process.env.EXPO_PUBLIC_CONTAINMENT_FIXTURE};
let compiled;
try {
  process.env.GEMINI_API_KEY='OFFLINE_PRIVATE_BUILD_SENTINEL';
  process.env.EXPO_PUBLIC_CONTAINMENT_FIXTURE='OFFLINE_PUBLIC_SENTINEL';
  compiled=babel.transformSync('global.result = [process.env.GEMINI_API_KEY, process.env.EXPO_PUBLIC_CONTAINMENT_FIXTURE];',{
    filename:'offline-env-fixture.ts',babelrc:false,configFile:false,
    presets:['babel-preset-expo'],plugins:['react-native-reanimated/plugin'],
    caller:{name:'metro',platform:'ios',isDev:false,isServer:false,isNodeModule:false,projectRoot:process.cwd()},
  }).code;
} finally {
  if(original.private===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original.private;
  if(original.public===undefined)delete process.env.EXPO_PUBLIC_CONTAINMENT_FIXTURE;else process.env.EXPO_PUBLIC_CONTAINMENT_FIXTURE=original.public;
}
assert.match(compiled,/process\.env\.GEMINI_API_KEY/);
assert.ok(compiled.includes('OFFLINE_PUBLIC_SENTINEL'));
assert.ok(!compiled.includes('OFFLINE_PRIVATE_BUILD_SENTINEL'));
const prelude=require('metro/src/lib/getPreludeCode')({extraVars:{},isDev:false,globalPrefix:'',requireCycleIgnorePatterns:[]});
const sandbox=vm.createContext({}); sandbox.global=sandbox;
vm.runInContext(prelude+'\n'+compiled,sandbox,{timeout:1000});
assert.equal(sandbox.result[0],undefined);assert.equal(sandbox.result[1],'OFFLINE_PUBLIC_SENTINEL');
const serializer=require('@expo/metro-config/build/serializer/environmentVariableSerializerPlugin');
const devPrelude=serializer.getEnvVarDevString({GEMINI_API_KEY:'OFFLINE_PRIVATE_BUILD_SENTINEL',EXPO_PUBLIC_CONTAINMENT_FIXTURE:'OFFLINE_PUBLIC_SENTINEL'});
assert.ok(!devPrelude.includes('GEMINI_API_KEY')); assert.ok(!devPrelude.includes('OFFLINE_PRIVATE_BUILD_SENTINEL'));
const trackedRuntimeFiles=git('ls-tree','-r','--name-only',sourceRef,'app','lib','components','native','modules','plugins','patches','index.js','index.share.js').trim().split(/\r?\n/);
const assignments=[];
for(const file of trackedRuntimeFiles.filter(f=>/\.(?:[cm]?js|tsx?|swift|mm?|kt|patch)$/.test(f))) {
  const text=source(file);
  if(/(?:global\.)?process\.env\s*=|process\.env\.GEMINI_API_KEY\s*=|babelTransformerPath|transform-inline-environment-variables/.test(text))assignments.push(file);
}
assert.deepEqual(assignments,[]);
const sourcePaths=['babel.config.js','metro.config.js','eas.json','app.config.js','lib/aiExtractPlace.ts'];
const report={testedAt:new Date().toISOString(),kind:'tracked-client-environment-static-and-transform-check',sourceRef,versions,
  passed:5,failed:0,tests:[
    'Installed Expo/Babel/Metro/RN versions match exact public-source lockfile.',
    'Production iOS Babel transform inlines public sentinel but leaves bare GEMINI_API_KEY lookup; private build sentinel never enters output.',
    'Actual Metro production prelude plus transformed code yields undefined Gemini key in fresh JS runtime.',
    'Actual Expo development prelude also excludes non-EXPO_PUBLIC key.',
    'Tracked runtime/plugin/patch source has no process.env replacement, Gemini key assignment or custom environment-inline transformer.'
  ],sourceHashes:Object.fromEntries(sourcePaths.map(f=>[f,createHash('sha256').update(source(f)).digest('hex')])),
  providerCalls:0,cloudMutations:[],
  conclusion:'Strong conditional evidence that the tracked clean standard build does not supply the legacy direct-client Gemini key. Not an attestation of actual Build55 uploaded source cleanliness, unavailable signed/OTA bundles, all older cached updates or native runtime tampering. Global zero-provider-dispatch gate remains unproved.'};
writeFileSync('artifacts/global-release/final-production/backend/legacy-client-environment-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(`PASS ${report.passed} offline source/transform checks. No provider/network requests. Global signed-client closure not claimed.`);
