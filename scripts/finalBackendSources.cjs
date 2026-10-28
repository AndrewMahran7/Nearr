/** Recover deployed Edge source into ignored local scratch; hash and compare.
 * All remote operations are downloads/reads. Does not deploy or alter link state.
 */
const { targets, command, save, output, root }=require('./finalBackendReadiness.cjs');
const { mkdirSync,readFileSync,existsSync,readdirSync }=require('node:fs');
const { join,relative }=require('node:path');
const { createHash }=require('node:crypto');
function hash(text){return createHash('sha256').update(text).digest('hex');}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
const result={capturedAt:new Date().toISOString(),kind:'deployed-edge-source-recovery',environments:{}};
for(const [name,target] of Object.entries(targets)){
  const cwd=join(output,'.tmp',name);mkdirSync(cwd,{recursive:true});
  const wanted=name==='development'?['create-share-job','process-share-link','process-share-jobs','plus-api','revenuecat-plus-webhook']:['create-share-job','process-share-link','process-share-jobs','monetization'];
  const recovered=[];
  for(const fn of wanted){
    let downloadCompleted=true;
    try { command('supabase',['functions','download',fn,'--project-ref',target.ref,'--use-api','--workdir',cwd]); }
    catch { downloadCompleted=false; }
    const entry=join(cwd,'supabase/functions',fn,'index.ts');
    if(!existsSync(entry)){recovered.push({name:fn,downloadCompleted:false,entryRecovered:false});continue;}
    const raw=readFileSync(entry,'utf8'),local=readFileSync(join(root,'supabase/functions',fn,'index.ts'),'utf8');
    recovered.push({name:fn,downloadCompleted,entryRecovered:true,relativePath:relative(root,entry).replaceAll('\\','/'),downloadedSha256:hash(raw),localSha256:hash(local),equalLfNormalized:raw.replaceAll('\r\n','\n')===local.replaceAll('\r\n','\n'),observedEligibilitySymbols:['checkAgeEligibility','account_ai_access_reason','is_account_eligible_for_ai','global-v1'].filter(symbol=>raw.includes(symbol))});
    console.log(JSON.stringify({environment:name,function:fn,recovered:true,equalLfNormalized:recovered.at(-1).equalLfNormalized}));
  }
  result.environments[name]={ref:target.ref,functions:recovered,files:files(join(cwd,'supabase/functions')).map(file=>({relativePath:relative(cwd,file).replaceAll('\\','/'),sha256:hash(readFileSync(file))}))};
  save('edge-source-recovery.json',result);
}
result.finishedAt=new Date().toISOString();save('edge-source-recovery.json',result);
