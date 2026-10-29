import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const Module=require('node:module'),originalLoad=Module._load,originalFetch=global.fetch;
type Owner='alice'|'bob'|null;
let owner:Owner='alice',tokenVersion=1,authReads=0,switchAfterRead=0;
let mode:'ok'|'deferred'|'network'|'denied'='ok';
const requests:Array<{authorization:string;body:any}>=[],lookups:Array<Record<string,string>>=[];
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
let responseGate=deferred<Response>(),lookupGate=deferred<any>();
let holdLookup=false;
const supabase={
 auth:{getSession:async()=>{
  authReads++;const current=owner;const session=current?{user:{id:current},access_token:`fixture-${current}-${tokenVersion}`}:null;
  if(switchAfterRead===authReads)owner='bob';return{data:{session},error:null};
 }},
 from:(table:string)=>{
  assert.equal(table,'share_jobs');const filters:Record<string,string>={};
  const query={select:(columns:string)=>{assert.equal(columns,'id,status');return query;},eq:(column:string,value:string)=>{filters[column]=value;return query;},abortSignal:()=>query,
   maybeSingle:async()=>{lookups.push({...filters});return holdLookup?lookupGate.promise:{data:{id:`job-${filters.user_id}`,status:'queued'},error:null};}};
  return query;
 },
};
Module._load=function(request:string,parent:any,isMain:boolean){
 if(request==='./supabase'&&/hostShareSubmit/.test(parent?.filename??''))return{supabase};
 if(request==='./featureFlags'&&/hostShareSubmit/.test(parent?.filename??''))return{resolveCreateShareJobUrl:()=> 'https://fixture.invalid/create-share-job'};
 if(request==='./sharedAuth'&&/hostShareSubmit/.test(parent?.filename??''))return{sharedAuth:{recordShareTrace(){}}};
 return originalLoad(request,parent,isMain);
};
global.fetch=(async(url:any,init?:RequestInit)=>{
 assert.equal(String(url),'https://fixture.invalid/create-share-job');const authorization=(init?.headers as any).authorization;
 requests.push({authorization,body:JSON.parse(String(init?.body))});
 if(mode==='deferred')return responseGate.promise;
 if(mode==='network')throw new Error('lost acknowledgement');
 if(mode==='denied')return new Response(JSON.stringify({error:'recognition_not_available'}),{status:503});
 return new Response(JSON.stringify({jobId:authorization.includes('alice')?'job-alice':'job-bob',status:'queued'}),{status:200});
}) as typeof fetch;
const submitter=require('../lib/hostShareSubmit').hostShareSubmitter as typeof import('../lib/hostShareSubmit').hostShareSubmitter;
const args={url:'https://www.instagram.com/reel/account-boundary/',submissionId:'s_original_sid'};
const passed:string[]=[];
function reset(){submitter.reset();owner='alice';tokenVersion=1;authReads=0;switchAfterRead=0;mode='ok';holdLookup=false;requests.length=0;lookups.length=0;responseGate=deferred<Response>();lookupGate=deferred<any>();}
async function until(ready:()=>boolean){for(let n=0;n<50;n++){if(ready())return;await new Promise<void>(r=>setImmediate(r));}throw new Error('expected boundary not reached');}
async function test(name:string,run:()=>Promise<void>){reset();await run();passed.push(name);console.log('PASS '+name);}
async function main(){try{
 await test('same account deduplicates concurrent requests and accepted replay without changing server SID',async()=>{
  mode='deferred';const first=submitter.submit(args),second=submitter.submit(args);await until(()=>requests.length===1);
  responseGate.resolve(new Response(JSON.stringify({jobId:'job-alice',status:'queued'}),{status:200}));
  const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.ok&&r.jobId==='job-alice'));
  const replay=await submitter.submit(args);assert.equal(replay.duplicate,true);assert.equal(requests.length,1);
  assert.equal(requests[0].body.clientRequestId,args.submissionId);assert.equal(await submitter.hasAccepted(args.submissionId),true);
 });
 await test('identical SID in a different account cannot read the prior accepted or in-flight cache',async()=>{
  const alice=await submitter.submit(args);owner='bob';assert.equal(await submitter.hasAccepted(args.submissionId),false);
  const bob=await submitter.submit(args);assert.equal(alice.jobId,'job-alice');assert.equal(bob.jobId,'job-bob');assert.equal(requests.length,2);
  assert.deepEqual(requests.map(r=>r.body.clientRequestId),[args.submissionId,args.submissionId]);
  owner='alice';assert.equal((await submitter.submit(args)).jobId,'job-alice');assert.equal(requests.length,2);
 });
 await test('signed-out reads and account switch while returning a cache hit cannot expose acceptance',async()=>{
  await submitter.submit(args);owner=null;assert.equal((await submitter.submit(args)).reason,'missing_auth');assert.equal(await submitter.hasAccepted(args.submissionId),false);assert.equal(requests.length,1);
  owner='alice';switchAfterRead=authReads+1;const switched=await submitter.submit(args);assert.equal(switched.ok,false);assert.equal(switched.reason,'account_changed');assert.equal(switched.jobId,undefined);assert.equal(requests.length,1);
 });
 await test('account switch after cache selection but before dispatch performs no create request',async()=>{
  switchAfterRead=1;const result=await submitter.submit(args);assert.equal(result.ok,false);assert.equal(result.reason,'account_changed');assert.equal(requests.length,0);
  assert.equal(await submitter.hasAccepted(args.submissionId),false);
 });
 await test('account switch during create cannot return or cache the old accepted outcome for the new account',async()=>{
  mode='deferred';const alice=submitter.submit(args);await until(()=>requests.length===1);owner='bob';mode='ok';
  const bob=await submitter.submit(args);assert.equal(bob.ok,true);assert.equal(bob.jobId,'job-bob');assert.equal(requests.length,2);
  responseGate.resolve(new Response(JSON.stringify({jobId:'job-alice',status:'queued'}),{status:200}));
  const stale=await alice;assert.equal(stale.ok,false);assert.equal(stale.reason,'account_changed');assert.equal(stale.jobId,undefined);
  owner='alice';assert.equal(await submitter.hasAccepted(args.submissionId),false);const recovered=await submitter.submit(args);assert.equal(recovered.jobId,'job-alice');assert.equal(requests.length,3);assert.equal(requests[2].body.clientRequestId,args.submissionId);
 });
 await test('lost acknowledgement recovery queries the expected owner and discards an identity change during lookup',async()=>{
  mode='network';const recovered=await submitter.submit(args);assert.equal(recovered.ok,true);assert.deepEqual(lookups[0],{idempotency_key:args.submissionId,user_id:'alice'});
  reset();mode='network';holdLookup=true;const work=submitter.submit(args);await until(()=>lookups.length===1);owner='bob';
  lookupGate.resolve({data:{id:'job-alice',status:'queued'},error:null});const switched=await work;assert.equal(switched.ok,false);assert.equal(switched.reason,'account_changed');assert.equal(switched.jobId,undefined);
  assert.equal(await submitter.hasAccepted(args.submissionId),false);
 });
 await test('same-account token rotation remains valid and denied submissions retry with the original SID',async()=>{
  mode='deferred';const pending=submitter.submit(args);await until(()=>requests.length===1);tokenVersion=2;
  responseGate.resolve(new Response(JSON.stringify({jobId:'job-alice',status:'queued'}),{status:200}));assert.equal((await pending).ok,true);
  reset();mode='denied';assert.equal((await submitter.submit(args)).ok,false);assert.equal(await submitter.hasAccepted(args.submissionId),false);
  mode='ok';assert.equal((await submitter.submit(args)).ok,true);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.body.clientRequestId===args.submissionId));
 });
 mkdirSync('artifacts/global-release/paid-launch/client',{recursive:true});writeFileSync('artifacts/global-release/paid-launch/client/host-account-boundary-tests.json',JSON.stringify({createdAt:new Date().toISOString(),kind:'actual hostShareSubmit and createShareJob with mocked auth/network/query boundaries',tests:passed,liveCalls:0},null,2)+'\n');
 }finally{Module._load=originalLoad;global.fetch=originalFetch;submitter.reset();}}
void main().catch(e=>{console.error(e);process.exitCode=1;});
