/** Read-only Production-only migration recovery and ownership/RLS receipts. */
const {targets,sql,save,output,root,command}=require('./finalBackendReadiness.cjs');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const baseline=JSON.parse(readFileSync(join(output,'live-readiness.json'),'utf8'));
const extras=baseline.environments.production.remoteMigrationsNotInLocal;
if(extras.some(m=>!/^\d{14}$/.test(m.version)))throw new Error('Invalid migration identifier');
const recovered=sql(targets.production,`select version,name,statements from supabase_migrations.schema_migrations where version in (${extras.map(m=>`'${m.version}'`).join(',')}) order by version`);
const dir=join(output,'.tmp/production-extra-migrations');mkdirSync(dir,{recursive:true});
const report={capturedAt:new Date().toISOString(),kind:'read-only-migration-and-ownership-reconciliation',productionOnlyMigrations:[],ownership:{},preservationGuards:{}};
for(const row of recovered){
  const text=(row.statements??[]).join(';\n')+';\n';
  if(!/^[a-zA-Z0-9_]+$/.test(row.name))throw new Error('Invalid migration name');
  const file=`${row.version}_${row.name}.sql`;writeFileSync(join(dir,file),text);
  report.productionOnlyMigrations.push({version:row.version,name:row.name,statementCount:row.statements?.length??0,sha256:createHash('sha256').update(text).digest('hex'),recoveredLocalPath:`artifacts/global-release/final-production/backend/.tmp/production-extra-migrations/${file}`,objects:[...new Set([...text.matchAll(/(?:function|table|trigger)\s+(?:if\s+not\s+exists\s+)?((?:public|auth)\.[a-zA-Z0-9_]+)/gi)].map(m=>m[1]))]});
}
for(const [name,target] of Object.entries(targets)){
  report.ownership[name]=sql(target,"select 'saved_places' as relation,count(*)::integer as row_count,md5(coalesce(string_agg(id::text||':'||user_id::text||':'||place_id::text,'|' order by id),'')) as ownership_md5 from public.saved_places union all select 'saved_place_sources',count(*)::integer,md5(coalesce(string_agg(id::text||':'||saved_place_id::text||':'||user_id::text,'|' order by id),'')) from public.saved_place_sources");
  report.preservationGuards[name]=sql(target,"select t.tgname,c.relname,pg_get_triggerdef(t.oid,true) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and c.relname in ('saved_places','saved_place_sources','share_jobs','share_media_tasks') order by c.relname,t.tgname");
}
report.workerSource={productionSource:'e9daf499cfb276ea7072b651642a04218b90ccf9',productionTree:command('git',['rev-parse','e9daf499cfb276ea7072b651642a04218b90ccf9:services/media-worker']).trim(),qualifiedDevelopmentSource:'9f2b1299824b2f7102fd3443da7d3a888f4d8c94',qualifiedDevelopmentTree:command('git',['rev-parse','9f2b1299824b2f7102fd3443da7d3a888f4d8c94:services/media-worker']).trim(),currentTree:command('git',['rev-parse','HEAD:services/media-worker']).trim(),changedFiles:command('git',['diff','--name-only','e9daf499cfb276ea7072b651642a04218b90ccf9','HEAD','--','services/media-worker']).trim().split(/\r?\n/)};
report.finishedAt=new Date().toISOString();save('migration-preservation-evidence.json',report);
console.log(JSON.stringify({recoveredMigrations:report.productionOnlyMigrations.length,ownership:report.ownership,workerFilesChanged:report.workerSource.changedFiles.length}));
