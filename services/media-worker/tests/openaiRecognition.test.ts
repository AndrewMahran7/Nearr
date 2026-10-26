import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig,type WorkerConfig } from '../src/config/env.js';
import { selectModelProvider,type AnalyzeInput } from '../src/providers/model.js';
import { OPENAI_RECOGNITION_LIMITS,openAiModelCost } from '../src/providers/openaiRecognition.js';
import { MediaError } from '../src/types/media.js';
import { withAutomaticDeepRecognition } from '../src/automaticDeep/automaticDeepRecognitionProvider.js';

const settings={enabled:true,allowedRoute:'openai_only',apiKey:'OFFLINE_FIXTURE_ONLY',model:'explicit-test-model',timeoutMs:5000,maxOutputTokens:4000,
  inputPricePerMillion:4,cachedInputPricePerMillion:0.4,outputPricePerMillion:20,pricingReference:'SYNTHETIC_TEST_PRICES_NOT_LIVE'};
function config(override:Partial<NonNullable<WorkerConfig['openaiRecognition']>>={}):WorkerConfig {
  return {...loadConfig(),analysisProvider:'openai',maxSelectedFrames:24,openaiRecognition:{...settings,...override}};
}
function input(over:Partial<AnalyzeInput>={}):AnalyzeInput {
  return {platform:'instagram',canonicalUrl:'https://example.invalid/private-source',transcript:[],ocr:[],frames:[],signal:new AbortController().signal,
    metadataTitle:'Example Cafe in Boston',...over};
}
const place={name:'Example Cafe',category:'cafe',city:'Boston',confidence:0.95,explicitEvidence:[{source:'caption',value:'Example Cafe in Boston'}],
  memoryCue:'A note should not be kept during recognition',memoryCueEvidence:[{source:'caption',value:'Example Cafe in Boston'}]};
function body(output:unknown={places:[place],insufficientEvidence:false}) {
  return {status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof output==='string'?output:JSON.stringify(output)}]}],
    usage:{input_tokens:1000,output_tokens:200,total_tokens:1200,input_tokens_details:{cached_tokens:300},output_tokens_details:{reasoning_tokens:50}}};
}
function provider(cfg=config(),response=body(),capture?:(url:unknown,options:RequestInit|undefined)=>void) {
  return selectModelProvider(cfg,{offlineFixtureTransport:(async (url,options)=>{capture?.(url,options);return Response.json(response);}) as typeof fetch});
}
test('candidate disabled by default and gate cannot be bypassed by offline transport',async()=>{
  assert.equal(loadConfig().openaiRecognition?.enabled,false);
  for(const override of [{enabled:false},{allowedRoute:'gemini'},{allowedRoute:''},{apiKey:''},{model:''}]) {
    let calls=0;
    await assert.rejects(provider(config(override),body(),()=>{calls++;}).analyze(input()),MediaError);
    assert.equal(calls,0);
  }
});
test('Responses contract is fixed OpenAI only with no stored response tools or source URL',async()=>{
  let request:Record<string,unknown>={};
  const output=await provider(config(),body(),(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options?.redirect,'error');
    request=JSON.parse(String(options?.body));assert.equal((options?.headers as Record<string,string>).authorization,'Bearer OFFLINE_FIXTURE_ONLY');
    assert.doesNotMatch(String(options?.body),/example.invalid\/private-source/);
  }).analyze(input());
  assert.equal(request.model,'explicit-test-model');assert.equal(request.store,false);assert.equal(request.max_output_tokens,4000);
  assert.deepEqual(request.text,{format:{type:'json_object'}});assert.equal(request.tools,undefined);
  assert.equal(output.provider,'openai');assert.equal(output.evidence.places.length,1);assert.ok(output.grouping);
  assert.equal(output.evidence.places[0]?.memoryCue,null);assert.equal(output.modelRawPreview,undefined);
  assert.deepEqual(output.usage,{inputTokens:1000,outputTokens:200,totalTokens:1200,thinkingTokens:50});
  assert.equal(output.providerCost?.estimatedUsd,0.00692);
});
test('saved-place note uses same place-scoped prompt/parser and bypasses grouping',async()=>{
  let request='';
  const output=await provider(config(),body('Crispy waffles with fresh berries.'),(_url,options)=>{request=String(options?.body);}).analyze(input({
    targetPlace:{name:'Example Cafe',category:'cafe'},retainedEvidence:[{source:'frame',value:'crispy waffles and fresh berries',timestampSeconds:4}],
  }));
  assert.match(request,/finalSavedPlace/);assert.doesNotMatch(request,/'json_object'/);
  assert.equal(JSON.parse(request).text,undefined);assert.equal(output.grouping,undefined);
  assert.equal(output.evidence.places[0]?.name,'Example Cafe');assert.equal(output.evidence.places[0]?.memoryCue,'Crispy waffles with fresh berries.');
  assert.ok(output.evidence.places[0]?.memoryCueEvidence.some(item=>item.value==='crispy waffles and fresh berries'));
});
test('malformed and incomplete responses cannot create candidate success',async()=>{
  const malformed=await provider(config(),body('{invalid-json')).analyze(input());
  assert.equal(malformed.recognitionFailureClass,'model_schema_invalid');assert.equal(malformed.evidence.places.length,0);
  await assert.rejects(provider(config(),{...body(),status:'incomplete'}).analyze(input()),/openai_incomplete_response/);
  const invalid=await provider(config(),body({places:[{...place,name:42}]})).analyze(input());
  assert.equal(invalid.evidence.places.length,0);assert.equal(invalid.recognitionFailureClass,'candidate_field_invalid');
});
test('unobserved claimed speech is removed before resolver input',async()=>{
  const output=await provider(config(),body({places:[{...place,explicitEvidence:[{source:'speech',value:'Never actually spoken'}]}]})).analyze(input());
  assert.equal(output.evidence.places[0]?.explicitEvidence.length,0);
});
test('unknown pricing or missing usage stays unknown instead of zero cost',async()=>{
  const output=await provider(config({pricingReference:''})).analyze(input());assert.equal(output.providerCost?.estimatedUsd,null);
  const missing=body();delete (missing as {usage?:unknown}).usage;
  const missingOutput=await provider(config(),missing).analyze(input());assert.equal(missingOutput.usage,undefined);assert.equal(missingOutput.providerCost?.estimatedUsd,null);
  assert.equal(openAiModelCost(output.usage,99_000,settings),0.0044);
});
test('HTTP throttling and transport failures propagate without another provider attempt',async()=>{
  let calls=0;
  const unavailable=selectModelProvider(config(),{offlineFixtureTransport:(async()=>{calls++;return new Response('secret vendor body',{status:429,headers:{'retry-after':'15'}});}) as typeof fetch});
  await assert.rejects(unavailable.analyze(input()),(error:unknown)=>error instanceof MediaError && error.code==='provider_rate_limited' && error.retryAfterSeconds===15 && !error.message.includes('secret'));
  assert.equal(calls,1);
  const failure=selectModelProvider(config(),{offlineFixtureTransport:(async()=>{throw new Error('secret key URL');}) as typeof fetch});
  await assert.rejects(failure.analyze(input()),/openai_transport_failure/);
});
test('deadline and caller cancellation abort without a Gemini fallback',async()=>{
  const slow=selectModelProvider(config({timeoutMs:10}),{offlineFixtureTransport:((_url,options)=>new Promise<Response>((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(Response.json(body())),1000);
    options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});
  })) as typeof fetch});
  await assert.rejects(slow.analyze(input()),/openai_timeout/);
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(provider(config(),body(),()=>{calls++;}).analyze(input({signal:controller.signal})),/openai_aborted/);assert.equal(calls,0);
});
test('response byte budget rejects large body rather than parsing unbounded vendor data',async()=>{
  const large=selectModelProvider(config(),{offlineFixtureTransport:(async()=>new Response('x'.repeat(OPENAI_RECOGNITION_LIMITS.responseBytes+1))) as typeof fetch});
  await assert.rejects(large.analyze(input()),/openai_response_too_large/);
});
test('frame count and bytes are bounded before dispatch and retained timestamps describe sent frames',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nearr-openai-offline-'));
  try {
    const imagePath=path.join(directory,'frame.jpg');await writeFile(imagePath,Buffer.from([0xff,0xd8,0xff]));
    const frames=Array.from({length:15},(_,i)=>({path:imagePath,timestampSeconds:i,width:100,height:100,aHash:'1',reason:'interval' as const}));
    let request='';const output=await provider(config(),body(),(_url,options)=>{request=String(options?.body);}).analyze(input({frames}));
    assert.equal(output.modelInput?.frameCount,12);assert.deepEqual(output.modelInput?.timestampsSeconds,Array.from({length:12},(_,i)=>i));
    assert.equal((request.match(/input_image/g)||[]).length,12);
    await writeFile(imagePath,Buffer.alloc(OPENAI_RECOGNITION_LIMITS.frameBytes+1));let calls=0;
    await assert.rejects(provider(config(),body(),()=>{calls++;}).analyze(input({frames})),/openai_frame_budget_exceeded/);assert.equal(calls,0);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
test('oversized text is bounded and output token configuration has a hard ceiling',async()=>{
  let request='';await provider(config({maxOutputTokens:100_000}),body(),(_url,options)=>{request=String(options?.body);}).analyze(input({
    metadataTitle:'x'.repeat(50_000),transcript:Array.from({length:300},(_,i)=>({startSeconds:i,endSeconds:i+1,text:'t'.repeat(1000)})),
  }));
  const parsed=JSON.parse(request);assert.equal(parsed.max_output_tokens,8000);assert.ok(parsed.input[0].content[0].text.length<=OPENAI_RECOGNITION_LIMITS.contextCharacters);
});

test('new candidate cannot silently invoke the separate legacy Sol recovery route',async()=>{
  let calls=0;
  const cfg=config();cfg.automaticDeepRecognitionEnabled=true;
  const base=provider(cfg,body({places:[],insufficientEvidence:true}));
  const wrapped=withAutomaticDeepRecognition(base,cfg,async()=>{calls++;throw new Error('unqualified recovery');});
  assert.equal(wrapped,base);await wrapped.analyze(input());assert.equal(calls,0);
});
