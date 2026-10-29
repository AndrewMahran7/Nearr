/** Execute the actual Edge router with injected auth/network boundaries. */
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const helper=require('path').resolve('supabase/functions/_shared/paidRecognitionIngress.ts');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
async function run(policy,mode='extract',failure=false){let handler,metadata=0,provider=0,policyReads=0;
 const userClient={from(name){assert.equal(name,'nearr_plus_config');policyReads++;return{select(){return{eq(){return{async single(){return failure?{error:{code:'unavailable'}}:{data:{paid_find_policy_enabled:policy}};}};}};}};}};
 const helperContext={exports:{}};vm.runInNewContext(compile(helper),helperContext);
 const response=(reason,status=200)=>new Response(JSON.stringify({reason}),{status,headers:{'content-type':'application/json'}});
 const context={exports:{},Response,console:{log(){},warn(){}},crypto:{randomUUID:()=> 'request-test'},Deno:{env:{get:()=>undefined}},require(name){
  if(name.includes('http/server'))return{serve(fn){handler=fn;}};
  if(name==='./request.ts')return{parseRequest:async()=>({ok:true,req:{url:'https://example.com/video',accessToken:'fixture',mode}})};
  if(name==='./env.ts')return{readEnv:()=>({}),validateEnv:()=>({ok:true,env:{}})};
  if(name==='./auth.ts')return{authenticate:async()=>({ok:true,userId:'owner',userClient})};
  if(name.includes('ageEligibility'))return{checkAgeEligibility:async()=>({ok:true})};
  if(name.includes('paidRecognitionIngress'))return helperContext.exports;
  if(name==='./response.ts')return{statusFailed:response,statusFailedRequiresApp:()=>response('metadata_failed',400)};
  if(name.includes('diagnostics/logger'))return{logShareDebug(){}};
  if(name.includes('tiktokUrl'))return{normalizeShareUrl:url=>({url})};
  if(name.includes('detectPlatform'))return{detectPlatform:()=> 'link'};
  if(name.includes('fetchMetadata'))return{fetchPostMetadata:async()=>{metadata++;return{ok:false,reason:'fixture_stop'};}};
  if(name.includes('resolveSharedPlace'))return{resolveSharedPlace:async()=>{provider++;throw Error('must_not_dispatch');}};
  return{};
 }};
 vm.runInNewContext(compile('supabase/functions/process-share-link/index.ts'),context);
 const result=await handler(new Request('https://local.invalid',{method:'POST',headers:{'x-nearr-contract':'global-v1'}}));
 return{status:result.status,body:await result.json(),metadata,provider,policyReads};
}
(async()=>{
 for(const mode of ['extract','save','extract_v2']){const r=await run(true,mode);assert.equal(r.status,426);assert.equal(r.body.reason,'update_required');assert.equal(r.metadata,0);assert.equal(r.provider,0);assert.equal(r.policyReads,1);}
 for(const [value,error] of [[undefined,false],[null,false],['true',false],[false,true]]){const r=await run(value,'extract',error);assert.equal(r.status,503);assert.equal(r.metadata,0);assert.equal(r.provider,0);}
 const legacy=await run(false);assert.equal(legacy.metadata,1);assert.equal(legacy.provider,0);
 console.log('8 actual Edge paid-ingress boundary scenarios passed; no real network/provider calls');
})().catch(e=>{console.error(e);process.exitCode=1;});
