import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { ProviderBudgetLedger,type ProviderBudgetConfig,type ProviderLedgerEntry } from '../src/evaluation/providerBudgetLedger.js';
import { validateGoldInput,loadGoldInput,prepareGoldInput } from '../src/evaluation/goldInputAdapter.js';
import { observedPlace,scoredCandidates,observedScoringPool,executeGoldInput } from '../src/evaluation/goldRuntimeAdapter.js';
import { planMediaFinalization } from '../../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { emptyEvidence } from '../src/types/evidence.js';
import { runGoldInference,configuredWorker,type GoldRunConfiguration } from '../src/cli/recognitionGoldInference.js';

const testRate={operation:'openai_responses' as const,model:'synthetic-test-model',inputUsdPerMillion:2,cachedInputUsdPerMillion:1,cacheWriteInputUsdPerMillion:2.5,outputUsdPerMillion:4,maxOutputTokens:30,outputTokenPolicy:'explicit_inference_override' as const,outputTokenPolicyBasis:'Synthetic control deliberately caps completion length.',maxRequestUsd:1,maxCalls:10,source:'https://example.test/synthetic-rate-not-production',verifiedAt:'2026-01-01T00:00:00Z'};
const config=(patch:Partial<ProviderBudgetConfig>={}):ProviderBudgetConfig=>({allowPaidRequests:true,maxUsd:2,maxCalls:10,requestTimeoutMs:1000,maxRequestBytes:100_000,rates:[testRate],...patch});
const usage=(input=100,output=20,cached=0,written=0)=>new Response(JSON.stringify({usage:{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:written}}}),{status:200});
const request=()=>({method:'POST',headers:{authorization:'Bearer test-secret'},body:JSON.stringify({model:'synthetic-test-model',input:'hello'})});
const url='https://api.openai.com/v1/responses';
const payload=()=>({schema_version:1,input_id:'i_'+'a'.repeat(24),view:'full',cache_policy:'disabled',evidence:{caption:'Public caption',description:null,hashtags:null,tagged_accounts:null,location_tag:null,source_geography:null,transcript:null},media:{frames:['frames/000.jpg','frames/001.jpg','frames/002.jpg'],duration_seconds:10,frame_timestamps_seconds:[0,5,9.9]}});
async function removeFixture(root:string){
  const resolved=path.resolve(root);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('gold-'));
  await rm(resolved,{recursive:true,force:true});
}

test('provider guard persists reservation before dispatch, caps output, records observed usage and hides secrets',async()=>{
  const events:ProviderLedgerEntry[]=[];let called=0;
  const ledger=new ProviderBudgetLedger(config(),async(_url,init)=>{
    called++;assert.equal(events[0]?.status,'reserved');assert.equal(init?.redirect,'error');
    const body=JSON.parse(init?.body as string);assert.equal(body.max_output_tokens,30);assert.equal(body.store,false);
    return usage(100,20,40);
  },async(entry)=>{events.push(entry);});
  await ledger.fetch(url,request());
  assert.equal(called,1);assert.equal(events[1]?.status,'complete');
  assert.equal(ledger.snapshot().provider_ledger_complete,true);
  assert.ok(Math.abs(ledger.snapshot().cost_usd!-0.00024)<1e-12);
  assert.equal(JSON.stringify(events).includes('test-secret'),false);
  assert.equal(ledger.snapshot().provider_usage[0]?.calls,1);
  assert.notEqual(events[0]?.original_request_sha256,events[0]?.request_sha256);
  assert.equal(events[0]?.transport_overrides[0]?.field,'max_output_tokens');
});

test('disabled requests, unknown endpoints, missing rates and reservation caps stop before spending',async()=>{
  for(const [cfg,target,code] of [
    [config({allowPaidRequests:false}),url,'paid_requests_disabled'],
    [config(),'https://example.test/social-source','provider_endpoint_not_allowed'],
    [config({rates:[]}),url,'missing_or_ambiguous_rate_card'],
    [config({maxUsd:0.000001}),url,'run_budget_reservation_exceeded'],
    [config({rates:[{...testRate,maxRequestUsd:0.000001}]}),url,'request_budget_reservation_exceeded'],
  ] as const){
    let called=0;const ledger=new ProviderBudgetLedger(cfg,async()=>{called++;return usage();},async()=>{});
    await assert.rejects(ledger.fetch(target,request()),new RegExp(code));assert.equal(called,0);
    assert.throws(()=>ledger.assertHealthy(),new RegExp(code));
  }
});

test('unknown billed usage is not zero and prevents a second request',async()=>{
  let called=0;const ledger=new ProviderBudgetLedger(config(),async()=>{called++;return new Response('{}');},async()=>{});
  await assert.rejects(ledger.fetch(url,request()),/provider_usage_missing/);
  await assert.rejects(ledger.fetch(url,request()),/provider_usage_missing/);
  assert.equal(called,1);assert.equal(ledger.snapshot().cost_usd,null);assert.equal(ledger.snapshot().provider_ledger_complete,false);
  assert.equal(ledger.entries[0]?.status,'unknown');assert.ok(ledger.snapshot().committed_budget_usd>0);
});

test('HTTP failure and unpersisted reservation never become successful zero-dollar calls',async()=>{
  const ledger=new ProviderBudgetLedger(config(),async()=>new Response('{}',{status:429}),async()=>{});
  await assert.rejects(ledger.fetch(url,request()),/provider_http_charge_unknown/);assert.equal(ledger.snapshot().cost_usd,null);
  assert.equal(ledger.snapshot().provider_calls,1);assert.equal(ledger.snapshot().reserved_attempts,1);
  let called=0;const badDisk=new ProviderBudgetLedger(config(),async()=>{called++;return usage();},async()=>{throw new Error('disk');});
  await assert.rejects(badDisk.fetch(url,request()),/ledger_reservation_persistence_failed/);assert.equal(called,0);
  assert.equal(badDisk.snapshot().provider_calls,0);assert.equal(badDisk.snapshot().reserved_attempts,1);
});

test('concurrent request reservations cannot oversubscribe one run budget',async()=>{
  let called=0,finish:(value:Response)=>void=()=>{};
  const ledger=new ProviderBudgetLedger(config({maxUsd:0.012}),async()=>{called++;return await new Promise<Response>((r)=>{finish=r;});},async()=>{});
  const first=ledger.fetch(url,request());await new Promise((r)=>setTimeout(r,0));
  await assert.rejects(ledger.fetch(url,request()),/run_budget_reservation_exceeded/);
  finish(usage());await first;assert.equal(called,1);assert.ok(ledger.snapshot().committed_budget_usd<=0.012);
});

test('Google exact field mask determines billed operation and credentials never enter ledger',async()=>{
  const cfg=config({rates:[{operation:'google_text_search',fieldMask:'places.id,places.location',requestUsd:0.02,maxRequestUsd:0.02,maxCalls:2,source:testRate.source,verifiedAt:testRate.verifiedAt}]});
  const ledger=new ProviderBudgetLedger(cfg,async()=>new Response('{"places":[]}'),async()=>{});
  await ledger.fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'x-goog-fieldmask':'places.location,places.id','x-goog-api-key':'test-secret'},body:'{"textQuery":"test"}'});
  assert.equal(ledger.snapshot().cost_usd,0.02);
  await assert.rejects(ledger.fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'x-goog-fieldmask':'places.photos'},body:'{}'}),/missing_or_ambiguous_rate_card/);
  assert.equal(JSON.stringify(ledger.entries).includes('test-secret'),false);
});

test('legacy Google HTTP-200 error envelopes are not mislabeled as measured successful charges',async()=>{
  const cfg=config({rates:[{operation:'google_legacy_search',requestUsd:0.04,maxRequestUsd:0.04,maxCalls:2,source:testRate.source,verifiedAt:testRate.verifiedAt}]});
  const ledger=new ProviderBudgetLedger(cfg,async()=>new Response('{"status":"REQUEST_DENIED"}'),async()=>{});
  await assert.rejects(ledger.fetch('https://maps.googleapis.com/maps/api/place/textsearch/json?query=synthetic&key=test-secret'),/provider_api_status_charge_unknown/);
  assert.equal(ledger.snapshot().cost_usd,null);assert.equal(ledger.entries[0]?.provider_status,'REQUEST_DENIED');
});

test('retained PCM audio duration reserves transcription cost and remains in the physical request ledger',async()=>{
  const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  const ledger=new ProviderBudgetLedger(config({rates:[{operation:'openai_transcription',model:'synthetic-audio',audioUsdPerMinute:0.06,maxRequestUsd:0.01,maxCalls:1,source:testRate.source,verifiedAt:testRate.verifiedAt}]}),async()=>new Response('{}'),async()=>{});
  const form=new FormData();form.append('model','synthetic-audio');form.append('file',new Blob([wav]),'audio.wav');
  await ledger.fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',body:form});
  assert.equal(ledger.entries[0]?.audio_seconds,1);assert.equal(ledger.snapshot().cost_usd,0.001);assert.equal(ledger.snapshot().provider_usage[0]?.calls,1);
});

test('Gemini request output caps and thinking usage enter the same measured ledger',async()=>{
  const ledger=new ProviderBudgetLedger(config({rates:[{...testRate,operation:'gemini_generate',model:'synthetic-gemini'}]}),async(_url,init)=>{
    assert.equal(JSON.parse(init?.body as string).generationConfig.maxOutputTokens,30);
    return new Response(JSON.stringify({usageMetadata:{promptTokenCount:100,candidatesTokenCount:10,thoughtsTokenCount:5}}));
  },async()=>{});
  await ledger.fetch('https://generativelanguage.googleapis.com/v1beta/models/synthetic-gemini:generateContent?key=test-secret',{method:'POST',body:'{"contents":[],"generationConfig":{"temperature":0}}'});
  assert.equal(ledger.entries[0]?.output_tokens,15);assert.ok(Math.abs(ledger.snapshot().cost_usd!-0.00026)<1e-12);
  assert.equal(JSON.stringify(ledger.entries).includes('test-secret'),false);
});

test('verified provider ceiling preserves model generation settings and undeclared mutation is rejected',async()=>{
  const rate={...testRate,operation:'gemini_generate' as const,model:'synthetic-gemini',outputTokenPolicy:'verified_provider_ceiling' as const,outputTokenPolicyBasis:'Synthetic provider ceiling, not a production claim.'};
  const body='{"contents":[],"generationConfig":{"temperature":0}}';
  const ledger=new ProviderBudgetLedger(config({rates:[rate]}),async(_url,init)=>{
    assert.equal(init?.body,body);return new Response(JSON.stringify({usageMetadata:{promptTokenCount:5,candidatesTokenCount:4}}));
  },async()=>{});
  await ledger.fetch('https://generativelanguage.googleapis.com/v1beta/models/synthetic-gemini:generateContent',{method:'POST',body});
  assert.equal(ledger.entries[0]?.original_request_sha256,ledger.entries[0]?.request_sha256);assert.deepEqual(ledger.entries[0]?.transport_overrides,[]);
  assert.throws(()=>new ProviderBudgetLedger(config({rates:[{...rate,outputTokenPolicy:undefined}]}),async()=>usage(),async()=>{}),/explicit_output_token_policy_required/);
});

test('cache writes and full-request long-context tiers are reserved and charged independently',async()=>{
  for(const input of [100,101]){
    const rate={...testRate,maxInputTokens:200,longContext:{aboveInputTokens:100,inputUsdPerMillion:4,cachedInputUsdPerMillion:2,cacheWriteInputUsdPerMillion:5,outputUsdPerMillion:6}};
    const ledger=new ProviderBudgetLedger(config({rates:[rate]}),async()=>usage(input,20,30,40),async()=>{});
    await ledger.fetch(url,request());
    const expected=input===100?(30*2+30*1+40*2.5+20*4)/1e6:(31*4+30*2+40*5+20*6)/1e6;
    assert.ok(Math.abs(ledger.snapshot().cost_usd!-expected)<1e-12);assert.equal(ledger.entries[0]?.cache_write_tokens,40);
    assert.equal(ledger.entries[0]?.applied_rate_tier,input===100?'standard':'long_context');
    assert.equal(ledger.entries[0]?.input_token_upper_bound,200);
    assert.equal(ledger.entries[0]?.reservation_usd,(200*5+30*6)/1e6);
  }
});

test('missing cache-write usage and unexpected tool output cannot produce a complete cost',async()=>{
  for(const response of [
    {usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:0}}},
    {usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:'web_search_call'}]},
  ]){
    const ledger=new ProviderBudgetLedger(config(),async()=>new Response(JSON.stringify(response)),async()=>{});
    await assert.rejects(ledger.fetch(url,request()),/provider_usage_missing|unpriced_provider_tool_output/);
    assert.equal(ledger.snapshot().cost_usd,null);assert.equal(ledger.snapshot().provider_calls,1);
  }
  let calls=0;const ledger=new ProviderBudgetLedger(config(),async()=>{calls++;return usage();},async()=>{});
  await assert.rejects(ledger.fetch(url,{method:'POST',body:JSON.stringify({model:testRate.model,tools:[{type:'web_search'}]})}),/unpriced_model_tools/);assert.equal(calls,0);
});

test('verified pilot configuration validates with paid requests disabled and unchanged model generation ceilings',async()=>{
  const run=JSON.parse(await readFile('../../scripts/gold-dataset/configs/retained-baseline-pilot-2026-10-10.json','utf8')) as GoldRunConfiguration;
  assert.equal(configuredWorker(run).geminiModel,'gemini-3.5-flash-lite');assert.equal(run.budget.allowPaidRequests,false);
  const bounded=structuredClone(run);bounded.budget.rates.find((r)=>r.operation==='openai_responses')!.inputTokenPolicy='sol_high_image_patch_bound_v1';
  assert.equal(configuredWorker(bounded).geminiModel,'gemini-3.5-flash-lite');
  const sol=run.budget.rates.find((r)=>r.operation==='openai_responses')!;
  assert.equal(sol.outputTokenPolicy,'verified_provider_ceiling');assert.equal(sol.cacheWriteInputUsdPerMillion,5);assert.equal(sol.longContext?.aboveInputTokens,272000);
  assert.equal(run.budget.rates.find((r)=>r.operation==='google_legacy_search')?.requestUsd,0.04);
});

test('isolated adaptive configuration templates stay unfunded with independent flags and unchanged frame budgets',async()=>{
  for(const [name,taxonomy,street] of [['taxonomy',true,false],['literal-street',false,true],['taxonomy-street',true,true]] as const){
    const cfg=JSON.parse(await readFile('../../scripts/gold-dataset/configs/'+name+'-pilot-2026-10-10.json','utf8')) as GoldRunConfiguration;
    assert.equal(configuredWorker(cfg).geminiModel,'gemini-3.5-flash-lite');assert.equal(cfg.budget.allowPaidRequests,false);assert.equal(cfg.adaptive?.taxonomyCompatibility,taxonomy);assert.equal(cfg.adaptive?.literalSourceStreet,street);assert.equal(cfg.frames.maxFrames,24);
    assert.throws(()=>configuredWorker({...cfg,adaptive:{version:1,taxonomyCompatibility:taxonomy,literalSourceStreet:street,threshold:0} as any}),/invalid_adaptive_config/);
  }
});

test('masked evidence, labels, bad timestamps and external frame paths fail closed',()=>{
  assert.equal(validateGoldInput(payload()).media.frame_timestamps_seconds[2],9.9);
  const hidden=payload();hidden.view='visual_only';assert.throws(()=>validateGoldInput(hidden),/masked_view_contains_text/);
  assert.throws(()=>validateGoldInput({...payload(),labels:{expected:'secret'}}),/non_neutral_input_field/);
  const badTimes=payload();badTimes.media.frame_timestamps_seconds=[0,5,5];assert.throws(()=>validateGoldInput(badTimes),/invalid_frame_timestamps/);
  const external=payload();external.media.frames[0]='../../secret.jpg';assert.throws(()=>validateGoldInput(external),/invalid_neutral_frame_paths/);
  const raw=payload();raw.view='visual_pixel_text_masked';raw.evidence.caption=null as any;(raw.media as any).source_video={path:'source/video.mp4',sha256:'a'.repeat(64)};assert.throws(()=>validateGoldInput(raw),/view_forbids_raw_media/);
});

test('neutral JPEG timestamps select full timeline and true hash seam; missing timing cannot be inferred from filenames',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-input-test-'));
  try{
    await mkdir(path.join(root,'frames'));
    // A minimal JPEG SOF header is enough for our dimension parser; image decoding is stubbed.
    const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,20,0,10,1,1,0x11,0,0xff,0xd9]);
    const input=payload();await writeFile(path.join(root,'input.json'),JSON.stringify(input));
    for(const frame of input.media.frames)await writeFile(path.join(root,frame),jpeg);
    const loaded=await loadGoldInput(path.join(root,'input.json'));
    const prepared=await prepareGoldInput(loaded,{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},new AbortController().signal,async()=> '0123456789abcdef');
    assert.deepEqual(prepared.analyzeInput.frames.map((f)=>f.timestampSeconds),[0,9.9]);
    assert.equal(prepared.analyzeInput.frames[1]?.width,10);assert.equal(prepared.analyzeInput.frames[1]?.height,20);
    assert.equal(prepared.trace.retained_grid_approximation,true);
    assert.equal(prepared.analyzeInput.canonicalUrl,'neutral://materialized-source');
    const textFirst=await prepareGoldInput(loaded,{strategy:'text_only',maxFrames:24,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},new AbortController().signal,async()=>{throw new Error('text_lane_must_not_decode_images');});
    assert.equal(textFirst.analyzeInput.frames.length,0);
    assert.equal(textFirst.analyzeInput.metadataDescription,prepared.analyzeInput.metadataDescription);
    assert.equal(textFirst.trace.input_sha256,prepared.trace.input_sha256);
    const noTiming=payload();(noTiming.media as any).frame_timestamps_seconds=[];assert.throws(()=>validateGoldInput(noTiming),/invalid_frame_timestamps/);
  }finally{await removeFixture(root);}
});

test('prediction projection never promotes a provider parent or invents country from absent fields',()=>{
  const place=observedPlace({name:'Test Place',googlePlaceId:'abc',formattedAddress:'An address',latitude:1,longitude:2},'slot-1');
  assert.equal(place?.place_id,'google:abc');assert.equal(place?.country,null);assert.equal(place?.city,null);
  assert.deepEqual(place?.coordinates,{lat:1,lng:2});assert.equal(observedPlace({providerParent:{name:'Parent'}}),null);
  assert.equal(observedPlace({name:'Native scene',googlePlaceId:'nearr-native:test:1,2'})?.place_id,'nearr-native:test:1,2');
});

test('observed scoring pool retains rejected provider identities separately without fabricating their coordinates',()=>{
  const score=(id:string)=>({googlePlaceId:id,name:'Retrieved '+id,rawScore:50,normalizedScore:.5,rejected:true,rejectionReason:'score_below_acceptance',reasons:['provider_match']});
  const resolver={candidates:[{googlePlaceId:'retained',name:'Retained provider',latitude:1,longitude:2,formattedAddress:'Real provider address'}],diagnostics:{mentionResults:[{mentionId:'m1',scoring:[score('rejected'),score('retained'),score('nearr-native:model-only')]},{mentionId:'m2',scoring:[score('rejected')]}]}};
  const pool=observedScoringPool(resolver);assert.equal(pool.length,2);
  assert.equal(pool[0]?.place_id,'google:rejected');assert.equal(pool[0]?.coordinates,null);assert.equal(pool[0]?.address,null);assert.equal(pool[0]?.scoring_observations.length,2);
  assert.deepEqual(pool[1]?.coordinates,{lat:1,lng:2});assert.equal(pool[1]?.address,'Real provider address');
  assert.deepEqual(observedScoringPool({automaticDeepRuntime:{hypotheses:[{name:'Model lead'}]}}),[]);
});

test('CLI validation path reads neutral inputs without output creation or provider dispatch',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-cli-validation-'));
  const savedFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('network_forbidden');};
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];await writeFile(path.join(root,'input.json'),JSON.stringify(input));
    const configuration:GoldRunConfiguration={version:1,runtime:{analysisProvider:'gemini',geminiModel:'synthetic-pinned-gemini',automaticDeepRecognitionEnabled:true,vayrinFrameBudget:6,vayrinFrameStrategy:'diverse',jobTimeoutMs:1000},frames:{strategy:'runtime_schedule',maxFrames:24,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},decisionContext:{autoSaveAuthorized:true,auditRecordPresent:true},budget:config({allowPaidRequests:false})};
    const result=await runGoldInference({inputs:[path.join(root,'input.json')],configuration,outDir:path.join(root,'must-not-exist'),execute:false});
    assert.equal('validated_inputs'in result?result.validated_inputs:null,1);assert.equal(calls,0);assert.equal(result.provider_calls,0);
    await assert.rejects(runGoldInference({inputs:[path.join(root,'input.json')],configuration,outDir:path.join(root,'must-not-exist'),execute:true}),/paid_requests_disabled/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=savedFetch;await removeFixture(root);}
});

test('CLI imports from repository cwd under a clean provider-only child environment',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-cli-process-'));
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];
    await writeFile(path.join(root,'input.json'),JSON.stringify(input));await writeFile(path.join(root,'inputs.json'),JSON.stringify([path.join(root,'input.json')]));
    const repo=fileURLToPath(new URL('../../../',import.meta.url));
    const loader=new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).href;
    const result=spawnSync(process.execPath,['--import',loader,path.join(repo,'services/media-worker/src/cli/recognitionGoldInference.ts'),'--inputs',path.join(root,'inputs.json'),'--config',path.join(repo,'scripts/gold-dataset/configs/retained-baseline-pilot-2026-10-10.json')],{cwd:repo,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??''},encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).provider_calls,0);assert.equal(JSON.parse(result.stdout).validated_inputs,1);
  }finally{await removeFixture(root);}
});

test('actual runtime adapter retains provider failure as failed observation with unknown cost',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-runtime-test-'));
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];
    await writeFile(path.join(root,'input.json'),JSON.stringify(input));
    const loaded=await loadGoldInput(path.join(root,'input.json'));
    const ledger=new ProviderBudgetLedger(config(),async()=>new Response('{}'),async()=>{});
    const output=await executeGoldInput({loaded,config:{googlePlacesServerApiKey:'unused'} as any,frames:{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},context:{autoSaveAuthorized:true,auditRecordPresent:true},ledger,signal:new AbortController().signal,
      model:{name:'stub',async analyze(){await ledger.fetch(url,request()).catch(()=>{});return {provider:'stub',promptVersion:'test',evidence:emptyEvidence()};}},resolve:async()=>{throw new Error('must_not_resolve');}});
    assert.equal(output.status,'failed');assert.equal(output.autonomous,false);assert.equal(output.cost_usd,null);
    assert.equal(output.provider_ledger_complete,false);assert.equal('error_code' in output?output.error_code:null,'provider_usage_missing');
  }finally{await removeFixture(root);}
});

test('grounding and finalization reject an unobserved claimed caption even when the resolver likes a candidate',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-grounding-test-'));
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];
    await writeFile(path.join(root,'input.json'),JSON.stringify(input));
    const loaded=await loadGoldInput(path.join(root,'input.json'));
    const ledger=new ProviderBudgetLedger(config({allowPaidRequests:false}),async()=>{throw new Error('network_forbidden');},async()=>{});
    const evidence={...emptyEvidence(),insufficientEvidence:false,places:[{name:'Unobserved Copper Finch',category:'restaurant',address:null,city:null,region:null,country:null,coordinates:null,role:'primary',confidence:.99,explicitEvidence:[{source:'caption',value:'Unobserved Copper Finch',timestampSeconds:null}],inferredEvidence:[],memoryCue:null,memoryCueEvidence:[]}]};
    const candidate={googlePlaceId:'synthetic-a',name:'Unobserved Copper Finch',latitude:10,longitude:20,formattedAddress:'123 Test Street',types:['restaurant'],confidenceScore:.99,evidence:[],reasons:[]};
    let resolverCalls=0;
    const result=await executeGoldInput({loaded,config:{googlePlacesServerApiKey:'unused'} as any,frames:{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},context:{autoSaveAuthorized:true,auditRecordPresent:true},ledger,signal:new AbortController().signal,model:{name:'stub',async analyze(){return {provider:'stub',promptVersion:'test',evidence:evidence as any};}},resolve:async()=>{resolverCalls++;return {decision:'auto_save',safeToAutoSave:true,primaryCandidate:candidate,candidates:[candidate],diagnostics:{}} as any;}});
    assert.equal(result.autonomous,false);assert.deepEqual(result.places,[]);assert.equal(result.cost_usd,0);assert.equal(result.status,'review');
    assert.equal(resolverCalls,0);
  }finally{await removeFixture(root);}
});

test('per-place finalization preserves every accepted multi destination and actual alternative in retrieval ranking',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-multi-test-'));
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];input.evidence.transcript='Visit Copper Finch and Amber Steps.' as any;
    await writeFile(path.join(root,'input.json'),JSON.stringify(input));const loaded=await loadGoldInput(path.join(root,'input.json'));
    const evidence={...emptyEvidence(),multipleIntentionalPlaces:true,insufficientEvidence:false,places:['Copper Finch','Amber Steps'].map((name)=>({name,category:'restaurant',address:null,city:null,region:null,country:null,coordinates:null,role:'primary',confidence:.97,explicitEvidence:[{source:'speech',value:name,timestampSeconds:1}],inferredEvidence:[],memoryCue:null,memoryCueEvidence:[]}))};
    for(const partial of [false,true]){
      const ledger=new ProviderBudgetLedger(config({allowPaidRequests:false}),async()=>{throw new Error('network_forbidden');},async()=>{});
      const result=await executeGoldInput({loaded,config:{googlePlacesServerApiKey:'unused'} as any,frames:{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},context:{autoSaveAuthorized:true,auditRecordPresent:true},ledger,signal:new AbortController().signal,model:{name:'stub',async analyze(){return {provider:'stub',promptVersion:'test',evidence:evidence as any};}},resolve:async(args)=>{
        const mentionResults=args.mentions!.map((mention,i)=>{
          const candidate={googlePlaceId:'synthetic-'+i,name:mention.displayName,latitude:10+i,longitude:20,formattedAddress:'123 Test Street',types:['restaurant'],confidenceScore:.97,evidence:[],reasons:[]};
          const options=partial&&i===1?[candidate,{...candidate,googlePlaceId:'synthetic-alternative',latitude:11.01}]:[candidate];
          return {mentionId:mention.id,displayName:mention.displayName,outcome:partial&&i===1?'ambiguous_candidates':'verified_single',candidates:options,scoring:options.map((option)=>({googlePlaceId:option.googlePlaceId,name:option.name,rawScore:100,normalizedScore:.97,reasons:['business_type','compact_name_match','distinctive_token_match'],rejected:false,rejectionReason:null}))};
        });
        return {decision:'multi_candidate_confirmation',safeToAutoSave:false,candidates:mentionResults.flatMap((m)=>m.candidates),diagnostics:{mentionResults}} as any;
      }});
      assert.equal(result.status,'completed');assert.equal(result.autonomous,true);assert.equal(result.multi_place_detected,true);
      assert.equal(result.places.length,partial?1:2);assert.equal(result.candidates.length,partial?3:2);
      assert.equal(result.observed_scoring_pool_available,true);assert.equal(result.observed_scoring_pool.length,partial?3:2);
      assert.equal(result.places[0]?.name,'Copper Finch');assert.equal(result.candidates[0]?.name,'Copper Finch');
      assert.equal(result.candidates[1]?.name,'Amber Steps');
      for(const selected of result.places)assert.ok(result.candidates.some((c)=>c.place_id===selected.place_id));
      assert.equal(result.inference_evidence.grounded_model_evidence.places.length,2);
      assert.equal(result.inference_evidence.normal_specificity.specific,true);
      assert.equal(result.inference_evidence.resolver_result.candidates.length,partial?3:2);
      assert.equal(result.inference_evidence.deterministic_features.canonical_entity_count,2);
      assert.equal(result.inference_evidence.deterministic_features.role_counts.primary,2);
    }
  }finally{await removeFixture(root);}
});

test('Automatic Deep retrieval includes saved primary, canonical alternatives and all multi destinations without granting autonomy',()=>{
  const hypothesis=(i:number)=>({name:'Synthetic Place '+i,city:'Synthetic City',region:'Synthetic Region',country:'Synthetic Country',confidence:'HIGH',evidenceBasis:'EXPLICIT_SOURCE_TEXT',canonicalStatus:'VERIFIED',entityType:'VENUE',supportingClues:['Synthetic evidence'],canonical:{googlePlaceId:'synthetic-deep-'+i,name:'Synthetic Place '+i,formattedAddress:'Synthetic Address '+i,latitude:10+i,longitude:20,types:['restaurant']}});
  for(const count of [1,4]){
    const runtime={schemaVersion:1,outcome:'PREMIUM_ACTIONABLE_RESULT',destinations:Array.from({length:count},(_,i)=>({logicalDestinationId:'slot-'+i,decision:'AUTO_SAVE',hypotheses:[hypothesis(i)]}))};
    const plan=planMediaFinalization({groundedEvidence:emptyEvidence() as any,automaticDeepRuntime:runtime,sourceGeography:null,context:{autoSaveAuthorized:true,auditRecordPresent:true}});
    const candidates=scoredCandidates(plan,undefined,runtime);
    assert.equal(candidates.length,count);assert.equal(candidates[0]?.place_id,'google:synthetic-deep-0');
    assert.equal(candidates[0]?.city,'Synthetic City');assert.deepEqual(candidates[0]?.coordinates,{lat:10,lng:20});
    assert.equal(plan.autonomousPlaces.length,count===1?1:0);assert.equal(plan.reviewCandidates.length,count===1?0:4);
    for(const selected of plan.autonomousPlaces)assert.ok(candidates.some((c)=>c.place_id==='google:'+selected.candidate.googlePlaceId));
  }
  const reviewPlan=planMediaFinalization({groundedEvidence:emptyEvidence() as any,automaticDeepRuntime:{schemaVersion:1,outcome:'PREMIUM_ACTIONABLE_RESULT',destinations:[{logicalDestinationId:'ambiguous',decision:'REVIEW',hypotheses:[hypothesis(0),hypothesis(1)]}]},sourceGeography:null,context:{autoSaveAuthorized:true,auditRecordPresent:true}});
  assert.deepEqual(scoredCandidates(reviewPlan).map((c)=>c.place_id),['google:synthetic-deep-0','google:synthetic-deep-1']);
  assert.equal(reviewPlan.autonomousPlaces.length,0);
  const leadRuntime={schemaVersion:1,outcome:'PREMIUM_ACTIONABLE_RESULT',destinations:[{logicalDestinationId:'lead',decision:'REVIEW',hypotheses:[{...hypothesis(0),canonical:null,providerParent:{googlePlaceId:'parent-id',name:'Broad Parent',latitude:50,longitude:60}}]}]};
  const leadPlan=planMediaFinalization({groundedEvidence:emptyEvidence() as any,automaticDeepRuntime:leadRuntime,sourceGeography:null,context:{autoSaveAuthorized:true,auditRecordPresent:true}});
  for(const candidates of [scoredCandidates(leadPlan),scoredCandidates(leadPlan,undefined,leadRuntime)]){
    assert.equal(candidates[0]?.name,'Synthetic Place 0');assert.equal(candidates[0]?.place_id,null);assert.equal(candidates[0]?.coordinates,null);
    assert.equal(candidates.some((c)=>c.name==='Broad Parent'),false);
  }
});

test('runtime pre-resolve preserves grounded canonical and partial survivors but does not resolve empty evidence',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-pre-resolve-test-'));
  try{
    const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];input.evidence.transcript='Visit Copper Finch.' as any;
    await writeFile(path.join(root,'input.json'),JSON.stringify(input));const loaded=await loadGoldInput(path.join(root,'input.json'));
    const canonical={name:'Copper Finch',category:'restaurant',address:null,city:null,region:null,country:null,coordinates:null,role:'primary',confidence:.97,explicitEvidence:[{source:'speech',value:'Copper Finch',timestampSeconds:1}],inferredEvidence:[],memoryCue:null,memoryCueEvidence:[]};
    const partial={nameHint:'Copper Finch',category:'restaurant',categoryConfidence:.5,categoryEvidenceTags:[],addressHint:null,city:null,region:null,country:null,role:'primary',confidence:.5,explicitEvidence:canonical.explicitEvidence,validationErrors:['malformed_sibling']};
    for(const mode of ['canonical','partial','empty','technical'] as const){
      const ledger=new ProviderBudgetLedger(config({allowPaidRequests:false}),async()=>{throw new Error('network_forbidden');},async()=>{});let resolveCalls=0;
      const evidence={...emptyEvidence(),places:mode==='canonical'?[canonical]:[],partialPlaces:mode==='partial'?[partial]:[]};
      const result=await executeGoldInput({loaded,config:{googlePlacesServerApiKey:'unused'} as any,frames:{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},context:{autoSaveAuthorized:true,auditRecordPresent:true},ledger,signal:new AbortController().signal,model:{name:'stub',async analyze(){return {provider:'stub',promptVersion:'test',evidence:evidence as any,...(mode!=='empty'?{recognitionFailureClass:'candidate_field_invalid' as const}:{})};}},resolve:async()=>{resolveCalls++;return {decision:'manual_entry',safeToAutoSave:false,candidates:[],diagnostics:{}} as any;}});
      assert.equal(resolveCalls,mode==='canonical'||mode==='partial'?1:0,mode);
      assert.equal(result.status,mode==='technical'?'failed':'review',mode);assert.equal(result.provider_ledger_complete,true);assert.equal(result.cost_usd,0);
    }
  }finally{await removeFixture(root);}
});

test('runtime literal street option reads original source text and only extends retrieval queries',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-literal-test-'));
  try{
    let baselineMention:any;
    for(const mode of ['disabled','enabled','model-only-address'] as const){
      const input=payload();input.view='text_only';input.media.frames=[];input.media.frame_timestamps_seconds=[];input.evidence.caption=mode==='model-only-address'?'Visit Copper Finch cafe.':'Copper Finch cafe, 17 Pine Street.';
      await writeFile(path.join(root,'input.json'),JSON.stringify(input));const loaded=await loadGoldInput(path.join(root,'input.json'));
      const place={name:'Copper Finch',category:'cafe',address:mode==='model-only-address'?'99 Fabricated Street':null,city:null,region:null,country:null,coordinates:null,role:'primary',confidence:.97,explicitEvidence:[{source:'caption',value:'Copper Finch',timestampSeconds:null}],inferredEvidence:[],memoryCue:null,memoryCueEvidence:[]};
      const ledger=new ProviderBudgetLedger(config({allowPaidRequests:false}),async()=>{throw new Error('network_forbidden');},async()=>{});let resolves=0;
      const result=await executeGoldInput({loaded,config:{googlePlacesServerApiKey:'unused'} as any,frames:{strategy:'runtime_schedule',maxFrames:2,intervalSeconds:1,deduplicate:true,ffmpegPath:'unused'},context:{autoSaveAuthorized:true,auditRecordPresent:true},adaptive:{version:1,taxonomyCompatibility:false,literalSourceStreet:mode!=='disabled'},ledger,signal:new AbortController().signal,model:{name:'stub',async analyze(){return {provider:'stub',promptVersion:'test',evidence:{...emptyEvidence(),insufficientEvidence:false,places:[place]} as any};}},resolve:async(args)=>{
        resolves++;const mention=args.mentions![0]!,copy=structuredClone(mention) as any;
        if(mode==='disabled'){assert.equal(args.nameDrivenDeps,undefined);baselineMention=copy;}
        else{
          const query=args.nameDrivenDeps!.queryExtension!('Copper Finch',mention,args.geoContext!);
          assert.equal(query,mode==='enabled'?'Copper Finch 17 Pine Street':'Copper Finch');
          if(mode==='enabled'){assert.equal(copy.adaptiveSourceStreet.retrievalOnly,true);delete copy.adaptiveSourceStreet;assert.deepEqual(copy,baselineMention);}
        }
        return {decision:'manual_entry',safeToAutoSave:false,candidates:[],diagnostics:{}} as any;
      }});
      assert.equal(resolves,1);assert.equal(result.autonomous,false);assert.equal(result.provider_calls,0);
      if(mode==='enabled')assert.equal(result.inference_evidence.adaptive_source_street.hints.length,1);
      if(mode==='model-only-address')assert.equal(result.inference_evidence.adaptive_source_street.hints.length,0);
    }
  }finally{await removeFixture(root);}
});
