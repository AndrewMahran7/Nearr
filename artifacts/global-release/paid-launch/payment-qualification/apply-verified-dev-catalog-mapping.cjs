/** Fixed, coordinator-authorized Apple mapping only; gates stay closed. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');
const {command,sql}=require(path.join(root,'scripts/finalBackendReadiness.cjs'));
const target={ref:'qnfxnmvxpjzfydgudtvs',cwd:'C:/Users/andre/.codex/worktrees/nearr-app-store-final/Nearr'};
const folder=path.join(__dirname,'2026-10-29T23-11-11-920Z-development-plus-api');
const deployment=JSON.parse(fs.readFileSync(path.join(folder,'deployment-receipt.json'),'utf8'));
if(!deployment.passed||deployment.target!==target.ref||command('git',['rev-parse','HEAD']).trim()!==deployment.sourceCommit)throw Error('Qualified source/deployment required');
if(fs.readFileSync(path.join(target.cwd,'supabase/.temp/project-ref'),'utf8').trim()!==target.ref)throw Error('Unexpected linked Development target');
const receipt={startedAt:new Date().toISOString(),target:target.ref,sourceCommit:deployment.sourceCommit,authority:'Coordinator verified Apple RevenueCat app and exact product mappings; authorized only these three mapping fields with activation flags false.',productionMutation:false,secretWrites:false,purchasesActivated:false,providerCalls:false,passed:false};
const save=()=>fs.writeFileSync(path.join(folder,'catalog-mapping-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const keys=['revenuecat_app_id','revenuecat_project_id','revenuecat_token_product_ids'];
const mapping={revenuecat_app_id:'app7434757255',revenuecat_project_id:'proj7d727ef6',revenuecat_token_product_ids:{'com.nearr.tokens.20.v2':'prodd6ac7e45d4','com.nearr.tokens.50.v2':'prodc41f2e9dd5','com.nearr.tokens.200.v2':'prod394420f4e2'}};
const tables=deployment.after.financialFingerprints.map(r=>r.relation);
if(tables.some(t=>!/^nearr_(?:plus|paid)_|^place_find_/.test(t)))throw Error('Unexpected financial table');
const fp=tables.map(t=>`select '${t}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${t} t) q`).join(' union all ');
const literal=s=>"'"+s.replace(/'/g,"''")+"'";
const j=v=>literal(JSON.stringify(v))+'::jsonb';
function read(){return {config:sql(target,'select to_jsonb(c) as config from public.nearr_plus_config c'),policy:sql(target,'select to_jsonb(p) as policy from public.global_release_policy p'),legacy:sql(target,'select to_jsonb(c) as config from public.token_monetization_config c'),financialFingerprints:sql(target,fp),walletTotals:sql(target,'select count(*)::integer as wallets,coalesce(sum(available_uses),0) as available_uses,coalesce(sum(reserved_uses),0) as reserved_uses from public.place_find_wallets')};}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function withoutMappings(c){return Object.fromEntries(Object.entries(c).filter(([k])=>!keys.includes(k)));}
try{
  receipt.before=read();receipt.mapping=mapping;save();
  for(const k of ['config','policy','legacy','financialFingerprints','walletTotals'])if(!same(receipt.before[k],deployment.after[k]))throw Error('State changed since qualified deployment; inspect instead of overwriting');
  const expected=receipt.before.config[0].config;
  if(expected.revenuecat_app_id!==null||expected.revenuecat_project_id!==null||JSON.stringify(expected.revenuecat_token_product_ids)!=='{}')throw Error('Expected empty new Apple mapping');
  const query=`begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
select public.nearr_paid_lock();
select id from public.nearr_plus_config where id for update;
select singleton from public.global_release_policy where singleton for share;
select environment_name from public.token_monetization_config for share;
create temporary table mapping_financial_before on commit drop as ${fp};
do $guard$
declare written integer;
begin
  if (select count(*) from public.nearr_plus_config)<>1 or (select to_jsonb(c) from public.nearr_plus_config c where id) is distinct from ${j(expected)} then raise exception 'mapping_unexpected_config'; end if;
  if exists(select 1 from public.nearr_plus_config where sales_enabled or enforce_allowance or release_qualified or catalog_verified or token_catalog_verified or paid_find_policy_enabled or legacy_obligations_reconciled or environment<>'SANDBOX' or release_mode<>'paid') then raise exception 'mapping_activation_not_closed'; end if;
  if (select to_jsonb(p) from public.global_release_policy p where singleton) is distinct from ${j(receipt.before.policy[0].policy)} then raise exception 'mapping_global_policy_changed'; end if;
  if exists(select 1 from public.global_release_policy where legal_approved or recognition_qualified or purchase_qualified or provider_route<>'disabled') then raise exception 'mapping_global_activation_not_closed'; end if;
  update public.nearr_plus_config set revenuecat_app_id=${literal(mapping.revenuecat_app_id)},revenuecat_project_id=${literal(mapping.revenuecat_project_id)},revenuecat_token_product_ids=${j(mapping.revenuecat_token_product_ids)} where id;
  get diagnostics written=row_count; if written<>1 then raise exception 'mapping_row_count'; end if;
  if (select to_jsonb(c)-array['revenuecat_app_id','revenuecat_project_id','revenuecat_token_product_ids'] from public.nearr_plus_config c where id) is distinct from ${j(withoutMappings(expected))} then raise exception 'mapping_unintended_config_change'; end if;
  if exists(select * from mapping_financial_before except select * from (${fp}) f) or exists(select * from (${fp}) f except select * from mapping_financial_before) then raise exception 'mapping_changed_financial_rows'; end if;
end $guard$;
commit;
`;
  const file=path.join(folder,'catalog-mapping.sql');fs.writeFileSync(file,query);receipt.sqlSha256=crypto.createHash('sha256').update(query).digest('hex');save();
  command('supabase',['db','query','--linked','--file',file,'-o','json'],target.cwd);receipt.committedAt=new Date().toISOString();save();
  receipt.after=read();
  const actual=receipt.after.config[0].config;
  receipt.onlyMappingFieldsChanged=same(withoutMappings(expected),withoutMappings(actual));
  receipt.mappingMatches=keys.every(k=>same(actual[k],mapping[k])||(k==='revenuecat_token_product_ids'&&Object.keys(mapping[k]).every(p=>actual[k][p]===mapping[k][p])&&Object.keys(actual[k]).length===3));
  receipt.financialUnchanged=['financialFingerprints','walletTotals'].every(k=>same(receipt.before[k],receipt.after[k]));
  receipt.policyAndLegacyUnchanged=['policy','legacy'].every(k=>same(receipt.before[k],receipt.after[k]));
  if(!receipt.onlyMappingFieldsChanged||!receipt.mappingMatches||!receipt.financialUnchanged||!receipt.policyAndLegacyUnchanged)throw Error('Post-mapping readback mismatch; do not retry');
  receipt.passed=true;receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({receipt:path.relative(root,path.join(folder,'catalog-mapping-receipt.json')),passed:true,mapping,onlyMappingFieldsChanged:true,financialUnchanged:true,policyAndLegacyUnchanged:true}));
}catch(e){receipt.error=e.message;receipt.finishedAt=new Date().toISOString();save();console.error(e.message);process.exitCode=1;}
