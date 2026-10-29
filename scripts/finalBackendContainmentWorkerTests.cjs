// Executes the exact inert worker with only inbound HTTP available. No secrets.
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const http=require('node:http');
const vm=require('node:vm');
const {join}=require('node:path');
const {output}=require('./finalBackendReadiness.cjs');
const file=join(output,'containment/worker/server.cjs');
async function main(){
  const code=readFileSync(file,'utf8');
  let unexpectedCapabilities=0;
  const denied=()=>{unexpectedCapabilities++;throw new Error('Unexpected outbound/runtime capability');};
  const boundary=name=>{if(name==='node:http')return {createServer:http.createServer};return denied();};
  boundary.main=null;
  const runtime={exports:{}};
  vm.runInNewContext(code,{require:boundary,module:runtime,process:new Proxy({},{get:denied}),fetch:denied,setTimeout,JSON},{timeout:2000});
  const server=runtime.exports.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const tests=[];
  try{
    const healthy=await fetch(base+'/health');assert.equal(healthy.status,200);assert.equal((await healthy.json()).recognition,'paused');tests.push('Liveness remains 200 while declaring recognition paused');
    for(const [method,path] of [['GET','/ready'],['POST','/v1/process-media-tasks'],['POST','/v1/process-media-tasks?limit=25'],['POST','/health'],['OPTIONS','/v1/process-media-tasks'],['PUT','/anything'],['GET','/unknown']]){
      const r=await fetch(base+path,{method,...(method==='GET'?{}:{body:'PRIVATE_SENTINEL_MUST_NOT_BE_READ_OR_ECHOED'})});
      const text=await r.text();assert.equal(r.status,503);assert.equal(JSON.parse(text).providerDispatchEnabled,false);assert.ok(!text.includes('PRIVATE_SENTINEL'));assert.equal(r.headers.get('cache-control'),'no-store');
    }
    tests.push('Readiness, every former dispatch endpoint, unknown paths and methods fail closed without echoing bodies');
    const parallel=await Promise.all(Array.from({length:24},()=>fetch(base+'/v1/process-media-tasks',{method:'POST',body:'{}',headers:{Authorization:'Bearer OFFLINE_TEST_ONLY'}})));
    assert.ok(parallel.every(r=>r.status===503));await Promise.all(parallel.map(r=>r.arrayBuffer()));tests.push('24 authenticated-looking concurrent requests cannot dispatch or acquire work');
    assert.equal(unexpectedCapabilities,0);tests.push('Exact source uses no environment/provider/database/file/network-client capability in handler execution');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const result={testedAt:new Date().toISOString(),passed:true,sourceSha256:createHash('sha256').update(code).digest('hex'),tests,outboundCalls:0,scope:'Exact inert worker running on loopback; not a Railway/container deployment'};
  writeFileSync(join(output,'containment/worker-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
