/** Fixed Development webhook deployment and later read-only dashboard-test reconciliation. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..');const {command,json,sql}=require(path.join(root,'scripts/finalBackendReadiness.cjs'));
const target={ref:'qnfxnmvxpjzfydgudtvs',cwd:'C:/Users/andre/.codex/worktrees/nearr-app-store-final/Nearr'};
const expectedCommit='63600e88734d212d4cbe92b8a4ee6382e0cdf40d',functionName='revenuecat-plus-webhook';
const expectedSourceHash='7797b769cbca56a46f96acde5039349ed7be246d32b08b9d1a23cf1309969d6d';
const mode=process.argv[2];if(!['deploy','after-resend'].includes(mode))throw Error('Explicit deploy or after-resend phase required');
const startedAt=new Date().toISOString();
const folder=mode==='deploy'?path.join(__dirname,startedAt.replace(/[:.]/g,'-')+'-test-webhook'):path.resolve(process.argv[3]||'');
if(!folder.startsWith(__dirname+path.sep)||!folder.endsWith('-test-webhook'))throw Error('Expected task-owned test-webhook evidence folder');
if(mode==='deploy')fs.mkdirSync(folder);else if(!fs.existsSync(folder))throw Error('Existing qualified deployment evidence required');
const out=path.join(folder,mode==='deploy'?'deployment-receipt.json':'post-dashboard-resend-readback.json');if(fs.existsSync(out))throw Error('Refuse existing receipt overwrite');
const report={startedAt,target:target.ref,mode,sourceCommit:expectedCommit,productionMutation:false,purchasesActivated:false,providerCalls:false,secretWrites:false,financialWrites:false,realStoreKitTransactions:false,passed:false};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const tables=['place_find_wallets','place_find_lots','place_find_ledger','place_find_purchase_transactions','nearr_plus_customers','nearr_plus_entitlements','nearr_plus_recognitions','nearr_plus_webhook_events','nearr_paid_purchase_states','nearr_paid_recovery_receipts','nearr_paid_finds'];
const fp=tables.map(t=>`select '${t}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${t} t) q`).join(' union all ');
const edge=()=>json('supabase',['functions','list','--project-ref',target.ref,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()})).sort((a,b)=>a.name.localeCompare(b.name));
function snapshot(){return{capturedAt:new Date().toISOString(),config:sql(target,'select to_jsonb(c) as config from public.nearr_plus_config c'),policy:sql(target,'select to_jsonb(p) as policy from public.global_release_policy p'),legacy:sql(target,'select to_jsonb(c) as config from public.token_monetization_config c'),financialFingerprints:sql(target,fp),walletTotals:sql(target,'select count(*)::integer as wallets,coalesce(sum(available_uses),0) as available_uses,coalesce(sum(reserved_uses),0) as reserved_uses from public.place_find_wallets'),migrationCount:sql(target,'select count(*)::integer as count from supabase_migrations.schema_migrations')[0].count,edge:edge()};}
function closed(s){const c=s.config[0]?.config,p=s.policy[0]?.policy;return s.config.length===1&&s.policy.length===1&&c.environment==='SANDBOX'&&c.release_mode==='paid'&&['sales_enabled','enforce_allowance','release_qualified','catalog_verified','token_catalog_verified','paid_find_policy_enabled','legacy_obligations_reconciled'].every(k=>c[k]===false)&&['legal_approved','recognition_qualified','purchase_qualified'].every(k=>p[k]===false)&&p.provider_route==='disabled';}
async function main(){
  if(command('git',['rev-parse','HEAD']).trim()!==expectedCommit||command('git',['branch','--show-current']).trim()!=='release/nearr-1.7-paid-launch-final')throw Error('Unexpected qualified source');
  if(command('git',['diff','HEAD','--','supabase/functions','lib','scripts','package.json']).trim())throw Error('Uncommitted deployment source');
  const localHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/functions',functionName,'index.ts'))).digest('hex');if(localHash!==expectedSourceHash)throw Error('Qualified webhook source hash mismatch');report.entrypointSha256=localHash;
  if(mode==='deploy'){
    report.before=snapshot();if(!closed(report.before))throw Error('Activation state is not closed');save();
    const args=['scripts/deployFunctions.mjs',functionName,'--project-ref',target.ref,'--yes'];report.command={executable:'node',args};report.deployStartedAt=new Date().toISOString();save();
    const d=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});const log=(d.stdout||'')+(d.stderr||'');fs.writeFileSync(path.join(folder,'deployment.log'),log);report.deployExitCode=d.status;report.deployLogSha256=crypto.createHash('sha256').update(log).digest('hex');report.deployFinishedAt=new Date().toISOString();save();if(d.status!==0)throw Error('Webhook deployment failed; do not replay');
    const live=edge().find(f=>f.name===functionName);report.activeReadback=live;save();if(live?.status!=='ACTIVE'||live.verifyJwt!==false||live.version<=report.before.edge.find(f=>f.name===functionName).version)throw Error('Webhook did not become active with expected verification');
    console.log(JSON.stringify({phase:'webhook-active',evidenceFolder:path.relative(root,folder),function:live,sourceCommit:expectedCommit}));
  }else{
    const deployment=JSON.parse(fs.readFileSync(path.join(folder,'deployment-receipt.json'),'utf8'));if(!deployment.passed||deployment.target!==target.ref||deployment.sourceCommit!==expectedCommit)throw Error('Qualified deployment receipt required');report.before=deployment.after;report.coordinatorDashboardResendConfirmed=true;report.scope='Read-only after coordinator confirmed real RevenueCat dashboard resend; not a StoreKit purchase';
  }
  report.after=snapshot();report.financialUnchanged=['financialFingerprints','walletTotals'].every(k=>same(report.before[k],report.after[k]));report.configurationUnchanged=['config','policy','legacy','migrationCount'].every(k=>same(report.before[k],report.after[k]));report.allGatesClosed=closed(report.after);
  report.otherEdgeFunctionsUnchanged=same(report.before.edge.filter(f=>f.name!==functionName),report.after.edge.filter(f=>f.name!==functionName));
  report.webhook=report.after.edge.find(f=>f.name===functionName);
  if(mode==='after-resend')report.webhookSourceUnchanged=same(report.before.edge.find(f=>f.name===functionName),report.webhook);
  const response=await fetch(`https://${target.ref}.supabase.co/functions/v1/${functionName}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});await response.body?.cancel();report.unauthenticatedProbe={status:response.status,expected:401};
  report.passed=report.financialUnchanged&&report.configurationUnchanged&&report.allGatesClosed&&report.otherEdgeFunctionsUnchanged&&report.webhook.status==='ACTIVE'&&report.webhook.verifyJwt===false&&response.status===401&&(mode!=='after-resend'||report.webhookSourceUnchanged);report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({receipt:path.relative(root,out),passed:report.passed,mode,webhook:report.webhook,financialUnchanged:report.financialUnchanged,configurationUnchanged:report.configurationUnchanged,allGatesClosed:report.allGatesClosed,otherEdgeFunctionsUnchanged:report.otherEdgeFunctionsUnchanged}));if(!report.passed)process.exitCode=1;
}
main().catch(e=>{report.error=e.message;report.finishedAt=new Date().toISOString();save();console.error(e.message);process.exitCode=1;});
