/** Production containment discovery. Remote operations are READ ONLY.
 * No user rows, tokens, cron commands or provider requests are emitted.
 */
const { targets, json, sql, output, command } = require('./finalBackendReadiness.cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const target = targets.production;
const destination = join(output, 'containment');
async function main() {
  const report = { capturedAt: new Date().toISOString(), source: command('git', ['rev-parse','HEAD']).trim(), ref: target.ref, mutations: [] };
  report.columns = sql(target,"select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('share_jobs','share_media_tasks') order by table_name,ordinal_position");
  report.queueFunctions = sql(target,"select proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like '%claim%' or proname like '%media_task%' or proname='create_share_job_for_user') order by proname,args");
  report.queueTriggers = sql(target,"select c.relname relation,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('share_jobs','share_media_tasks') and not t.tgisinternal order by c.relname,t.tgname");
  report.counts = sql(target,"select (select count(*) from auth.users) users,(select count(*) from saved_places) saves,(select count(*) from saved_place_sources) sources,(select count(*) from share_jobs) jobs,(select count(*) from share_media_tasks) tasks");
  report.queue = sql(target,"select 'share_jobs' relation,status,count(*)::integer count from share_jobs group by status union all select 'share_media_tasks',status,count(*)::integer from share_media_tasks group by status order by relation,status");
  report.ownership = sql(target,"select 'saved_places' relation,md5(coalesce(string_agg(id::text||':'||user_id::text,',' order by id),'')) ownership_hash from saved_places union all select 'saved_place_sources',md5(coalesce(string_agg(id::text||':'||user_id::text||':'||saved_place_id::text,',' order by id),'')) from saved_place_sources");
  report.edge = json('supabase',['functions','list','--project-ref',target.ref,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256}));
  report.jobs = sql(target,"select jobid,jobname,schedule,active,md5(command) command_hash from cron.job order by jobid");
  report.endpoints = [];
  for (const path of ['/health','/ready']) {
    const r=await fetch(`https://${target.domain}${path}`,{signal:AbortSignal.timeout(15000)});
    report.endpoints.push({path,status:r.status,body:await r.json()});
  }
  mkdirSync(destination,{recursive:true});
  const filename = `preflight-${report.capturedAt.replace(/[:.]/g,'-')}.json`;
  writeFileSync(join(destination,filename),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({file:filename,counts:report.counts,queue:report.queue,queueFunctions:report.queueFunctions.map(f=>({name:f.proname,args:f.args})),columns:report.columns,edge:report.edge,endpoints:report.endpoints.map(e=>({path:e.path,status:e.status}))},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
