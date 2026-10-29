/** Build only the three-file containment directory; isolated runtime, no secrets. */
const {spawnSync}=require('node:child_process');
const {readFileSync,readdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {output}=require('./finalBackendReadiness.cjs');
const dir=join(output,'containment/worker');
const name='nearr-containment-image-test-'+randomUUID().slice(0,8);
const tag=name+':local';
const result={startedAt:new Date().toISOString(),scope:'Exact three-file inert worker image; local Docker network-none runtime only',passed:false,remoteMutations:[],containerName:name,network:'none',port:8080,memoryLimitMiB:192,cpuLimit:0.5};
let started=false;
function docker(args,timeout=30000){return spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:4*1024*1024});}
async function main(){
  try{
    const files=readdirSync(dir).sort();if(JSON.stringify(files)!==JSON.stringify(['Dockerfile','railway.toml','server.cjs']))throw new Error('Unexpected build-context file');
    result.sourceHashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(dir,file))).digest('hex')]));
    const base=readFileSync(join(dir,'Dockerfile'),'utf8').split(/\r?\n/)[0].slice(5).trim();
    if(!/^node:22-slim@sha256:[a-f0-9]{64}$/.test(base))throw new Error('Unpinned base image');
    result.baseImage=base;
    const build=docker(['build','--pull=false','--network=none','--tag',tag,dir],120000);
    if(build.status!==0)throw new Error('Isolated worker image build failed');
    result.imageId=JSON.parse(docker(['image','inspect',tag]).stdout)[0].Id;
    result.baseImageId=JSON.parse(docker(['image','inspect',base]).stdout)[0].Id;
    const run=docker(['run','-d','--rm','--name',name,'--network','none','--memory','192m','--cpus','0.5','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PORT=8080',tag]);
    if(run.status!==0)throw new Error('Isolated worker image startup failed');started=true;
    const deadline=Date.now()+10000;let ready=false;
    while(Date.now()<deadline){const probe=docker(['exec',name,'node','-e',"fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"],3000);if(probe.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}
    if(!ready)throw new Error('Inert container not healthy on8080');
    const probe=docker(['exec',name,'node','-e',"(async()=>{const out=[];for(const [method,path] of [['GET','/health'],['GET','/ready'],['POST','/v1/process-media-tasks'],['POST','/unknown']]){const r=await fetch('http://127.0.0.1:8080'+path,{method,...(method==='POST'?{body:'{}'}:{})});const b=await r.json();out.push({method,path,status:r.status,paused:b.paused??b.recognition==='paused',providerDispatchEnabled:b.providerDispatchEnabled??false,version:b.containmentVersion});} console.log(JSON.stringify(out));})().catch(()=>process.exit(1))"],10000);
    if(probe.status!==0)throw new Error('Inert container probes failed');result.probes=JSON.parse(probe.stdout);
    result.passed=result.probes.every((p,i)=>p.status===(i===0?200:503)&&p.paused&&p.providerDispatchEnabled===false&&p.version==='nearr-production-pause-v1');
    if(!result.passed)throw new Error('Inert container response contract failed');
  }catch(error){result.error=error.message;}
  finally{
    if(started){result.containerStopped=docker(['stop','--time','10',name]).status===0;result.containerRemoved=docker(['container','inspect',name]).status!==0;}
    // Remove only this task's unique tag/image, never shared base images or caches.
    result.taskImageRemoved=docker(['image','rm',tag]).status===0;
    result.finishedAt=new Date().toISOString();writeFileSync(join(output,'containment/container-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
  }
}
main();
