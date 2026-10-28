/** Restore the private dump only in a new, no-network disposable container.
 * Existing local databases and all remote infrastructure remain untouched.
 */
const {spawnSync}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {save,output}=require('./finalBackendReadiness.cjs');
const backup=JSON.parse(readFileSync(join(output,'backup-receipt.json'),'utf8'));
if(!backup.passed||backup.target!=='rlqvxdwtetxsqxhqztkw'||!backup.aclIncluded)throw new Error('Qualified private archive prerequisite missing');
if(createHash('sha256').update(readFileSync(backup.privateFile)).digest('hex')!==backup.sha256)throw new Error('Archive hash changed');
const name='nearr-final-restore-'+randomUUID().slice(0,8);
const image='public.ecr.aws/supabase/postgres:17.6.1.111';
const db='nearr_final_restore';
const result={startedAt:new Date().toISOString(),kind:'isolated-local-production-restore-rehearsal',image,containerName:name,network:'none',cpuLimit:1,memoryLimitMiB:640,archiveSha256:backup.sha256,remoteMutation:false,passed:false};
let started=false;
const docker=(args,timeout=30000,input)=>spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:8*1024*1024,input});
const sql=query=>{const r=docker(['exec','-i',name,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],30000,query);if(r.status!==0)throw new Error('local_sql_failed');return r.stdout.trim();};
(async()=>{
 try{
  if(docker(['image','inspect',image]).status!==0)throw new Error('local_matching_image_missing');
  const hba=join(output,'.tmp/private-production-backup',`${name}-pg-hba.conf`);
  const hbaContents='# Task-owned no-network restoration container only; no host ports.\nlocal all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n';
  // A fresh file inherits the already-restricted private-directory Windows ACL.
  // Never overwrite another attempt's file or accept wider authentication rules.
  try{writeFileSync(hba,hbaContents,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;if(readFileSync(hba,'utf8')!==hbaContents)throw new Error('isolated_hba_content_mismatch');}
  const launched=docker(['run','-d','--rm','--name',name,'--network','none','--cpus','1','--memory','640m','--mount',`type=bind,source=${hba},target=/etc/nearr-final-pg-hba.conf,readonly`,'-e',`POSTGRES_PASSWORD=${randomUUID()+randomUUID()}`,image,'postgres','-D','/etc/postgresql','-c','cron.launch_active_jobs=off','-c',`cron.database_name=${db}`,'-c','hba_file=/etc/nearr-final-pg-hba.conf']);
  if(launched.status!==0)throw new Error('isolated_container_start_failed');started=true;result.containerId=launched.stdout.trim();
  const deadline=Date.now()+60000;let ready=false;
  // The image temporarily accepts Unix-socket connections during initialization.
  // TCP readiness identifies the final server, avoiding the init shutdown race.
  while(Date.now()<deadline){const r=docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],10000);if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!ready)throw new Error('isolated_postgres_not_ready');
  const roleMetadata=JSON.parse(readFileSync(join(output,'.tmp/private-production-backup/roles-metadata.json'),'utf8'));
  const ident=name=>{if(!/^[a-zA-Z0-9_]+$/.test(name))throw new Error('Unrecognized role identifier');return `"${name}"`;};
  const bootstrapSql=roleMetadata.roles.map(role=>`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role.rolname}') THEN CREATE ROLE ${ident(role.rolname)} NOLOGIN ${role.rolinherit?'INHERIT':'NOINHERIT'} ${role.rolbypassrls?'BYPASSRLS':'NOBYPASSRLS'}; END IF; END $$;`).join('\n');
  // Preserve existing image superusers; missing platform roles are non-login.
  // Passwords and cluster authentication are deliberately not cloned.
  const roleSetup=docker(['exec','-i',name,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],30000,bootstrapSql);
  if(roleSetup.status!==0)throw new Error('isolated_role_bootstrap_failed');
  result.roleBootstrapCount=roleMetadata.roles.length;result.rolePasswordsRestored=false;result.roleMembershipsRestored=false;
  if(docker(['exec',name,'createdb','-U','supabase_admin','--template=template0',db]).status!==0)throw new Error('isolated_database_creation_failed');
  if(docker(['cp',backup.privateFile,`${name}:/tmp/nearr-production.dump`]).status!==0)throw new Error('private_archive_copy_failed');
  const restored=docker(['exec',name,'pg_restore','--exit-on-error','--no-owner','-U','supabase_admin','-d',db,'/tmp/nearr-production.dump'],120000);
  result.restoreExit=restored.status;
  // Errors may contain source rows; keep raw output only in the ACL-protected directory.
  if(restored.status!==0){writeFileSync(join(output,'.tmp/private-production-backup/restore-private-error.log'),restored.stderr||'');result.errorCategory='restore_failed';result.errorSummary=String(restored.stderr||'').split(/\r?\n/).filter(l=>/^pg_restore: error:/.test(l)).map(l=>l.slice(0,240));throw new Error('restore_failed');}
  result.counts=JSON.parse(sql("select json_build_object('auth_users',(select count(*) from auth.users),'saved_places',(select count(*) from public.saved_places),'saved_place_sources',(select count(*) from public.saved_place_sources),'share_jobs',(select count(*) from public.share_jobs),'share_media_tasks',(select count(*) from public.share_media_tasks),'migrations',(select count(*) from supabase_migrations.schema_migrations));"));
  result.ownership=JSON.parse(sql("select json_agg(x) from (select 'saved_places' as relation,count(*)::integer as row_count,md5(coalesce(string_agg(id::text||':'||user_id::text||':'||place_id::text,'|' order by id),'')) as ownership_md5 from public.saved_places union all select 'saved_place_sources',count(*)::integer,md5(coalesce(string_agg(id::text||':'||saved_place_id::text||':'||user_id::text,'|' order by id),'')) from public.saved_place_sources) x;"));
  const expected=JSON.parse(readFileSync(join(output,'migration-preservation-evidence.json'),'utf8')).ownership.production;
  result.ownershipMatches=expected.every(e=>result.ownership.some(r=>r.relation===e.relation&&r.row_count===e.row_count&&r.ownership_md5===e.ownership_md5));
  result.rls=JSON.parse(sql("select json_agg(x order by table_name) from (select c.relname as table_name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('saved_places','saved_place_sources','share_jobs','share_media_tasks')) x;"));
  result.passed=result.ownershipMatches&&result.rls.every(r=>r.rls);
 }catch(e){result.errorCategory??=e.message;}
 finally{
  if(started){const stopped=docker(['stop','--time','10',name],30000);result.containerStopped=stopped.status===0;result.containerRemoved=docker(['container','inspect',name]).status!==0;}
  result.finishedAt=new Date().toISOString();save('restore-receipt.json',result);console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
 }
})();
