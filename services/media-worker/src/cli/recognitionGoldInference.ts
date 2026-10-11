/** Explicit, isolated local runner. No dataset/label/split/map readers or DB clients. */
import path from 'node:path';
import { readFile,mkdir,writeFile,appendFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { loadConfig,type WorkerConfig } from '../config/env.js';
import { selectModelProvider, type AnalyzeOutput } from '../providers/model.js';
import { withAutomaticDeepRecognition } from '../automaticDeep/automaticDeepRecognitionProvider.js';
import { loadGoldInput,type GoldFrameConfig } from '../evaluation/goldInputAdapter.js';
import { ProviderBudgetLedger,type ProviderBudgetConfig } from '../evaluation/providerBudgetLedger.js';
import { executeGoldInput,type GoldDecisionContext } from '../evaluation/goldRuntimeAdapter.js';
import type { GoldAudioMode } from '../evaluation/goldAudio.js';
import type { GoldOcrMode } from '../evaluation/goldOcr.js';
import { parseAdaptiveRecognitionConfig,type AdaptiveRecognitionConfig } from '../../../../lib/adaptiveRecognitionConfig.ts';
import { evaluateAdaptiveNormalSpecificity } from '../automaticDeep/adaptiveNormalSpecificity.js';
import { PLACES_SEARCH_FIELD_MASK } from '../../../../supabase/functions/process-share-link/places/googlePlaces.ts';
import { PREMIUM_PLACES_FIELD_MASK } from '../premium/placesQuerySession.js';
import { SOL_PARITY_MODEL } from '../solParity/types.js';

export type GoldRunConfiguration={
  version:1;
  runtime:{analysisProvider:'gemini';geminiModel:string;automaticDeepRecognitionEnabled:boolean;vayrinFrameBudget:number;vayrinFrameStrategy:'uniform'|'pipeline'|'diverse'|'all';jobTimeoutMs:number};
  frames:GoldFrameConfig;
  audio?:{mode:GoldAudioMode;ffprobePath?:string};
  ocr?:{mode:GoldOcrMode};
  adaptive?:AdaptiveRecognitionConfig;
  decisionContext:GoldDecisionContext;
  budget:ProviderBudgetConfig;
};
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
let activeRun=false;

function onlyKeys(value:unknown,keys:string[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some((k)=>!keys.includes(k)))throw new Error('invalid_run_configuration_fields');
}

/** Hash code only, never data, labels, mappings, credentials or repository metadata. */
async function runtimeSourceFingerprint(){
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
  const files:Array<{path:string;sha256:string}>=[];
  async function walk(relative:string){
    for(const entry of await readdir(path.join(repo,relative),{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;
      const rel=path.posix.join(relative,entry.name);
      if(entry.isDirectory())await walk(rel);
      else if(entry.isFile()&&/\.[cm]?tsx?$/.test(entry.name))files.push({path:rel,sha256:sha(await readFile(path.join(repo,rel)))});
    }
  }
  for(const root of ['services/media-worker/src','lib','supabase/functions/process-share-jobs','supabase/functions/process-share-link'])await walk(root);
  files.sort((a,b)=>a.path.localeCompare(b.path));return {sha256:sha(JSON.stringify(files)),files};
}

export function configuredWorker(run:GoldRunConfiguration):WorkerConfig{
  onlyKeys(run,['version','runtime','frames','audio','ocr','adaptive','decisionContext','budget']);
  parseAdaptiveRecognitionConfig(run.adaptive);
  onlyKeys(run.runtime,['analysisProvider','geminiModel','automaticDeepRecognitionEnabled','vayrinFrameBudget','vayrinFrameStrategy','jobTimeoutMs']);
  onlyKeys(run.frames,['strategy','maxFrames','intervalSeconds','deduplicate','ffmpegPath']);
  onlyKeys(run.decisionContext,['autoSaveAuthorized','auditRecordPresent']);
  onlyKeys(run.budget,['allowPaidRequests','maxUsd','maxCalls','requestTimeoutMs','maxRequestBytes','rates']);
  if(run.audio){onlyKeys(run.audio,['mode','ffprobePath']);if(!['retained','openai','local-retained'].includes(run.audio.mode)||(run.audio.mode!=='retained'&&(typeof run.audio.ffprobePath!=='string'||!run.audio.ffprobePath)))throw new Error('explicit_audio_configuration_required');}
  if(run.ocr){onlyKeys(run.ocr,['mode']);if(!['retained','local-retained'].includes(run.ocr.mode))throw new Error('explicit_ocr_configuration_required');}
  if(run.version!==1||run.runtime.analysisProvider!=='gemini'||!run.runtime.geminiModel||/latest/i.test(run.runtime.geminiModel)||!Number.isInteger(run.runtime.vayrinFrameBudget)||run.runtime.vayrinFrameBudget<1||run.runtime.vayrinFrameBudget>256||!Number.isInteger(run.runtime.jobTimeoutMs)||run.runtime.jobTimeoutMs<1)throw new Error('explicit_pinned_runtime_configuration_required');
  if(typeof run.decisionContext.autoSaveAuthorized!=='boolean'||typeof run.decisionContext.auditRecordPresent!=='boolean')throw new Error('decision_context_required');
  if(typeof run.runtime.automaticDeepRecognitionEnabled!=='boolean'||!['uniform','pipeline','diverse','all'].includes(run.runtime.vayrinFrameStrategy)||!['runtime_schedule','uniform','diverse','adaptive','text_only'].includes(run.frames.strategy)||!Number.isInteger(run.frames.maxFrames)||run.frames.maxFrames<1||run.frames.maxFrames>256||!Number.isFinite(run.frames.intervalSeconds)||run.frames.intervalSeconds<=0||typeof run.frames.deduplicate!=='boolean'||typeof run.frames.ffmpegPath!=='string'||!run.frames.ffmpegPath)throw new Error('explicit_frame_configuration_required');
  if(!Array.isArray(run.budget.rates)||typeof run.budget.allowPaidRequests!=='boolean')throw new Error('explicit_budget_configuration_required');
  for(const rate of run.budget.rates){onlyKeys(rate,['operation','model','fieldMask','inputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteInputUsdPerMillion','outputUsdPerMillion','maxInputTokens','longContext','requestUsd','audioUsdPerMinute','maxOutputTokens','outputTokenPolicy','outputTokenPolicyBasis','maxRequestUsd','maxCalls','source','verifiedAt']);if(rate.longContext)onlyKeys(rate.longContext,['aboveInputTokens','inputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteInputUsdPerMillion','outputUsdPerMillion']);}
  // Constructing a ledger validates all numeric bounds without dispatching a call.
  new ProviderBudgetLedger(run.budget,async()=>{throw new Error('configuration_validation_no_network');},async()=>{});
  // No dotenv loading: the caller supplies only already-authorized provider credentials.
  const base=loadConfig();
  return Object.freeze({...base,analysisProvider:'gemini',geminiModel:run.runtime.geminiModel,automaticDeepRecognitionEnabled:run.runtime.automaticDeepRecognitionEnabled,vayrinFrameBudget:run.runtime.vayrinFrameBudget,vayrinFrameStrategy:run.runtime.vayrinFrameStrategy,jobTimeoutMs:run.runtime.jobTimeoutMs,maxSelectedFrames:run.frames.maxFrames,frameIntervalSeconds:run.frames.intervalSeconds,ffmpegPath:run.frames.ffmpegPath,ffprobePath:run.audio?.ffprobePath??base.ffprobePath,transcriptionProvider:run.audio?.mode==='openai'?'openai':'noop',transcriptionModel:run.audio?.mode==='openai'?'whisper-1':base.transcriptionModel,ocrProvider:'model',vayrinVisualGeolocationEnabled:false,premiumSolWebSearchEnabled:false,premiumDistinctiveVisualAutoSaveEnabled:false,supabaseUrl:'',supabaseServiceRoleKey:'',finalizeUrl:'',mediaFinalizeSecret:'',workerSecret:'',mediaFetchProviderUrl:'',mediaFetchProviderApiKey:'',scrapeCreatorsApiKey:''});
}

export async function runGoldInference(args:{inputs:string[];configuration:GoldRunConfiguration;outDir:string;execute:boolean}){
  const cfg=configuredWorker(args.configuration);
  const adaptive=parseAdaptiveRecognitionConfig(args.configuration.adaptive);
  const loaded=[];
  for(const input of args.inputs)loaded.push(await loadGoldInput(input));
  if(!loaded.length||new Set(loaded.map((x)=>x.input.input_id)).size!==loaded.length)throw new Error('empty_or_duplicate_inputs');
  const audioMode=args.configuration.audio?.mode??'retained';
  const ocrMode=args.configuration.ocr?.mode??'retained';
  if(audioMode!=='retained'&&loaded.some((x)=>x.input.media.audio_allowed!==true||!x.sourceVideoPath))throw new Error('raw_audio_neutral_inputs_required');
  if(ocrMode==='local-retained'&&loaded.some((x)=>!x.input.media.local_ocr))throw new Error('local_ocr_neutral_inputs_required');
  const configHash=sha(JSON.stringify(args.configuration));
  if(!args.execute)return {validated_inputs:loaded.length,configuration_sha256:configHash,provider_calls:0};
  if(!args.configuration.budget.allowPaidRequests)throw new Error('paid_requests_disabled');
  const rates=args.configuration.budget.rates,mask=(text:string)=>text.split(',').map((x)=>x.trim()).sort().join(',');
  const required=[{operation:'gemini_generate',model:cfg.geminiModel},{operation:'google_text_search',fieldMask:PLACES_SEARCH_FIELD_MASK},{operation:'google_legacy_search'},{operation:'google_geocode'},...(cfg.automaticDeepRecognitionEnabled?[{operation:'openai_responses',model:SOL_PARITY_MODEL},{operation:'google_text_search',fieldMask:PREMIUM_PLACES_FIELD_MASK}]:[]),...(audioMode==='openai'?[{operation:'openai_transcription',model:'whisper-1'}]:[])];
  for(const need of required)if(rates.filter((rate)=>rate.operation===need.operation&&(!('model'in need)||rate.model===need.model)&&(!('fieldMask'in need)||!!rate.fieldMask&&mask(rate.fieldMask)===mask(need.fieldMask!))).length!==1)throw new Error('complete_runtime_rate_cards_required_before_execution');
  if(!cfg.geminiApiKey||!cfg.googlePlacesServerApiKey)throw new Error('required_provider_credentials_missing');
  if(audioMode==='openai'&&!cfg.transcriptionApiKey)throw new Error('openai_transcription_key_required');
  if(cfg.automaticDeepRecognitionEnabled&&!['VAYRIN_OPENAI_API_KEY','OPENAI_API_KEY','MEDIA_TRANSCRIPTION_API_KEY'].some((k)=>process.env[k]?.trim()))throw new Error('automatic_deep_provider_credential_missing');
  // This isolated process uses a fetch transport hook. Concurrent runs would
  // otherwise share guards and could restore the wrong transport.
  if(activeRun)throw new Error('concurrent_inference_run_forbidden');
  activeRun=true;
  try{
  const out=path.resolve(args.outDir);
  await mkdir(out); // Immutable run; an existing directory is never reused.
  const manifest={version:1,started_at:new Date().toISOString(),configuration:args.configuration,configuration_sha256:configHash,runtime_sources:await runtimeSourceFingerprint(),node_version:process.version,inputs:loaded.map((x)=>({input_id:x.input.input_id,input_sha256:x.inputSha256})),inference_boundary:(audioMode==='retained'?'retained_timed_evidence_live_runtime':audioMode==='openai'?'retained_visual_evidence_fresh_asr_live_runtime':'retained_visual_evidence_local_asr_live_runtime')+(ocrMode==='local-retained'?'_with_local_ocr':''),inference_output_limits:rates.filter((r)=>r.operation==='openai_responses'||r.operation==='gemini_generate').map((r)=>({operation:r.operation,model:r.model,policy:r.outputTokenPolicy,basis:r.outputTokenPolicyBasis,max_output_tokens:r.maxOutputTokens})),acquisition_included:false,audio_preparation_included:audioMode!=='retained',audio_mode:audioMode,ocr_mode:ocrMode,local_asr_original_compute_in_current_latency:false,local_ocr_original_compute_in_current_latency:false,canonical_database_writes:false};
  await writeFile(path.join(out,'run.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(out,'observations.jsonl'),'',{flag:'wx'});
  await writeFile(path.join(out,'provider-ledger.jsonl'),'',{flag:'wx'});
  const originalFetch=globalThis.fetch;
  const ledger=new ProviderBudgetLedger(args.configuration.budget,originalFetch,(entry)=>appendFile(path.join(out,'provider-ledger.jsonl'),JSON.stringify(entry)+'\n'));
  globalThis.fetch=ledger.fetch;
  let failures=0;
  try{
    const normalModel=selectModelProvider(cfg);let normalAnalysis:AnalyzeOutput|null=null,adaptiveTaxonomyTrace:unknown=null;
    const model=withAutomaticDeepRecognition({name:normalModel.name,async analyze(input){normalAnalysis=await normalModel.analyze(input);return normalAnalysis;}},cfg,undefined,adaptive.taxonomyCompatibility?{evaluateSpecificity(normal,input){const evaluated=evaluateAdaptiveNormalSpecificity(normal,adaptive,input);adaptiveTaxonomyTrace=evaluated.trace;return evaluated.specificity;}}:{});
    for(const input of loaded){
      normalAnalysis=null;
      adaptiveTaxonomyTrace=null;
      const timeout=AbortSignal.timeout(cfg.jobTimeoutMs);
      const signal=AbortSignal.any([timeout,ledger.abortController.signal]);
      const observation=await executeGoldInput({loaded:input,config:cfg,frames:args.configuration.frames,context:args.configuration.decisionContext,model,ledger,signal,normalAnalysis:()=>normalAnalysis,adaptive,adaptiveTaxonomyTrace:()=>adaptiveTaxonomyTrace,audio:{mode:audioMode,...(audioMode==='local-retained'&&input.input.media.local_transcript?{localTranscript:input.input.media.local_transcript}:{})},ocr:{mode:ocrMode,...(ocrMode==='local-retained'&&input.input.media.local_ocr?{localOcr:input.input.media.local_ocr}:{})}});
      if(observation.status==='failed')failures++;
      await appendFile(path.join(out,'observations.jsonl'),JSON.stringify(observation)+'\n');
    }
    await writeFile(path.join(out,'completion.json'),JSON.stringify({completed_at:new Date().toISOString(),inputs:loaded.length,failures,...ledger.snapshot()},null,2)+'\n',{flag:'wx'});
  }finally{globalThis.fetch=originalFetch;}
  return {inputs:loaded.length,failures,configuration_sha256:configHash,provider_calls:ledger.snapshot().provider_calls,reserved_attempts:ledger.snapshot().reserved_attempts,provider_ledger_complete:ledger.snapshot().provider_ledger_complete,cost_usd:ledger.snapshot().cost_usd};
  }finally{activeRun=false;}
}

async function main(){
  const argv=process.argv.slice(2),opts=new Map<string,string>();let execute=false;
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--execute'){execute=true;continue;}
    const key=argv[i]!;if(!['--inputs','--config','--out'].includes(key)||!argv[i+1])throw new Error('usage_inputs_config_out_optional_execute');
    if(opts.has(key))throw new Error('duplicate_argument');opts.set(key,argv[++i]!);
  }
  if(!opts.has('--inputs')||!opts.has('--config')||(execute&&!opts.has('--out')))throw new Error('usage_inputs_config_out_optional_execute');
  const inputs=JSON.parse(await readFile(opts.get('--inputs')!,'utf8'));
  if(!Array.isArray(inputs)||!inputs.every((x)=>typeof x==='string'))throw new Error('neutral_input_path_array_required');
  const configuration=JSON.parse(await readFile(opts.get('--config')!,'utf8'));
  console.log(JSON.stringify(await runGoldInference({inputs,configuration,outDir:opts.get('--out')??'',execute})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch((error)=>{console.error(error instanceof Error&&/^[a-zA-Z0-9_:-]+$/.test(error.message)?error.message:'gold_inference_failed');process.exitCode=1;});
