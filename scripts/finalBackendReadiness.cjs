/** Fixed-scope READ-ONLY final release reconciliation. No writes to either backend.
 * Secrets are captured in memory by the existing CLI and never serialized.
 * Generated evidence contains aggregate/schema/config metadata only.
 */
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, readdirSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const { resolveCli } = require('./lib/cliRunner');
const root = resolve(__dirname, '..');
const output = join(root, 'artifacts/global-release/final-production/backend');
const project = '4037a3b5-d66f-409e-b734-56c22c244e3e';
const targets = {
  development: { ref:'qnfxnmvxpjzfydgudtvs', environment:'57d055b7-5326-4f96-a7a9-70523ee0d3f0', service:'3c8cd190-b118-4ee4-9338-407843ef4e1f', domain:'media-worker-development.up.railway.app', cwd:root },
  production: { ref:'rlqvxdwtetxsqxhqztkw', environment:'49650a9c-4744-4649-8cd1-4ff38473d22f', service:'59234570-e2ec-4a7e-86de-22826da86c66', domain:'nearr-production.up.railway.app', cwd:join(output,'.tmp/production') },
};
function command(name,args,cwd=root) {
  const cli=resolveCli(name); if (!cli) throw new Error(`${name} unavailable`);
  const r=spawnSync(cli.file,[...cli.prefixArgs,...args],{cwd,encoding:'utf8',timeout:45000,maxBuffer:12*1024*1024,windowsHide:true,env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.5.5',RAILWAY_AGENT_SESSION:'nearr-final-backend-20261028'}});
  if(r.status!==0) throw new Error(`${name} ${args[0]} failed (status ${r.status}); inspect privately`);
  return r.stdout;
}
function json(name,args,cwd) { const raw=command(name,args,cwd); const p=raw.search(/[[{]/); return JSON.parse(raw.slice(p)); }
function sql(target,query) {
  const linked=readFileSync(join(target.cwd,'supabase/.temp/project-ref'),'utf8').trim();
  if(linked!==target.ref) throw new Error('Refuse unexpected linked SQL target');
  return json('supabase',['db','query','--linked',`begin read only; ${query}; commit;`,'-o','json'],target.cwd).rows;
}
function save(name,value) { mkdirSync(output,{recursive:true});writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n'); }
async function endpoint(target,path) {
  try { const r=await fetch(`https://${target.domain}${path}`,{signal:AbortSignal.timeout(15000)}); const t=await r.text(); let body;try{body=JSON.parse(t);}catch{body={nonJson:true};}return{path,status:r.status,body}; }
  catch { return {path,transportError:true}; }
}
function safeVars(vars) {
  const names=Object.keys(vars).sort();
  return { flags:Object.fromEntries(names.filter(n=>n.endsWith('_ENABLED')).map(n=>[n,vars[n]])), routes:Object.fromEntries(['MEDIA_ANALYSIS_PROVIDER','MEDIA_TRANSCRIPTION_PROVIDER','MEDIA_OCR_PROVIDER','NEARR_ALLOWED_PROVIDER_ROUTE','GEMINI_MODEL','MEDIA_TRANSCRIPTION_MODEL'].filter(n=>n in vars).map(n=>[n,vars[n]])), supabaseUrl:vars.SUPABASE_URL, secretPresence:Object.fromEntries(names.filter(n=>/KEY|SECRET/.test(n)).map(n=>[n,Boolean(vars[n])])) };
}
async function snapshot() {
  const report={capturedAt:new Date().toISOString(),kind:'read-only-live-backend-reconciliation',source:command('git',['rev-parse','HEAD']).trim(),workerTree:command('git',['rev-parse','HEAD:services/media-worker']).trim(),mutations:[],environments:{}};
  const local=readdirSync(join(root,'supabase/migrations')).filter(n=>/^\d+.*\.sql$/.test(n)).map(file=>({version:file.split('_')[0],file,sha256:createHash('sha256').update(readFileSync(join(root,'supabase/migrations',file))).digest('hex')}));
  for (const [name,t] of Object.entries(targets)) {
    const out={ref:t.ref,railway:{project,environment:t.environment,service:t.service}}; report.environments[name]=out;
    const vars=json('railway',['variables','--project',project,'--environment',t.environment,'--service',t.service,'--json']);
    if(vars.SUPABASE_URL!==`https://${t.ref}.supabase.co`) throw new Error('Unexpected backend target');
    out.railway.configuration=safeVars(vars);
    const deps=json('railway',['deployment','list','--project',project,'--environment',t.environment,'--service',t.service,'--limit','3','--json']);
    out.railway.deployments=deps.map(d=>({id:d.id,status:d.status,createdAt:d.createdAt,meta:Object.fromEntries(['commitHash','commitMessage','branch','imageDigest','deploymentMessage'].filter(k=>d.meta?.[k]!==undefined).map(k=>[k,d.meta[k]]))}));
    out.endpoints=await Promise.all(['/health','/ready'].map(p=>endpoint(t,p)));
    out.edge=json('supabase',['functions','list','--project-ref',t.ref,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()}));
    out.migrations=sql(t,'select version,name from supabase_migrations.schema_migrations order by version');
    const remote=new Set(out.migrations.map(m=>m.version));
    out.localMigrationsNotApplied=local.filter(m=>!remote.has(m.version));
    out.remoteMigrationsNotInLocal=out.migrations.filter(m=>!local.some(l=>l.version===m.version));
    out.schema=sql(t,"select c.relname as table_name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('saved_places','saved_place_sources','share_jobs','share_media_tasks','account_eligibility_v2','account_processing_permissions','global_release_policy','eligibility_region_policy','nearr_plus_config','nearr_plus_entitlements','nearr_plus_webhook_events') order by c.relname");
    out.counts=sql(t,"select (select count(*) from auth.users) as auth_users,(select count(*) from public.saved_places) as saved_places,(select count(*) from public.share_jobs) as share_jobs,(select count(*) from public.share_media_tasks) as share_media_tasks");
    out.queue=sql(t,"select 'share_jobs' as relation,status,count(*)::integer as count from public.share_jobs group by status union all select 'share_media_tasks',status,count(*)::integer from public.share_media_tasks group by status order by relation,status");
    out.functions=sql(t,"select p.proname,pg_get_function_identity_arguments(p.oid) as args,p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%eligib%' or p.proname like '%permission%' or p.proname like '%plus%' or p.proname in ('claim_share_jobs','claim_share_media_tasks','account_ai_access_reason')) order by p.proname,args");
    if(out.schema.some(r=>r.table_name==='global_release_policy')) out.releasePolicy=sql(t,'select * from public.global_release_policy');
    if(out.schema.some(r=>r.table_name==='eligibility_region_policy')) out.regions=sql(t,'select * from public.eligibility_region_policy order by country_code');
    if(out.schema.some(r=>r.table_name==='nearr_plus_config')) out.plusConfig=sql(t,'select * from public.nearr_plus_config');
    if(name==='production') out.backupAvailability=json('supabase',['backups','list','--project-ref',t.ref,'-o','json']);
    save('live-readiness.json',report);
    console.log(JSON.stringify({environment:name,deployments:out.railway.deployments.map(d=>({id:d.id,status:d.status})),migrations:out.migrations.length,pending:out.localMigrationsNotApplied.length,endpoints:out.endpoints.map(e=>({path:e.path,status:e.status})),counts:out.counts}));
  }
  report.finishedAt=new Date().toISOString();save('live-readiness.json',report);
}
module.exports={targets,command,json,sql,save,output,root};
if(require.main===module) snapshot().catch(e=>{console.error(e.message);process.exitCode=1;});
