// Read-only inspection of the actual public production OTA. Never print keys,
// manifest fragments, signed URLs, raw bytecode or disassembly.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const out = path.resolve('artifacts/global-release/final-production/backend');
const sha = b => createHash('sha256').update(b).digest('hex');
function eas(args) {
  const result = spawnSync('cmd.exe', ['/d','/s','/c',`eas ${args} --json`], {
    encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8*1024*1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
  });
  assert.equal(result.status, 0, 'eas_read_only_lookup_failed');
  return JSON.parse(result.stdout);
}
async function boundedFetch(url, maximum, stage) {
  assert.equal(new URL(url).protocol, 'https:');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000),
    headers: stage==='manifest'?{ Accept: 'multipart/mixed, application/expo+json, application/json', 'expo-protocol-version': '1', 'expo-platform': 'ios' }:{} });
  assert.equal(response.status, 200, `${stage}_http_${response.status}_host_${new URL(url).host}`);
  const chunks=[]; let size=0;
  for await (const chunk of response.body) { size+=chunk.length; assert.ok(size<=maximum, 'artifact_too_large'); chunks.push(chunk); }
  return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type')??'' };
}
async function main() {
  const raw = eas('channel:view production');
  const channel = raw.currentPage ?? raw;
  assert.equal(channel.name, 'production'); assert.equal(channel.isPaused, false);
  const mapping = JSON.parse(channel.branchMapping);
  assert.equal(mapping.data.length, 1); assert.equal(mapping.data[0].branchMappingLogic, 'true');
  const branch = channel.updateBranches.find(b=>b.id===mapping.data[0].branchId);
  assert.equal(branch.name, 'production');
  const updates = branch.updateGroups.flat();
  const update = updates.find(u=>u.platform==='ios'&&u.runtimeVersion==='1.4.55');
  assert.ok(update, 'matching_update_missing');
  assert.equal(update.id,'01a0849a-63a3-76ff-b495-e1b766edc03e');
  const fetchedManifest = await boundedFetch(update.manifestPermalink, 1024*1024,'manifest');
  let manifestText=fetchedManifest.bytes.toString('utf8');
  if(fetchedManifest.contentType.includes('multipart/mixed')) {
    const boundary=fetchedManifest.contentType.match(/boundary="?([^";]+)"?/)?.[1]; assert.ok(boundary,'multipart_boundary_missing');
    const parts=manifestText.split(`--${boundary}`);
    const part=parts.find(p=>/name="manifest"/.test(p)); assert.ok(part,'manifest_part_missing');
    manifestText=part.slice(part.indexOf('\r\n\r\n')+4).trim();
  }
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.id, update.id);
  const build=eas('build:view a61830e1-432d-4fec-b0e9-11ea7a69826a');
  const metadata={checkedAt:new Date().toISOString(),readOnly:true,channel:{id:channel.id,name:channel.name,isPaused:channel.isPaused,branchId:branch.id,branchName:branch.name},
    update:{id:update.id,group:update.group,runtimeVersion:update.runtimeVersion,gitCommitHash:update.gitCommitHash,
      isGitWorkingTreeDirty:update.isGitWorkingTreeDirty,createdAt:update.createdAt,isRollBackToEmbedded:update.isRollBackToEmbedded},
    build:{id:build.id,gitCommitHash:build.gitCommitHash,isGitWorkingTreeDirty:build.isGitWorkingTreeDirty??null,
      appVersion:build.appVersion,appBuildVersion:build.appBuildVersion,fieldNames:Object.keys(build)}};
  let bytes;
  try { ({bytes}=await boundedFetch(manifest.launchAsset.url,64*1024*1024,'launch_asset')); }
  catch(error) {
    const failure={...metadata,manifestFetched:true,manifestUpdateIdVerified:true,launchAssetInspected:false,
      launchAssetHost:new URL(manifest.launchAsset.url).host,failure:String(error.message).split('\n')[0],
      geminiManifestFieldNames:Object.keys(manifest.extra?.expoClient?.extra??{}).filter(k=>/gemini|anthropic|openai/i.test(k)),
      realInferenceCalls:0,cloudMutations:[],caveat:'Manifest metadata is verified, but inaccessible launch asset prevents actual bundle inspection. No key values or URLs recorded.'};
    writeFileSync(path.join(out,'legacy-production-ota-inspection.json'),JSON.stringify(failure,null,2)+'\n');
    console.log(JSON.stringify(failure,null,2)); process.exitCode=1; return;
  }
  const encodedHash = createHash('sha256').update(bytes).digest('base64url');
  assert.equal(encodedHash, manifest.launchAsset.hash, 'manifest_asset_hash_mismatch');
  const privateDir = path.join(out,'.tmp/private-legacy-ota'); mkdirSync(privateDir,{recursive:true});
  if(process.platform==='win32') {
    const who=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true,timeout:5000});
    const sid=who.stdout?.match(/S-1-5-[0-9-]+/)?.[0]; assert.ok(sid);
    const acl=spawnSync('icacls.exe',[privateDir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,timeout:5000});
    assert.equal(acl.status,0,'private_directory_acl_failed');
  }
  const bundlePath=path.join(privateDir, `${sha(bytes)}.hbc`); writeFileSync(bundlePath,bytes);
  const disassembly=spawnSync(path.resolve('node_modules/react-native/sdks/hermesc/win64-bin/hermesc.exe'),['-dump-bytecode',bundlePath],{
    encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:100*1024*1024 });
  const dump=disassembly.status===0?disassembly.stdout:'';
  if(dump)writeFileSync(path.join(privateDir,`${sha(bytes)}.bytecode.txt`),dump);
  const binaryText=bytes.toString('latin1');
  const extra=manifest.extra?.expoClient?.extra??{};
  const receipt={...metadata,
    bundle:{size:bytes.length,sha256:sha(bytes),manifestHashVerified:true,disassemblySucceeded:disassembly.status===0,
      containsGeminiEnvIdentifier:binaryText.includes('GEMINI_API_KEY'),containsGeminiEndpoint:binaryText.includes('generativelanguage.googleapis.com'),
      distinctGoogleFormatKeyCount:new Set(binaryText.match(/AIza[0-9A-Za-z_-]{35}/g)??[]).size,
      geminiManifestFieldNames:Object.keys(extra).filter(k=>/gemini|anthropic|openai/i.test(k)),
      disassemblyErrorKind:disassembly.status===0?null:/version/i.test(disassembly.stderr??'')?'bytecode_version_mismatch':'disassembler_rejected'},
    realInferenceCalls:0,cloudMutations:[],
    caveat:'Actual latest OTA inspected; not an inspection of the unavailable embedded signed Build55 or every cached prior update. No key values, signed URLs or raw dump included.'};
  writeFileSync(path.join(out,'legacy-production-ota-inspection.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}
main().catch(error=>{console.error(error?.code==='ETIMEDOUT'?'inspection_timed_out':error.message);process.exitCode=1;});
