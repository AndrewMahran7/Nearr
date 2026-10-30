/** Read-only fixed Development snapshot during synthetic native fixture capture. */
const fs=require('node:fs');const path=require('node:path');const {command,json,sql}=require(path.resolve(__dirname,'../../../../scripts/finalBackendReadiness.cjs'));
const root=path.resolve(__dirname,'../../../..');
const target={ref:'qnfxnmvxpjzfydgudtvs',cwd:'C:/Users/andre/.codex/worktrees/nearr-app-store-final/Nearr'};
const baselineFile=path.join(__dirname,'2026-10-29T23-42-53-320Z-test-webhook/post-dashboard-resend-readback.json');
const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
if(!baseline.passed||baseline.target!==target.ref)throw Error('Qualified post-TEST baseline required');
const tables=['place_find_wallets','place_find_lots','place_find_ledger','place_find_purchase_transactions','nearr_plus_customers','nearr_plus_entitlements','nearr_plus_recognitions','nearr_plus_webhook_events','nearr_paid_purchase_states','nearr_paid_recovery_receipts','nearr_paid_finds'];
const fp=tables.map(t=>`select '${t}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${t} t) q`).join(' union all ');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const report={startedAt:new Date().toISOString(),kind:'post-native-startup-read-only-development-snapshot',target:target.ref,sourceCommit:command('git',['rev-parse','HEAD']).trim(),baseline:path.relative(root,baselineFile),baselineFinishedAt:baseline.finishedAt,scopeLimitation:'Captured during continuing synthetic fixture matrix, after native startup; not a claim about frames or actions after this timestamp.',mutations:[],httpProbes:false,customerApiRequests:false,passed:false};
const file=path.join(__dirname,report.startedAt.replace(/[:.]/g,'-')+'-post-native-development-readback.json');
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
try{
  report.config=sql(target,'select to_jsonb(c) as config from public.nearr_plus_config c');
  report.policy=sql(target,'select to_jsonb(p) as policy from public.global_release_policy p');
  report.legacy=sql(target,'select to_jsonb(c) as config from public.token_monetization_config c');
  report.financialFingerprints=sql(target,fp);
  report.walletTotals=sql(target,'select count(*)::integer as wallets,coalesce(sum(available_uses),0) as available_uses,coalesce(sum(reserved_uses),0) as reserved_uses from public.place_find_wallets');
  report.migrationCount=sql(target,'select count(*)::integer as count from supabase_migrations.schema_migrations')[0].count;
  report.edge=json('supabase',['functions','list','--project-ref',target.ref,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()})).sort((a,b)=>a.name.localeCompare(b.name));
  report.allElevenFinancialFingerprintsUnchanged=report.financialFingerprints.length===11&&same(baseline.after.financialFingerprints,report.financialFingerprints);
  report.walletTotalsUnchanged=same(baseline.after.walletTotals,report.walletTotals);
  report.configPolicyLegacyUnchanged=['config','policy','legacy'].every(k=>same(baseline.after[k],report[k]));
  report.migrationsUnchanged=report.migrationCount===baseline.after.migrationCount;
  report.allEdgeVersionsSourcesUnchanged=same(baseline.after.edge,report.edge);
  report.newPaidTablesEmpty=report.financialFingerprints.filter(r=>r.relation.startsWith('nearr_')).every(r=>Number(r.rows)===0);
  const c=report.config[0]?.config,p=report.policy[0]?.policy;
  report.allGatesClosed=report.config.length===1&&report.policy.length===1&&['sales_enabled','enforce_allowance','release_qualified','catalog_verified','token_catalog_verified','paid_find_policy_enabled','legacy_obligations_reconciled'].every(k=>c[k]===false)&&['legal_approved','recognition_qualified','purchase_qualified'].every(k=>p[k]===false)&&p.provider_route==='disabled';
  report.passed=['allElevenFinancialFingerprintsUnchanged','walletTotalsUnchanged','configPolicyLegacyUnchanged','migrationsUnchanged','allEdgeVersionsSourcesUnchanged','newPaidTablesEmpty','allGatesClosed'].every(k=>report[k]===true);report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({receipt:path.relative(root,file),startedAt:report.startedAt,finishedAt:report.finishedAt,passed:report.passed,allElevenFinancialFingerprintsUnchanged:report.allElevenFinancialFingerprintsUnchanged,walletTotals:report.walletTotals,newPaidTablesEmpty:report.newPaidTablesEmpty,allGatesClosed:report.allGatesClosed,versions:report.edge.filter(f=>['plus-api','revenuecat-plus-webhook'].includes(f.name)).map(f=>({name:f.name,version:f.version,status:f.status}))}));if(!report.passed)process.exitCode=1;
}catch(e){report.error=e.message;report.finishedAt=new Date().toISOString();save();console.error(e.message);process.exitCode=1;}
