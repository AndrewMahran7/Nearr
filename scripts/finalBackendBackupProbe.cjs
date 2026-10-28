/** Probe available read-only pg_dump connection without displaying credentials. */
const {command,targets,save,output}=require('./finalBackendReadiness.cjs');
const {spawnSync}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const crypto=require('node:crypto');
const dir=join(output,'.tmp/private-production-backup');mkdirSync(dir,{recursive:true});
const who=spawnSync('whoami',[],{encoding:'utf8',timeout:10000,windowsHide:true}).stdout.trim();
if(!who)throw new Error('Cannot resolve current identity');
const acl=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',`${who}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F'],{encoding:'utf8',timeout:10000,windowsHide:true});
if(acl.status!==0)throw new Error('Cannot restrict private backup directory');
const script=command('supabase',['db','dump','--linked','--dry-run','--workdir',targets.production.cwd],targets.production.cwd);
// This generated script can contain credentials. It is intentionally NOT saved.
const exported=[...script.matchAll(/(?:export\s+)?(PG[A-Z_]+)=(.+)/g)].map(m=>m[1]);
const report={capturedAt:new Date().toISOString(),target:targets.production.ref,privateDirectory:dir,aclRestricted:true,connectionVariableNames:[...new Set(exported)],scriptBytes:Buffer.byteLength(script),scriptSha256:crypto.createHash('sha256').update(script).digest('hex'),dumpFlags:script.split(/\r?\n/).filter(line=>/^\s*--[a-z-]+/.test(line)),remoteMutation:false};
save('backup-connection-probe.json',report);console.log(JSON.stringify(report));
