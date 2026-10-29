import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import React from 'react';
import * as translations from '../lib/i18nEngine';
import {AI_NOTICE_VERSION} from '../lib/aiSharingConsent';
const Module=require('node:module'),originalLoad=Module._load,originalFetch=global.fetch;
const previousUrl=process.env.EXPO_PUBLIC_SUPABASE_URL,previousKey=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
process.env.EXPO_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY='fixture-public-key';
let params:any={},granted=false,eligible=true,responseCode=200,responseError='';
const events:string[]=[],requests:any[]=[],navigations:string[]=[],traces:string[]=[];
const jwt='fixture.'+Buffer.from(JSON.stringify({sub:'fixture-owner',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'fixture-owner'},access_token:jwt}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
const sharedAuth={getToken:()=>jwt,recordShareTrace:(_id:string,event:string)=>traces.push(event)};
const forbidden=(name:string)=>(..._args:any[])=>{events.push('FORBIDDEN:'+name);throw new Error('Unexpected legacy operation '+name);};
const navigation={canGoBack:()=>false,addListener:()=>()=>{},setOptions(){}};
const router={replace:(route:string)=>navigations.push(route),push:(route:string)=>navigations.push(route),back:()=>navigations.push('back')};
global.fetch=(async(input:any,init?:RequestInit)=>{
 const url=String(input),body=JSON.parse(String(init?.body??'{}'));
 if(url.endsWith('/rest/v1/rpc/get_my_global_access')){events.push('consent:read');return new Response(JSON.stringify({status:eligible?'eligible':'restricted',legalApproved:true,noticeVersion:AI_NOTICE_VERSION,termsAccepted:true,aiAllowed:granted}),{status:200});}
 if(url.endsWith('/rest/v1/rpc/set_ai_sharing_permission')){assert.equal(body.p_allowed,true);assert.equal(body.p_notice_version,AI_NOTICE_VERSION);granted=true;events.push('consent:allow');return new Response('{}',{status:200});}
 if(url==='https://fixture.supabase.co/functions/v1/create-share-job'){
  assert.equal(granted,true,'durable submit must follow persisted consent');events.push('durable:create-share-job');requests.push(body);
  assert.equal((init?.headers as any)['x-nearr-contract'],'global-v1');assert.equal(body.submissionPath,'host_app');
  return new Response(JSON.stringify(responseCode===200?{jobId:'fixture-job',status:'queued',duplicate:false}:{error:responseError}),{status:responseCode});
 }
 return forbidden('network:'+url)();
}) as typeof fetch;
Module._load=function(request:string,parent:any,isMain:boolean){
 if(request==='react-native')return{Platform:{OS:'ios'},StyleSheet:{create:(s:any)=>s},AppState:{addEventListener:()=>({remove(){}})},Alert:{alert:()=>events.push('invalid-alert')},Linking:{openURL:async()=>{}},
  ActivityIndicator:'ActivityIndicator',Text:'Text',View:'View',ScrollView:'ScrollView',Pressable:'Pressable',KeyboardAvoidingView:'KeyboardAvoidingView'};
 if(request==='expo-router')return{useLocalSearchParams:()=>params,useRouter:()=>router,useNavigation:()=>navigation};
 if(request==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})};
 if(request==='expo-location')return new Proxy({},{get:(_,name)=>forbidden('location:'+String(name))});
 if(request==='expo-constants')return{__esModule:true,default:{expoConfig:{extra:{}}}};
 if(request==='@/lib/i18n'||request==='../lib/i18n')return translations;
 if(request==='@/hooks/useLocale'||request==='../hooks/useLocale')return{useLocale:()=>({locale:'en-US'})};
 if(request==='@/lib/supabase'||request==='../lib/supabase'||(request==='./supabase'&&/hostShareSubmit/.test(parent?.filename??'')))return{supabase};
 if(request==='@/lib/sharedAuth'||request==='../lib/sharedAuth'||(request==='./sharedAuth'&&/hostShareSubmit/.test(parent?.filename??'')))return{sharedAuth};
 if(request==='@/lib/featureFlags'||(request==='./featureFlags'&&/hostShareSubmit/.test(parent?.filename??'')))return{isAsyncShareJobsEnabled:()=>false,isVayrinProductUiEnabled:()=>false,resolveCreateShareJobUrl:()=> 'https://fixture.supabase.co/functions/v1/create-share-job'};
 if(request==='@/components')return{Screen:'Screen',Card:'Card',Input:'Input',Button:(p:any)=>React.createElement('Button',p,p.title)};
 if(request==='@/lib/theme')return{useTheme:()=>({colors:{text:'#24392F',textSecondary:'#3E4C45',primary:'#246447'},typography:{title:{},body:{},heading:{}}})};
 if(request==='@/constants')return{Spacing:{xs:4,sm:8,md:12,lg:16,xl:24},Radius:{md:12}};
 if(request==='@/hooks/useOnboardingV2')return{useOnboardingV2:()=>({state:{pendingShare:{url:params.url}}})};
 if(request==='@/lib/onboardingV2')return{prepareOnboardingV2RealPracticeShare:async()=>{events.push('onboarding:prepare');},observeOnboardingV2Result:forbidden('legacy-onboarding-result')};
 if(request==='@/lib/onboardingV2Core')return{isExpectedOnboardingSource:()=>true};
 if(request==='@/lib/analytics')return{trackEvent:()=>{}};
 if(request==='@/lib/logger')return{logDebug(){},logInfo(){}};
 if(request==='@/lib/deviceDiagnostics')return{recordDiagnostic:async()=>{}};
 if(request==='@/lib/shareParser'){
  const real=originalLoad(require.resolve('../lib/shareParser'),parent,isMain);return{...real,parseShare:forbidden('parseShare')};
 }
 if(['@/components/ShareJobHandoff','@/components/AiSharePermissionPrompt','@/lib/hostShareSubmit','@/lib/shareSubmission','@/lib/shareAccessPresentation'].includes(request))return originalLoad(require.resolve('../'+request.slice(2)),parent,isMain);
 if(request.startsWith('@/components/'))return new Proxy({},{get:(_,key)=>String(key)});
 if(request.startsWith('@/'))return new Proxy({},{get:(_,key)=>forbidden(request+':'+String(key))});
 return originalLoad(request,parent,isMain);
};
const Renderer=require('react-test-renderer') as typeof import('react-test-renderer');
const Share=require('../app/share').default;
const submitter=require('../lib/hostShareSubmit').hostShareSubmitter;
const pass:string[]=[];
const flush=()=>new Promise(resolve=>setTimeout(resolve,15));
function reset(next:any={}){params=next;granted=false;eligible=true;responseCode=200;responseError='';events.length=0;requests.length=0;navigations.length=0;traces.length=0;submitter.reset();}
async function render(){let screen:any;await Renderer.act(async()=>{screen=Renderer.create(React.createElement(Share));await flush();});return screen;}
async function click(screen:any,label:string){const node=screen.root.findAll((n:any)=>(n.type==='Button'&&n.props.title===label)||(n.type==='Pressable'&&n.props.accessibilityLabel===label));assert.equal(node.length,1,label);await Renderer.act(async()=>{node[0].props.onPress();await flush();});}
function noLegacy(){assert.deepEqual(events.filter(e=>e.startsWith('FORBIDDEN:')),[]);}
async function test(name:string,run:()=>Promise<void>){await run();pass.push(name);console.log('PASS '+name);}
async function main(){try{
 await test('pasted button and keyboard submit mount actual consent/handoff before any parse, extraction, provider or save',async()=>{
  for(const keyboard of [false,true]){reset();const screen=await render();assert.equal(events.length,0);
   const input=screen.root.findByType('Input');await Renderer.act(async()=>input.props.onChangeText('  https://www.instagram.com/reel/paid-ingress/  '));
   if(keyboard)await Renderer.act(async()=>{screen.root.findByType('Input').props.onSubmitEditing();await flush();});else await click(screen,translations.t('Find the place'));
   assert.equal(requests.length,0);assert.equal(events.includes('onboarding:prepare'),false);noLegacy();
   await click(screen,translations.t('Allow third-party AI analysis of this post'));assert.equal(requests.length,1);assert.equal(requests[0].url,'https://www.instagram.com/reel/paid-ingress/');
   assert.ok(events.indexOf('consent:allow')<events.indexOf('onboarding:prepare'));assert.ok(events.indexOf('onboarding:prepare')<events.indexOf('durable:create-share-job'));noLegacy();Renderer.act(()=>screen.unmount());
  }
 });
 await test('valid incoming URL preserves sid and trace ordering despite old async flag false; new URL asks consent again',async()=>{
  reset({url:'https://www.tiktok.com/@fixture/video/123456',sid:'s_fixture_first'});const screen=await render();assert.equal(screen.root.findAllByType('Input').length,0);assert.equal(requests.length,0);
  assert.ok(traces.indexOf('host_share_payload_received')<traces.indexOf('share_handoff_component_mounted'));
  await click(screen,translations.t('Allow third-party AI analysis of this post'));assert.equal(requests[0].clientRequestId,'s_fixture_first');
  params={url:'https://www.instagram.com/reel/second-ingress/',sid:'s_fixture_second'};await Renderer.act(async()=>{screen.update(React.createElement(Share));await flush();});
  assert.equal(requests.length,1);await click(screen,translations.t('Cancel share without analyzing this post'));assert.equal(requests.length,1);noLegacy();Renderer.act(()=>screen.unmount());
 });
 await test('invalid paste and denied consent never submit or enter legacy extraction',async()=>{
  reset();let screen=await render();await Renderer.act(async()=>screen.root.findByType('Input').props.onChangeText('not a video URL'));await click(screen,translations.t('Find the place'));assert.deepEqual(events,['invalid-alert']);assert.equal(requests.length,0);Renderer.act(()=>screen.unmount());
  reset({url:'https://www.instagram.com/reel/restricted/'});eligible=false;screen=await render();assert.equal(requests.length,0);assert.equal(events.includes('onboarding:prepare'),false);await click(screen,translations.t('Cancel share without analyzing this post'));noLegacy();Renderer.act(()=>screen.unmount());
 });
 await test('durable admission denial and server failure never fall back to sync provider calls',async()=>{
  for(const [code,error] of [[403,'plus_allowance_exhausted'],[403,'ai_permission_required'],[503,'recognition_not_available']] as const){
   reset({url:'https://www.instagram.com/reel/denied-ingress/'});responseCode=code;responseError=error;const screen=await render();await click(screen,translations.t('Allow third-party AI analysis of this post'));
   assert.equal(requests.length,1);noLegacy();assert.equal(events.filter(e=>e==='durable:create-share-job').length,1);Renderer.act(()=>screen.unmount());
  }
 });
 await test('exhausted or unverified finds open the paywall and retry the identical submission through server admission',async()=>{
  for(const error of ['plus_allowance_exhausted','plus_verification_required']){
   reset({url:'https://www.instagram.com/reel/paid-recovery/',sid:'s_paid_recovery'});responseCode=403;responseError=error;
   const screen=await render();await click(screen,translations.t('Allow third-party AI analysis of this post'));assert.equal(requests.length,1);
   await click(screen,translations.t('Finds, Plus and tokens'));assert.equal(navigations[navigations.length-1],'/plus');assert.equal(requests.length,1,'opening paywall cannot submit or grant work');
   if(error==='plus_allowance_exhausted'){responseCode=200;responseError='';}else{responseCode=403;responseError='ai_permission_required';}
   await click(screen,translations.t('Retry'));assert.equal(requests.length,2);assert.equal(requests[1].clientRequestId,requests[0].clientRequestId);assert.equal(requests[1].url,requests[0].url);
   if(error==='plus_verification_required'){
    assert.equal(screen.root.findAll((n:any)=>n.type==='Button'&&n.props.title===translations.t('Retry')).length,0,'fresh server consent denial must remove retry');
    assert.equal(screen.root.findAll((n:any)=>n.type==='Button'&&n.props.title===translations.t('View queue')).length,0,'denied retry cannot report queue acceptance');
   }
   noLegacy();Renderer.act(()=>screen.unmount());
  }
 });
 await test('consent and provider restrictions have no network retry or paid bypass CTA',async()=>{
  for(const error of ['ai_permission_required','recognition_not_available']){
   reset({url:'https://www.instagram.com/reel/blocked-recovery/'});responseCode=403;responseError=error;const screen=await render();await click(screen,translations.t('Allow third-party AI analysis of this post'));
   for(const label of ['Retry','Finds, Plus and tokens'])assert.equal(screen.root.findAll((n:any)=>n.type==='Button'&&n.props.title===translations.t(label)).length,0,error+' '+label);
   assert.equal(requests.length,1);noLegacy();Renderer.act(()=>screen.unmount());
  }
 });
 mkdirSync('artifacts/global-release/paid-launch/client',{recursive:true});writeFileSync('artifacts/global-release/paid-launch/client/host-ingress-tests.json',JSON.stringify({createdAt:new Date().toISOString(),kind:'actual ShareScreen, ShareJobHandoff, AiSharePermissionPrompt, hostShareSubmit and createShareJob with mocked native/auth/network boundaries',tests:pass,liveCalls:0,legacyFlagInTest:false},null,2)+'\n');
 }finally{Module._load=originalLoad;global.fetch=originalFetch;if(previousUrl===undefined)delete process.env.EXPO_PUBLIC_SUPABASE_URL;else process.env.EXPO_PUBLIC_SUPABASE_URL=previousUrl;if(previousKey===undefined)delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY=previousKey;}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
