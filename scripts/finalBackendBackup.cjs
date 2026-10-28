/** Authorized read-only Production backup to ACL-restricted ignored local disk.
 * No remote schema/data mutations. Does not execute any generated shell script.
 */
const {command,targets,save,output}=require('./finalBackendReadiness.cjs');
const {spawnSync}=require('node:child_process');
const {mkdirSync,readFileSync,statSync,existsSync,openSync,closeSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const target=targets.production;
const dir=join(output,'.tmp/private-production-backup');
const path=join(dir,'production-20261028.dump');
// Refuse reruns before credential retrieval or any attempt to touch the archive.
if(existsSync(path))throw new Error('Backup destination already exists; archive preserved. Choose a new reviewed destination.');
mkdirSync(dir,{recursive:true});
const who=spawnSync('whoami',[],{encoding:'utf8',timeout:10000,windowsHide:true}).stdout.trim();
const acl=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',`${who}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F'],{encoding:'utf8',timeout:10000,windowsHide:true});
if(!who||acl.status!==0)throw new Error('Private ACL setup failed');
const script=command('supabase',['db','dump','--linked','--dry-run','--workdir',target.cwd],target.cwd);
const env={...process.env,PGCONNECT_TIMEOUT:'15'};
for(const line of script.split(/\r?\n/)){
  const m=line.match(/^\s*(?:export\s+)?(PG[A-Z_]+)=(.*)$/);if(!m)continue;
  let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
  if(v.includes('$(')||v.includes('`'))throw new Error('Refuse shell-expanded connection value');
  env[m[1]]=v;
}
if(!env.PGHOST||!env.PGUSER||!env.PGPASSWORD||!env.PGDATABASE)throw new Error('Incomplete dump credential');
if(!(env.PGHOST===`db.${target.ref}.supabase.co`||(env.PGHOST.endsWith('.pooler.supabase.com')&&env.PGUSER.endsWith(`.${target.ref}`))))throw new Error('Refuse unexpected dump target');
const report={startedAt:new Date().toISOString(),kind:'private-read-only-production-database-backup',target:target.ref,privateFile:path,aclRestricted:true,format:'PostgreSQL custom archive',remoteMutation:false,storageObjectBytesIncluded:false,includesAllDatabaseSchemas:true,aclIncluded:true,rolesAndOwnershipRestorationQualified:false};
// Atomic exclusive creation also closes the race after the initial existence
// check. pg_dump writes its custom archive to this already-open descriptor;
// it never receives a filename that it could reopen or truncate.
const archiveFd=openSync(path,'wx',0o600);
let dump;
try{
  dump=spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',['--format=custom','--role=postgres','--no-owner','--lock-wait-timeout=10s'],{env,encoding:'utf8',timeout:150000,maxBuffer:1024*1024,windowsHide:true,stdio:['ignore',archiveFd,'pipe']});
}finally{closeSync(archiveFd);}
report.dumpExit=dump.status;
if(dump.status!==0){report.passed=false;report.errorCategory=dump.stderr.includes('permission denied')?'database_privilege_missing':dump.stderr.includes('password authentication')?'database_authentication':dump.error?'process_timeout_or_error':'pg_dump_failed';report.deniedObject=(dump.stderr.match(/permission denied for (?:table|schema|sequence) ([a-zA-Z0-9_.]+)/)||[])[1]??null;save('backup-receipt.json',report);console.log(JSON.stringify(report));process.exitCode=1;}
else{
  const data=readFileSync(path);report.bytes=statSync(path).size;report.sha256=createHash('sha256').update(data).digest('hex');
  const list=spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_restore.exe',['--list',path],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:8*1024*1024});
  report.archiveReadable=list.status===0;report.tableDataEntries=(list.stdout.match(/ TABLE DATA /g)||[]).length;report.completedAt=new Date().toISOString();report.passed=list.status===0;
  save('backup-receipt.json',report);console.log(JSON.stringify(report));
}
