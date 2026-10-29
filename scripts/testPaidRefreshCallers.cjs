/** Actual Edge handlers/functions; external boundaries are injected, never live. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const owner='11111111-1111-1111-1111-111111111111';
function compile(file,append=''){return ts.transpileModule(fs.readFileSync(file,'utf8')+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
function env(require){return{exports:{},Request,Response,URL,console:{log(){},warn(){},error(){}},Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://local.invalid':key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-service':key==='REVENUECAT_SECRET_API_KEY'?'fixture-secret':undefined}},require};}
async function admission(reject){let handler,created=0,refreshOwner=null,release;const barrier=new Promise(r=>release=r);
 const admin={auth:{getUser:async()=>({data:{user:{id:owner}}})},rpc:async()=>{created++;return{data:[{job_id:'accepted',status:'queued',duplicate:false,requires_purchase:false}]};}};
 const context=env(name=>{
  if(name.includes('http/server'))return{serve:fn=>handler=fn};
  if(name.includes('@supabase'))return{createClient:()=>admin};
  if(name.includes('tiktokUrl'))return{normalizeShareUrl:url=>({url})};
  if(name.includes('detectPlatform'))return{detectPlatform:()=> 'link'};
  if(name.includes('urlValidation'))return{validateShareUrl:url=>({ok:true,url})};
  if(name.includes('qualificationMode'))return{authorizeQualificationMode:()=>({ok:true,requested:false})};
  if(name.includes('recognitionCachePolicy'))return{readRecognitionCachePolicy:()=>({cacheReadSuspended:false}),logRecognitionCachePolicy(){}};
  if(name.includes('ageEligibility'))return{checkAgeEligibility:async()=>({ok:true})};
  if(name.includes('paidEntitlementRefresh'))return{refreshStalePaidEntitlements:async(_admin,user)=>{refreshOwner=user;await barrier;if(reject)throw Error('paid_entitlement_refresh_failed');return{refreshed:true};}};
  return{};
 });
 vm.runInNewContext(compile('supabase/functions/create-share-job/index.ts'),context);
 const pending=handler(new Request('https://local.invalid',{method:'POST',headers:{authorization:'Bearer fixture','x-nearr-contract':'global-v1'},body:JSON.stringify({url:'https://example.com/video',userId:'untrusted-body-owner'})}));
 await new Promise(r=>setImmediate(r));assert.equal(refreshOwner,owner);assert.equal(created,0,'admission must await refresh');release();
 const result=await pending;assert.equal(result.status,reject?409:200);assert.equal(created,reject?0:1);
}
async function worker(){let refreshes=0,writes=0,lookups=0;
 const admin={from(table){lookups++;return{select(){return{eq(){return{maybeSingle:async()=>({data:table==='share_media_tasks'?{id:'task',user_id:owner,share_job_id:'job',task_kind:'recognition',status:'processing'}:{id:'job',user_id:owner}})};}};},update(){writes++;throw Error('must_not_write');}};}};
 const context=env(name=>{
  if(name.includes('http/server'))return{serve(){}};
  if(name.includes('ageEligibility'))return{checkAgeEligibility:async()=>({ok:true})};
  if(name.includes('paidEntitlementRefresh'))return{refreshStalePaidEntitlements:async(_admin,user)=>{assert.equal(user,owner);refreshes++;throw Error('paid_entitlement_refresh_failed');}};
  if(name.includes('recognitionCachePolicy'))return{recognitionCachePolicyForRun:policy=>policy};
  return{};
 });
 vm.runInNewContext(compile('supabase/functions/process-share-jobs/index.ts','\nexports.__paidTests={processOne,finalize,finalizeMediaTask};'),context);
 const t=context.exports.__paidTests;
 await assert.rejects(()=>t.processOne(admin,{}, {id:'job',user_id:owner},{}),/paid_entitlement_refresh_failed/);assert.equal(lookups,0);assert.equal(writes,0);
 await assert.rejects(()=>t.finalize(admin,{id:'job',user_id:owner},{status:'completed'},null),/paid_entitlement_refresh_failed/);assert.equal(writes,0);
 const callback=await t.finalizeMediaTask(admin,{}, {taskId:'task',userId:'untrusted-body-owner'},{id:'call',startedAt:Date.now()},{});
 assert.equal(callback.status,503);assert.equal(refreshes,3);assert.equal(lookups,2);assert.equal(writes,0);
}
(async()=>{await admission(false);await admission(true);await worker();console.log('5 actual Edge freshness-boundary scenarios passed (admission, processing, callback, terminal)');})().catch(e=>{console.error(e);process.exitCode=1;});
