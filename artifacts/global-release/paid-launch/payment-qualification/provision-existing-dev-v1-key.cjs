/** Explicit existing public Apple credential -> V1 server slot, Development only.
 * CLI output with environment values stays in memory and is never logged. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');const {command,json}=require(path.join(root,'scripts/finalBackendReadiness.cjs'));
const target='qnfxnmvxpjzfydgudtvs',name='REVENUECAT_SECRET_API_KEY';
const expectedHash='9386e4290b7daeac2bc5d7221a4e1765b216dbad785651c67b099a2057453f31';
const folder=path.join(__dirname,'2026-10-29T23-11-11-920Z-development-plus-api');
const mapping=JSON.parse(fs.readFileSync(path.join(folder,'catalog-mapping-receipt.json'),'utf8'));
if(!mapping.passed||mapping.target!==target||mapping.mapping.revenuecat_app_id!=='app7434757255')throw Error('Verified Development Apple mapping required');
const report={startedAt:new Date().toISOString(),target,secretName:name,source:'Existing EAS Development EXPO_PUBLIC_REVENUECAT_IOS_API_KEY; coordinator verified matching Apple app public SDK key.',newRevenueCatKeyCreated:false,v2CredentialConfigured:false,productionMutation:false,customerApiProbe:false,passed:false};
const save=()=>fs.writeFileSync(path.join(folder,'v1-credential-receipt.json'),JSON.stringify(report,null,2)+'\n');
let privateDir,envFile;
async function main(){
  if(command('git',['rev-parse','HEAD']).trim()!==mapping.sourceCommit)throw Error('Unexpected source commit');
  const before=json('supabase',['secrets','list','--project-ref',target,'-o','json']);
  report.namePresentBefore=before.some(s=>s.name===name);if(report.namePresentBefore)throw Error('V1 slot already exists; inspect before replacing');
  let captured=command('eas',['env:list','development','--format','short','--scope','project']);
  const matches=[...captured.matchAll(/^\s*EXPO_PUBLIC_REVENUECAT_IOS_API_KEY\s*=\s*([^\r\n]+)\s*$/gm)];
  if(matches.length!==1)throw Error('Expected exactly one EAS public Apple credential');
  let key=matches[0][1].trim();if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
  if(!/^appl_[A-Za-z0-9]+$/.test(key)||crypto.createHash('sha256').update(key).digest('hex')!==expectedHash)throw Error('Public Apple credential format/hash mismatch; value omitted');
  captured='';report.sourceFormatAndApprovedHashMatch=true;
  privateDir=path.join(root,'.tmp',`payment-v1-${Date.now()}`);fs.mkdirSync(privateDir,{recursive:false});
  const sid=command('whoami',['/user','/fo','csv','/nh']).match(/S-1-5-[0-9-]+/)?.[0];if(!sid)throw Error('Unable to establish task private ACL');
  command('icacls',[privateDir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
  envFile=path.join(privateDir,'revenuecat-v1.env');
  command('git',['check-ignore','--quiet','--',path.relative(root,envFile)]);
  fs.writeFileSync(envFile,`${name}=${key}\n`,{flag:'wx',mode:0o600});key='';
  report.privateFileIgnored=true;report.privateAclRestricted=true;save();
  command('supabase',['secrets','set','--project-ref',target,'--env-file',envFile]);report.provisionedAt=new Date().toISOString();
  fs.unlinkSync(envFile);envFile=undefined;fs.rmdirSync(privateDir);privateDir=undefined;report.privateFileRemoved=true;
  const after=json('supabase',['secrets','list','--project-ref',target,'-o','json']);
  report.namePresentAfter=after.some(s=>s.name===name);
  report.requiredNamePresence=Object.fromEntries([name,'REVENUECAT_V2_SECRET_API_KEY','REVENUECAT_WEBHOOK_SECRET'].map(n=>[n,after.some(s=>s.name===n)]));
  const oldNames=new Set(before.map(s=>s.name));report.addedNames=after.map(s=>s.name).filter(n=>!oldNames.has(n)).sort();
  const removed=before.filter(s=>!after.some(a=>a.name===s.name));if(removed.length||!report.namePresentAfter)throw Error('Unexpected secret inventory after provision');
  const response=await fetch(`https://${target}.supabase.co/functions/v1/plus-api`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"status"}',signal:AbortSignal.timeout(15000)});await response.body?.cancel();
  report.unauthenticatedProbe={method:'POST',status:response.status,expected:401};if(response.status!==401)throw Error('Unexpected plus-api unauthenticated response');
  report.passed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));
}
main().catch(e=>{report.error=e.message;report.finishedAt=new Date().toISOString();save();console.error(e.message);process.exitCode=1;}).finally(()=>{if(envFile&&fs.existsSync(envFile)){fs.unlinkSync(envFile);report.privateFileRemoved=true;}if(privateDir&&fs.existsSync(privateDir)&&fs.readdirSync(privateDir).length===0)fs.rmdirSync(privateDir);save();});
