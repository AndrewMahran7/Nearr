/** Exact Development-only paid-schema qualification. Default rolls back every
 * DDL/config write; --apply requires migration bytes committed at HEAD.
 * Never enables sales, recognition, catalog or the paid-find policy. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { command, json, sql } = require('./finalBackendReadiness.cjs');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(a => a !== '--apply')) throw new Error('Only --apply is supported');
const target = { ref:'qnfxnmvxpjzfydgudtvs',cwd:process.env.NEARR_LINKED_DEV_WORKDIR || process.cwd() };
if (fs.readFileSync(path.join(target.cwd,'supabase/.temp/project-ref'),'utf8').trim() !== target.ref) throw new Error('Unexpected Development link');
const files = ['20261028000001_nearr_free_only_release.sql','20261029000003_unlimited_plus_paid_finds.sql','20261029000004_recognition_commit_authorization.sql'];
const literal = s => "'" + s.replace(/'/g,"''") + "'";
const normalized = s => s.replace(/\r\n/g,'\n');
const sources = files.map(file => {
  const source = fs.readFileSync(path.join('supabase/migrations',file),'utf8');
  if (apply && normalized(command('git',['show',`HEAD:supabase/migrations/${file}`])) !== normalized(source)) throw new Error('Uncommitted migration: '+file);
  return { file,version:file.split('_')[0],source,sha256:crypto.createHash('sha256').update(source).digest('hex') };
});
const before = sql(target,'select version from supabase_migrations.schema_migrations order by version').map(r=>r.version);
if (!before.includes('20261029000002') || sources.some(m=>before.includes(m.version))) throw new Error('Unexpected migration baseline; inspect instead of replaying');
const protectedTables = ['place_find_wallets','place_find_lots','place_find_ledger','place_find_purchase_transactions','nearr_plus_entitlements','nearr_plus_recognitions'];
const fingerprintQuery = protectedTables.map(table => `select '${table}' as relation,count(*)::bigint as rows,md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as checksum from (select md5(to_jsonb(t)::text) as row_hash from public.${table} t) q`).join(' union all ');
const beforeFingerprints = sql(target,fingerprintQuery);
const protectedPolicy = sql(target,'select to_jsonb(p) as policy from global_release_policy p');
if (protectedPolicy.length!==1 || ['legal_approved','recognition_qualified','purchase_qualified'].some(k=>protectedPolicy[0].policy[k]!==false)) throw new Error('Unexpected qualified Development policy');
const ddl = sources.map(m => m.source + `\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(m.version)},${literal(m.file.replace(/^\d+_/,'').replace(/\.sql$/,''))},array[${literal(m.source)}]);`).join('\n');
const guard = `
do $qualification$
declare u jsonb;
begin
  if exists(select * from paid_protected_before except select * from (${fingerprintQuery}) current_financial)
    or exists(select * from (${fingerprintQuery}) current_financial except select * from paid_protected_before) then
    raise exception 'paid_deployment_changed_historical_financial_rows'; end if;
  if exists(select 1 from public.nearr_plus_config where sales_enabled or enforce_allowance or release_qualified or catalog_verified or token_catalog_verified or paid_find_policy_enabled or release_mode<>'paid') then
    raise exception 'paid_deployment_enabled_unqualified_billing'; end if;
  if exists(select 1 from public.global_release_policy where legal_approved or recognition_qualified or purchase_qualified or provider_route<>'disabled') then
    raise exception 'paid_deployment_changed_provider_policy'; end if;
  -- Exercise the real schema's read path without creating an account or grant.
  u:=public.nearr_paid_usage('00000000-0000-0000-0000-000000000000');
  if u#>>'{free,limit}' is distinct from '3' or u->>'unlimited' is distinct from 'false' or u#>>'{tokens,available}' is distinct from '0' then
    raise exception 'paid_deployment_usage_contract_mismatch'; end if;
  if public.nearr_paid_recent_purchases('00000000-0000-0000-0000-000000000000') is distinct from '[]'::jsonb then
    raise exception 'paid_deployment_purchase_ownership_mismatch'; end if;
  if has_function_privilege('authenticated','public.apply_nearr_paid_purchase(uuid,jsonb)','execute') or has_function_privilege('anon','public.apply_nearr_paid_recovery(uuid,jsonb)','execute') then
    raise exception 'paid_deployment_privilege_mismatch'; end if;
  if has_function_privilege('authenticated','public.resolve_share_job_pre_commit_guard(uuid,uuid)','execute')
    or has_function_privilege('service_role','public.require_current_recognition_commit(uuid)','execute')
    or not has_function_privilege('authenticated','public.resolve_share_job(uuid,uuid)','execute') then
    raise exception 'recognition_commit_guard_privilege_mismatch'; end if;
end $qualification$;
`;
const query = `begin; set local lock_timeout='5s'; set local statement_timeout='30s'; select pg_advisory_xact_lock(17912903);\ncreate temporary table paid_protected_before on commit drop as ${fingerprintQuery};\n${ddl}\n${guard}\n${apply?'commit':'rollback'};`;
const scratch = path.resolve('.tmp',`paid-development-${apply?'apply':'rollback'}-${Date.now()}.sql`);
fs.mkdirSync(path.dirname(scratch),{recursive:true});fs.writeFileSync(scratch,query);
command('supabase',['db','query','--linked','--file',scratch,'-o','json'],target.cwd);
const after = sql(target,'select version from supabase_migrations.schema_migrations order by version').map(r=>r.version);
const afterFingerprints = sql(target,fingerprintQuery);
const policyUnchanged = JSON.stringify(protectedPolicy)===JSON.stringify(sql(target,'select to_jsonb(p) as policy from global_release_policy p'));
const historyUnchanged = JSON.stringify(beforeFingerprints)===JSON.stringify(afterFingerprints);
const correctLedger = apply ? sources.every(m=>after.includes(m.version)) : JSON.stringify(before)===JSON.stringify(after);
if (!policyUnchanged || !historyUnchanged || !correctLedger) throw new Error('Post-operation readback mismatch; inspect without rerunning');
const receipt = { testedAt:new Date().toISOString(),mode:apply?'development-disabled-deployment':'development-transactional-rollback-qualification',target:target.ref,sourceCommit:command('git',['rev-parse','HEAD']).trim(),migrations:sources.map(({source,...m})=>m),beforeCount:before.length,afterCount:after.length,policyUnchanged,historyUnchanged,financialFingerprints:afterFingerprints,productionMutation:false,purchasesActivated:false,providerCalls:false,passed:true };
fs.mkdirSync('artifacts/global-release/paid-launch',{recursive:true});fs.writeFileSync(`artifacts/global-release/paid-launch/development-paid-${apply?'deployment':'qualification'}.json`,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
