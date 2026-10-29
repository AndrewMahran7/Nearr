import assert from 'node:assert/strict';
import path from 'node:path';
const Module=require('node:module'), original=Module._load;
let user:any={id:'alice',is_anonymous:false},verification=false,offline=false,switchDuring=false;
let jobOwner='alice', resultOwner='alice', switchAtSaveAuth=false, switchAfterSave=false, switchDuringJobRead=false, jobReadError=false, realSave:any;
const trace:string[]=[];let saves=0, cacheWrites=0, savedOwner:string|undefined;
const supabase={auth:{getSession:async()=>({data:{session:user?{user}:null}}),getUser:async()=>{
  if(switchAtSaveAuth)user={id:'bob',is_anonymous:false};return{data:{user},error:null};
}},from:(table:string)=>{
  const filters:Record<string,unknown>={};
  const query={select:(_columns:string)=>query,eq:(column:string,value:unknown)=>{filters[column]=value;return query;},maybeSingle:async()=>{
    assert(['share_jobs','share_job_place_results'].includes(table),'Unexpected persistence before owner boundary');
    trace.push(table==='share_jobs'?'job':'result');const owner=table==='share_jobs'?jobOwner:resultOwner;
    const data=owner===user?.id&&filters.user_id===owner?(table==='share_jobs'?{id:filters.id,user_id:owner}:{share_job_id:'owned-job',user_id:owner}):null;
    if(switchDuringJobRead)user={id:'bob',is_anonymous:false};return{data,error:jobReadError?new Error('private database detail'):null};
  }};return query;
},functions:{invoke:async(_name:string,{body}:any)=>{
  trace.push(body.action);if(switchDuring)user={id:'bob',is_anonymous:false};
  return offline?{error:new Error('offline')}:{data:{ok:true,productId:'com.nearr.plus.unlimited.monthly.v1',usage:{verificationRequired:verification,canSubmit:false,free:{reserved:3}}}};
}}};
Module._load=function(request:string,parent:any,isMain:boolean){
  // Exercise the actual savedPlacesService getUser check. Only its unrelated
  // side-effect dependencies are inert; unexpected persistence throws above.
  if(parent?.filename?.endsWith(`${path.sep}savedPlacesService.ts`)&&request.startsWith('@/')){
    if(request==='@/lib/supabase')return{supabase};
    if(request==='@/lib/demoMode')return{isDemoMode:()=>false};
    if(request==='@/lib/logger')return{logDebug:()=>{}};
    if(request==='@/lib/placeCategory')return{resolvePlaceCategory:()=>({category:'other'})};
    return{};
  }
  if(request==='expo-constants')return{default:{expoConfig:{extra:{}}},__esModule:true};
  if(request==='expo-crypto')return{randomUUID:()=> 'test'};
  if(request==='react-native')return{Platform:{OS:'ios'}};
  if(request==='@react-native-async-storage/async-storage')return{getItem:async()=>null};
  if(request==='./supabase'||request==='@/lib/supabase')return{supabase};
  if(request==='@/hooks/useSavedPlaces')return{upsertSavedPlaceIntoCache:()=>{cacheWrites++;}};
  if(request==='@/lib/breadcrumbs')return{recordBreadcrumb:()=>{}};
  if(request==='@/lib/analytics')return{trackEvent:async()=>{}};
  if(request==='@/lib/shareJobCandidateConversion')return{isPersistableShareJobCandidate:()=>true,shareJobCandidateToPlaceCandidate:(c:any)=>c};
  if(request==='@/services/shareJobsService')return{markShareJobResolved:async()=>{}};
  if(request==='@/services/savedPlacesService')return{saveSavedPlace:async(input:any)=>{
    if(switchAtSaveAuth)return realSave(input);
    trace.push('save');saves++;savedOwner=input.expectedUserId;if(switchAfterSave)user={id:'bob',is_anonymous:false};
    return{status:'saved',saved:{id:'save'},savedPlaceId:'save',outcome:'created'};
  }};
  if(request.startsWith('@/'))return original.call(this,path.resolve(request.slice(2)),parent,isMain);
  return original.call(this,request,parent,isMain);
};
let checks=0;
async function check(label:string,run:()=>Promise<void>){
  user={id:'alice',is_anonymous:false};jobOwner='alice';resultOwner='alice';
  verification=offline=switchDuring=switchAtSaveAuth=switchAfterSave=switchDuringJobRead=jobReadError=false;
  trace.length=0;saves=cacheWrites=0;savedOwner=undefined;await run();checks++;console.log(`PASS ${label}`);
}
async function main(){try{
  realSave=require('../services/savedPlacesService').saveSavedPlace;
  const {persistShareJobCandidate}=require('../services/shareJobCandidateSave');
  const {refreshRecognitionBilling}=require('../lib/recognitionBillingPreflight');
  const save=()=>persistShareJobCandidate({candidate:{googlePlaceId:'verified'},jobId:'owned-job',platform:'youtube',sourceUrl:'https://example.com/video'});
  await check('owned job refreshes before save and preserves reserved capacity',async()=>{await save();assert.deepEqual(trace,['job','status','save']);assert.equal(saves,1);assert.equal(savedOwner,'alice');assert.equal(cacheWrites,1);});
  await check('stale subscription prevents save',async()=>{verification=true;await assert.rejects(save(),/plus_verification_required/);assert.equal(saves,0);});
  await check('offline verification prevents save',async()=>{offline=true;await assert.rejects(save(),/plus_unavailable/);assert.equal(saves,0);});
  await check('account switch during status prevents save',async()=>{switchDuring=true;await assert.rejects(save(),/plus_account_changed/);assert.equal(saves,0);});
  await check('signed-out caller cannot save job candidate',async()=>{user=null;await assert.rejects(save(),/recognition_account_required/);assert.equal(saves,0);});
  await check('Alice job on Bob session cannot persist into Bob map',async()=>{user={id:'bob',is_anonymous:false};await assert.rejects(save(),/recognition_job_not_owned/);assert.deepEqual(trace,['job']);assert.equal(saves,0);});
  await check('account switch during job lookup stops before save',async()=>{switchDuringJobRead=true;await assert.rejects(save(),/recognition_account_changed/);assert.deepEqual(trace,['job']);assert.equal(saves,0);});
  await check('actual savedPlacesService getUser rejects switch after preflight',async()=>{switchAtSaveAuth=true;await assert.rejects(save(),/recognition_account_changed/);assert.deepEqual(trace,['job','status']);assert.equal(saves,0);assert.equal(cacheWrites,0);});
  await check('late save response cannot populate new account cache',async()=>{switchAfterSave=true;await assert.rejects(save(),/recognition_account_changed/);assert.equal(savedOwner,'alice');assert.equal(cacheWrites,0);});
  await check('owned anonymous job skips purchase API but binds owner',async()=>{user={id:'anonymous',is_anonymous:true};jobOwner='anonymous';await save();assert.deepEqual(trace,['job','save']);assert.equal(savedOwner,'anonymous');});
  await check('anonymous account cannot save another account job',async()=>{user={id:'anonymous',is_anonymous:true};await assert.rejects(save(),/recognition_job_not_owned/);assert.equal(saves,0);});
  await check('ordinary no-job manual save keeps existing behavior',async()=>{user=null;await persistShareJobCandidate({candidate:{},jobId:null,platform:null,sourceUrl:null});assert.deepEqual(trace,['save']);assert.equal(savedOwner,undefined);});
  await check('promotion checks result and owning job',async()=>{assert.equal(await refreshRecognitionBilling({resultId:'result'}),'alice');assert.deepEqual(trace,['result','job','status']);});
  await check('foreign promotion result cannot authorize current account',async()=>{resultOwner='bob';await assert.rejects(refreshRecognitionBilling({resultId:'result'}),/recognition_job_not_owned/);assert.deepEqual(trace,['result']);});
  await check('job lookup failure prevents persistence',async()=>{jobReadError=true;await assert.rejects(save(),/recognition_job_not_owned/);assert.equal(saves,0);});
  console.log(`${checks} real recognition owner/preflight boundaries passed. Offline fixtures only.`);
}finally{Module._load=original;}}
void main().catch(e=>{console.error(e);process.exitCode=1;});
