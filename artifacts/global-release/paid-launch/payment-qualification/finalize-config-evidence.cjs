const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');
const dir=path.join(__dirname,'2026-10-29T22-55-25-703Z');
const original=JSON.parse(fs.readFileSync(path.join(dir,'regression-receipt.json'),'utf8'));
const retry=JSON.parse(fs.readFileSync(path.join(dir,'client-runtime-retry-receipt.json'),'utf8'));
const failed=original.phases.filter(p=>!p.passed);
if(failed.length!==1||failed[0].name!=='test-paid-client-runtime')throw Error('Unexpected failed phase');
const failedLog=fs.readFileSync(path.join(dir,'test-paid-client-runtime.log'),'utf8');
if(!failedLog.includes("UNKNOWN: unknown error, open")||!failedLog.includes('runtime-tests.json'))throw Error('Unexpected original failure');
const passed=original.phases.filter(p=>p.name!=='test-paid-client-runtime').every(p=>p.passed)&&retry.passed&&retry.exitCode===0&&original.diffCheck.passed;
const sourceHashes=Object.fromEntries(Object.keys(original.sourceHashes).map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
if(JSON.stringify(sourceHashes)!==JSON.stringify(original.sourceHashes))throw Error('Tested source changed after run');
fs.copyFileSync(path.join(root,'artifacts/global-release/paid-launch/client/runtime-tests.json'),path.join(dir,'client-runtime-tests.json'));
const result={capturedAt:new Date().toISOString(),sourceCommitBeforeFix:original.sourceCommit,sourceHashes,passed,
  originalRun:'regression-receipt.json',originalFailure:{phase:failed[0].name,exitCode:failed[0].exitCode,reason:'Windows UNKNOWN opening runtime-tests.json receipt file after assertions; original log retained'},
  retry:'client-runtime-retry-receipt.json',results:{configToSdk:14,edgeCredentialRouting:8,clientGroups:16,clientRenders:110,prebuildPrerequisiteCommands:19,prebuildMainCommands:114,typecheck:true,diffCheck:true},
  liveStoreKitTransactions:0,remoteMutation:false,developmentRedeployRequired:['plus-api'],productionMutation:false};
fs.writeFileSync(path.join(dir,'final-config-qualification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed,sourceHashes}));if(!passed)process.exitCode=1;
