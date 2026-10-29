/** Fixed Development readback and unauthenticated, non-dispatching boot probes. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { command, json, sql } = require('./finalBackendReadiness.cjs');
const target = { ref:'qnfxnmvxpjzfydgudtvs', cwd:process.env.NEARR_LINKED_DEV_WORKDIR || process.cwd() };
const folder = 'artifacts/global-release/paid-launch';
const names = ['plus-api','revenuecat-plus-webhook','create-share-job','process-share-jobs','process-share-link'];
async function main() {
  const deployment = JSON.parse(fs.readFileSync(`${folder}/development-paid-deployment.json`,'utf8'));
  if (deployment.target !== target.ref || deployment.passed !== true) throw Error('Missing qualified Development deployment');
  const config = sql(target,'select release_mode,subscription_benefit,product_id,environment,sales_enabled,enforce_allowance,release_qualified,catalog_verified,token_catalog_verified,paid_find_policy_enabled,legacy_obligations_reconciled from nearr_plus_config');
  const policy = sql(target,'select legal_approved,recognition_qualified,purchase_qualified,provider_route from global_release_policy');
  if (config.length !== 1 || policy.length !== 1 || config[0].release_mode !== 'paid' || config[0].subscription_benefit !== 'unlimited'
    || ['sales_enabled','enforce_allowance','release_qualified','catalog_verified','token_catalog_verified','paid_find_policy_enabled'].some(k=>config[0][k]!==false)
    || ['legal_approved','recognition_qualified','purchase_qualified'].some(k=>policy[0][k]!==false) || policy[0].provider_route !== 'disabled') throw Error('Unexpected activation state');
  const before = deployment.financialFingerprints;
  const allowed = new Set(['place_find_wallets','place_find_lots','place_find_ledger','place_find_purchase_transactions','nearr_plus_entitlements','nearr_plus_recognitions']);
  if (before.length !== allowed.size || before.some(row=>!allowed.has(row.relation))) throw Error('Unexpected fingerprint scope');
  const query = before.map(({relation})=>`select '${relation}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${relation} t) q`).join(' union all ');
  const financial = sql(target,query);
  if (JSON.stringify(before)!==JSON.stringify(financial)) throw Error('Historical financial rows changed; inspect before proceeding');
  const triggers = sql(target,"select c.relname as relation,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgname in ('worker_recognition_commit_guard','legacy_eligibility_recognition_parent') order by c.relname,t.tgname");
  if (triggers.length!==5) throw Error('Missing recognition commit guards');
  const edge = json('supabase',['functions','list','--project-ref',target.ref,'-o','json']).filter(f=>names.includes(f.name)).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()}));
  if (edge.length!==5 || edge.some(f=>f.status!=='ACTIVE')) throw Error('Edge function not active');
  const probes = await Promise.all(names.map(async name=>{
    const method = ['revenuecat-plus-webhook','process-share-jobs'].includes(name)?'POST':'OPTIONS';
    const response = await fetch(`https://${target.ref}.supabase.co/functions/v1/${name}`, { method, signal:AbortSignal.timeout(15000), ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{}) });
    await response.body?.cancel();
    return {name,method,status:response.status,expected:method==='POST'?401:200};
  }));
  const result = {capturedAt:new Date().toISOString(),target:target.ref,sourceCommit:command('git',['rev-parse','HEAD']).trim(),migrationCount:sql(target,'select count(*)::integer as count from supabase_migrations.schema_migrations')[0].count,config,policy,triggers,financialUnchanged:true,financialFingerprints:financial,edge,probes,sourceHashes:Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(`supabase/functions/${name}/index.ts`)).digest('hex')])),providerCalls:false,purchasesActivated:false,productionMutation:false,passed:probes.every(p=>p.status===p.expected)};
  fs.writeFileSync(`${folder}/development-paid-readback.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:result.passed,migrationCount:result.migrationCount,edge,probes}));
  if (!result.passed) throw Error('Development boot/auth probe failed');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
