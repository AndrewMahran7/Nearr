/** One authorized Development function deployment; no secret or policy writes. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..');
const {command,json,sql}=require(path.join(root,'scripts/finalBackendReadiness.cjs'));
const target={ref:'qnfxnmvxpjzfydgudtvs',cwd:'C:/Users/andre/.codex/worktrees/nearr-app-store-final/Nearr'};
const expectedCommit='b7b59ab366fb0227dd3f035bf7786676c39ba320';
const tables=['place_find_wallets','place_find_lots','place_find_ledger','place_find_purchase_transactions','nearr_plus_customers','nearr_plus_entitlements','nearr_plus_recognitions','nearr_plus_webhook_events','nearr_paid_purchase_states','nearr_paid_recovery_receipts','nearr_paid_finds'];
const fingerprintQuery=tables.map(t=>`select '${t}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${t} t) q`).join(' union all ');
const report={startedAt:new Date().toISOString(),target:target.ref,sourceCommit:expectedCommit,scope:['plus-api'],productionMutation:false,secretWrites:false,mappingWrites:false,passed:false};
const out=path.join(__dirname,report.startedAt.replace(/[:.]/g,'-')+'-development-plus-api');fs.mkdirSync(out);
const save=()=>fs.writeFileSync(path.join(out,'deployment-receipt.json'),JSON.stringify(report,null,2)+'\n');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function snapshot(){return {
  capturedAt:new Date().toISOString(),
  config:sql(target,'select to_jsonb(c) as config from public.nearr_plus_config c'),
  policy:sql(target,'select to_jsonb(p) as policy from public.global_release_policy p'),
  legacy:sql(target,'select to_jsonb(c) as config from public.token_monetization_config c'),
  financialFingerprints:sql(target,fingerprintQuery),
  walletTotals:sql(target,'select count(*)::integer as wallets,coalesce(sum(available_uses),0) as available_uses,coalesce(sum(reserved_uses),0) as reserved_uses from public.place_find_wallets'),
  migrationCount:sql(target,'select count(*)::integer as count from supabase_migrations.schema_migrations')[0].count,
  edge:json('supabase',['functions','list','--project-ref',target.ref,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()})).sort((a,b)=>a.name.localeCompare(b.name)),
};}
function closed(s){const c=s.config[0]?.config,p=s.policy[0]?.policy;return s.config.length===1&&s.policy.length===1&&c.release_mode==='paid'&&c.environment==='SANDBOX'&&['sales_enabled','enforce_allowance','release_qualified','catalog_verified','token_catalog_verified','paid_find_policy_enabled','legacy_obligations_reconciled'].every(k=>c[k]===false)&&['legal_approved','recognition_qualified','purchase_qualified'].every(k=>p[k]===false)&&p.provider_route==='disabled';}
async function main(){
  if(command('git',['rev-parse','HEAD']).trim()!==expectedCommit||command('git',['branch','--show-current']).trim()!=='release/nearr-1.7-paid-launch-final')throw Error('Unexpected source branch or commit');
  if(command('git',['diff','HEAD','--','supabase/functions','lib','scripts','app.config.js','package.json']).trim())throw Error('Deploy source differs from reviewed commit');
  report.sourceHashes=Object.fromEntries(['supabase/functions/plus-api/index.ts','scripts/deployFunctions.mjs','scripts/devTarget.mjs'].map(f=>[f,hash(f)]));
  report.before=snapshot();save();if(!closed(report.before))throw Error('Activation state is not closed');
  report.configTriggers=sql(target,"select t.tgname,pg_get_triggerdef(t.oid) as definition,pg_get_functiondef(t.tgfoid) as function_definition from pg_trigger t where t.tgrelid='public.nearr_plus_config'::regclass and not t.tgisinternal order by t.tgname");save();
  const args=['scripts/deployFunctions.mjs','plus-api','--project-ref',target.ref,'--yes'];
  report.command={executable:'node',args};report.deployStartedAt=new Date().toISOString();save();
  const d=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
  const log=(d.stdout||'')+(d.stderr||'');fs.writeFileSync(path.join(out,'deployment.log'),log);
  report.deployExitCode=d.status;report.deployLogSha256=crypto.createHash('sha256').update(log).digest('hex');report.deployFinishedAt=new Date().toISOString();save();
  if(d.status!==0)throw Error('plus-api deploy failed; inspect bounded deployment log');
  report.after=snapshot();
  const pre=report.before.edge.find(f=>f.name==='plus-api'),post=report.after.edge.find(f=>f.name==='plus-api');
  report.onlyIntendedFunctionChanged=same(report.before.edge.filter(f=>f.name!=='plus-api'),report.after.edge.filter(f=>f.name!=='plus-api'));
  report.deploymentVersionAdvanced=post?.version>pre?.version&&post?.status==='ACTIVE'&&post?.verifyJwt===true;
  report.financialUnchanged=same(report.before.financialFingerprints,report.after.financialFingerprints)&&same(report.before.walletTotals,report.after.walletTotals);
  report.configurationUnchanged=['config','policy','legacy','migrationCount'].every(k=>same(report.before[k],report.after[k]));
  if(!report.onlyIntendedFunctionChanged||!report.deploymentVersionAdvanced||!report.financialUnchanged||!report.configurationUnchanged||!closed(report.after))throw Error('Post-deployment invariant mismatch; do not redeploy');
  const r=spawnSync(process.execPath,['scripts/readPaidDevelopment.cjs'],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true,env:{...process.env,NEARR_LINKED_DEV_WORKDIR:target.cwd}});
  fs.writeFileSync(path.join(out,'readback.log'),(r.stdout||'')+(r.stderr||''));report.readbackExitCode=r.status;
  if(r.status!==0)throw Error('Readback suite failed');
  fs.copyFileSync(path.join(root,'artifacts/global-release/paid-launch/development-paid-readback.json'),path.join(out,'development-paid-readback.json'));
  const denied=await fetch(`https://${target.ref}.supabase.co/functions/v1/plus-api`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"status"}',signal:AbortSignal.timeout(15000)});await denied.body?.cancel();
  report.plusApiUnauthenticatedProbe={method:'POST',status:denied.status,expected:401};if(denied.status!==401)throw Error('Expected unauthenticated plus-api denial');
  report.passed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({receipt:path.relative(root,path.join(out,'deployment-receipt.json')),passed:true,plusApi:post,financialUnchanged:true,configurationUnchanged:true,deniedProbe:report.plusApiUnauthenticatedProbe}));
}
main().catch(e=>{report.error=e.message;report.finishedAt=new Date().toISOString();save();console.error(e.message);process.exitCode=1;});
