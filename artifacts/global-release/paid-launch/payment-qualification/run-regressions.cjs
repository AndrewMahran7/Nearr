/** Payment-session evidence only. No deployment, policy write, or purchase. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const startedAt = new Date().toISOString();
const output = path.join(__dirname, startedAt.replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npm)) throw Error('Installed npm entry unavailable');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8',windowsHide:true}).trim();
const configFix=process.argv.includes('--config-fix');
const historical = 'artifacts/global-release/paid-launch/development-paid-readback.json';
if(!configFix)fs.copyFileSync(path.join(root,historical), path.join(output,'previous-development-readback.json'));
const files=['app.config.js','.env.example','package.json','lib/plusClient.ts','supabase/functions/plus-api/index.ts','scripts/testRevenueCatConfig.ts','scripts/testPaidApiCredentials.ts'];
const receipt = {startedAt, sourceCommit, kind:configFix?'post-payment-configuration-fix-regressions':'real-local-regressions-and-read-only-development', productionAccess:false, activation:false, providerCalls:false, storeKitTransactions:0, sourceHashes:Object.fromEntries(files.filter(f=>fs.existsSync(path.join(root,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),phases:[]};
function save() { fs.writeFileSync(path.join(output,'regression-receipt.json'),JSON.stringify(receipt,null,2)+'\n'); }
function copyRecord(relative, name) { if (fs.existsSync(path.join(root,relative))) fs.copyFileSync(path.join(root,relative),path.join(output,name)); }
async function run(name,args,extraEnv={}) {
  const log = path.join(output,name+'.log');
  const record = {name,command:args[0]===npm?'npm '+args.slice(1).join(' '):'node '+args.join(' '),startedAt:new Date().toISOString(),log:path.basename(log)};
  receipt.phases.push(record);save();console.log(JSON.stringify({phase:name,status:'started',output}));
  const fd=fs.openSync(log,'wx');
  try {
    record.exitCode=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,...extraEnv}});
      child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(Error('Test process terminated')):resolve(code));
    });
  } catch(error) { record.error=String(error.message);record.exitCode=-1; }
  finally { fs.closeSync(fd); }
  record.finishedAt=new Date().toISOString();record.passed=record.exitCode===0;
  record.sha256=crypto.createHash('sha256').update(fs.readFileSync(log)).digest('hex');save();
  console.log(JSON.stringify({phase:name,passed:record.passed,exitCode:record.exitCode}));
  return record.passed;
}
async function main() {
  if(!configFix){
    await run('development-readback',['scripts/readPaidDevelopment.cjs'],{NEARR_LINKED_DEV_WORKDIR:'C:\\Users\\andre\\.codex\\worktrees\\nearr-app-store-final\\Nearr'});
    copyRecord(historical,'development-readback.json');
  }else{
    await run('test-paid-client-runtime',['node_modules/ts-node/dist/bin.js','-P','scripts/tsconfig.json','scripts/testPaidFindsClientRuntime.ts']);
  }
  for (const script of (configFix?['test:paid-config','test:prebuild','typecheck']:['test:prebuild','test:paid-launch','test:consent-identity','test:recognition-consent','test:global-eligibility-db','test:exact-identity-safety','test:safe-development','typecheck','test:monetization-token-ux','test:localization','test:native-localization'])) {
    await run(script.replace(/:/g,'-'),[npm,'run',script]);
  }
  const status = execFileSync('git',['diff','--check'],{cwd:root,encoding:'utf8',windowsHide:true});
  receipt.diffCheck={passed:true,output:status.trim()};
  const records = {
    'artifacts/global-release/paid-launch/paid-find-database-tests.json':'paid-find-database-tests.json',
    'artifacts/global-release/paid-launch/tests/recognition-commit-authorization.json':'recognition-commit-authorization.json',
    'artifacts/global-release/eligibility-database-tests.json':'eligibility-database-tests.json',
    // Retained source-hash evidence is clearly labeled. This session's actual
    // rerun results are the timestamped phase log and regression receipt.
    'artifacts/global-release/paid-launch/tests/purchase-verification-receipt.json':'retained-purchase-verification-receipt.json',
    'artifacts/global-release/paid-launch/tests/paid-entitlement-refresh-receipt.json':'retained-paid-entitlement-refresh-receipt.json',
  };
  if(!configFix)for(const [from,to] of Object.entries(records))copyRecord(from,to);
  receipt.finishedAt=new Date().toISOString();receipt.passed=receipt.phases.every(p=>p.passed)&&receipt.diffCheck.passed;save();
  console.log(JSON.stringify({passed:receipt.passed,output,phases:receipt.phases.map(p=>({name:p.name,passed:p.passed,exitCode:p.exitCode}))}));
  if(!receipt.passed)process.exitCode=1;
}
main().catch(error=>{receipt.finishedAt=new Date().toISOString();receipt.passed=false;receipt.error=error.message;save();console.error(error.message);process.exitCode=1;});
