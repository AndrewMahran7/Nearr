import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile, mkdtemp, rm } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import type { TranscriptResult } from '../types/media.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { extractAudio } from '../pipeline/extractAudio.js';
import { selectTranscriptionProvider, type TranscriptionProvider } from '../providers/transcription.js';
import type { LoadedGoldInput } from './goldInputAdapter.js';
import type { ProviderBudgetLedger } from './providerBudgetLedger.js';

export type GoldAudioMode = 'retained' | 'openai' | 'local-retained';
export type GoldLocalTranscriptReference = {path:'source/transcript.local.json';sha256:string};
export type GoldAudioOptions = {mode:GoldAudioMode;localTranscript?:GoldLocalTranscriptReference};
export type GoldLocalTranscript = {
  schema_version:1;
  purpose:'gold_evaluation_local_asr';
  source_video_sha256:string;
  audio:{sha256:string;format:'pcm_s16le_wav';sample_rate_hz:16000;channels:1;duration_seconds:number;extractor:{name:'ffmpeg';version:string}};
  engine:{implementation:'openai-whisper';version:string;model:string;checkpoint_sha256:string};
  inference:{
    started_at:string;completed_at:string;elapsed_ms:number;
    hardware:{device:'cpu'|'cuda'|'mps';device_name:string;runtime_version:string|null};
    configuration:{language:string|null;task:'transcribe';fp16:boolean;temperature:number|number[];beam_size:number|null;best_of:number|null;condition_on_previous_text:boolean;word_timestamps:boolean;initial_prompt:null;audio_preprocessing:'none'|'vad_non_speech_gate_no_time_compaction'};
  };
  result:{status:'ok'|'no_speech';language:string|null;text:string;segments:Array<{start_seconds:number;end_seconds:number;text:string}>};
};

export class GoldAudioError extends Error { constructor(readonly code:string){super(code);this.name='GoldAudioError';} }
const fail=(code:string):never=>{throw new GoldAudioError(code);};
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const isHash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const text=(x:unknown,max=1000):x is string=>typeof x==='string'&&x.length>0&&x.length<=max;
const language=(x:unknown)=>x===null||text(x,100);
const normalize=(x:string)=>x.replace(/\s+/g,' ').trim();
function object(raw:unknown,allowed:string[]):Record<string,any>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_local_asr_object');
  const value=raw as Record<string,any>;
  if(Object.keys(value).some((key)=>!allowed.includes(key))||allowed.some((key)=>!(key in value)))fail('non_neutral_local_asr_field');
  return value;
}

/** Only evaluation-generation receipts are accepted. Review/adjudication ASR is
 * deliberately not an input format, even when it happens to contain a transcript.
 */
export function validateGoldLocalTranscript(raw:unknown):GoldLocalTranscript{
  const value=object(raw,['schema_version','purpose','source_video_sha256','audio','engine','inference','result']);
  if(value.schema_version!==1||value.purpose!=='gold_evaluation_local_asr'||!isHash(value.source_video_sha256))fail('invalid_local_asr_header');
  const audio=object(value.audio,['sha256','format','sample_rate_hz','channels','duration_seconds','extractor']);
  const extractor=object(audio.extractor,['name','version']);
  if(!isHash(audio.sha256)||audio.format!=='pcm_s16le_wav'||audio.sample_rate_hz!==16000||audio.channels!==1||!finite(audio.duration_seconds)||audio.duration_seconds<=0||extractor.name!=='ffmpeg'||!text(extractor.version,4000))fail('invalid_local_asr_audio');
  const engine=object(value.engine,['implementation','version','model','checkpoint_sha256']);
  if(engine.implementation!=='openai-whisper'||!text(engine.version)||!text(engine.model,100)||!isHash(engine.checkpoint_sha256))fail('invalid_local_asr_engine');
  const inference=object(value.inference,['started_at','completed_at','elapsed_ms','hardware','configuration']);
  if(!text(inference.started_at)||!text(inference.completed_at)||!/^\d{4}-\d\d-\d\dT.+(?:Z|\+00:00)$/.test(inference.started_at)||!/^\d{4}-\d\d-\d\dT.+(?:Z|\+00:00)$/.test(inference.completed_at)||!Number.isFinite(Date.parse(inference.started_at))||!Number.isFinite(Date.parse(inference.completed_at))||Date.parse(inference.completed_at)<Date.parse(inference.started_at)||!finite(inference.elapsed_ms))fail('invalid_local_asr_timing');
  const hardware=object(inference.hardware,['device','device_name','runtime_version']);
  if(!['cpu','cuda','mps'].includes(hardware.device)||!text(hardware.device_name)||!(hardware.runtime_version===null||text(hardware.runtime_version)))fail('invalid_local_asr_hardware');
  const cfg=object(inference.configuration,['language','task','fp16','temperature','beam_size','best_of','condition_on_previous_text','word_timestamps','initial_prompt','audio_preprocessing']);
  const temperatures=Array.isArray(cfg.temperature)?cfg.temperature:[cfg.temperature];
  if(!language(cfg.language)||cfg.task!=='transcribe'||typeof cfg.fp16!=='boolean'||!temperatures.length||!temperatures.every((x:unknown)=>finite(x)&&x<=1)||!['beam_size','best_of'].every((key)=>cfg[key]===null||(Number.isInteger(cfg[key])&&cfg[key]>0))||typeof cfg.condition_on_previous_text!=='boolean'||typeof cfg.word_timestamps!=='boolean'||cfg.initial_prompt!==null||!['none','vad_non_speech_gate_no_time_compaction'].includes(cfg.audio_preprocessing))fail('invalid_local_asr_configuration');
  const result=object(value.result,['status','language','text','segments']);
  if(!['ok','no_speech'].includes(result.status)||!language(result.language)||typeof result.text!=='string'||result.text.length>500_000||!Array.isArray(result.segments)||result.segments.length>20_000)fail('invalid_local_asr_result');
  let priorStart=0;
  for(const rawSegment of result.segments){
    const segment=object(rawSegment,['start_seconds','end_seconds','text']);
    if(!finite(segment.start_seconds)||!finite(segment.end_seconds)||segment.end_seconds<segment.start_seconds||segment.start_seconds<priorStart||segment.end_seconds>audio.duration_seconds+.1||!text(segment.text,50_000)||segment.text!==normalize(segment.text))fail('invalid_local_asr_segment');
    priorStart=segment.start_seconds;
  }
  if(result.text!==result.segments.map((s:any)=>s.text).join(' ')||(result.status==='ok')!==(result.segments.length>0))fail('inconsistent_local_asr_text');
  return structuredClone(value) as GoldLocalTranscript;
}

async function containedFile(directory:string,relative:string){
  const root=await realpath(directory);
  let current=root;
  if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some((p)=>!p||p==='.'||p==='..'))fail('audio_path_escape');
  for(const part of relative.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())fail('audio_symlink_forbidden');}
  const target=await realpath(current),rel=path.relative(root,target);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||!(await lstat(target)).isFile())fail('audio_path_escape');
  return target;
}

/** Exact production mono PCM contract, used to bind the local generation to the
 * current extraction. Never trusts a sidecar's asserted duration alone.
 */
export function goldAudioPcmDuration(bytes:Buffer):number{
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')fail('audio_requires_pcm_wav');
  let byteRate=0,dataSize=0;
  for(let offset=12;offset+8<=bytes.length;){
    const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);
    if(size>bytes.length-offset-8)fail('invalid_audio_wav_chunk');
    if(type==='fmt '){
      if(size<16||bytes.readUInt16LE(offset+8)!==1||bytes.readUInt16LE(offset+10)!==1||bytes.readUInt32LE(offset+12)!==16000||bytes.readUInt32LE(offset+16)!==32000||bytes.readUInt16LE(offset+20)!==2||bytes.readUInt16LE(offset+22)!==16)fail('audio_requires_mono_16k_pcm');
      byteRate=32000;
    }
    if(type==='data')dataSize+=size;
    offset+=8+size+(size%2);
  }
  if(!byteRate||!dataSize)fail('invalid_audio_duration');
  return dataSize/byteRate;
}

type Dependencies={inspect:typeof inspectMedia;extract:typeof extractAudio;provider:(cfg:WorkerConfig)=>TranscriptionProvider};
export type GoldAudioResult={transcript:TranscriptResult;trace:Record<string,unknown>&{stage_elapsed_ms:number;provider_cost:ReturnType<ProviderBudgetLedger['snapshot']>}};
let activeTranscription=false;

/** Optional ASR evidence stage. It neither reads labels nor runs a local model.
 * Caller substitutes transcript.segments into the ordinary AnalyzeInput. Fresh
 * OpenAI uses the real production provider through the same ledger transport;
 * local-retained reports original compute separately from current load latency.
 */
export async function prepareGoldAudio(args:{loaded:LoadedGoldInput;config:WorkerConfig;options:GoldAudioOptions;ledger:ProviderBudgetLedger;signal:AbortSignal;dependencies?:Partial<Dependencies>}):Promise<GoldAudioResult>{
  const started=performance.now(),sequence=args.ledger.entries.length;
  const {loaded,options,signal}=args,mode=options.mode;
  if(!['retained','openai','local-retained'].includes(mode)||(mode!=='local-retained'&&options.localTranscript!==undefined))fail('invalid_audio_options');
  args.ledger.assertHealthy();signal.throwIfAborted();
  const trace:Record<string,unknown>={mode,source_video_sha256:loaded.input.media.source_video?.sha256??null,audio_sha256:null,sidecar_sha256:null,original_inference_elapsed_ms:null,local_compute_cost_usd:null,transcription_model:mode==='openai'?'whisper-1':null,...(mode==='openai'?{provider_cost_basis:'PCM duration rounded up to a second times the frozen per-minute tariff: conservative duration tariff bound, not a verified invoice rounding rule.'}:{})};
  const finish=(transcript:TranscriptResult)=>({transcript,trace:{...trace,stage_elapsed_ms:performance.now()-started,provider_cost:args.ledger.snapshot(sequence)}});
  if(mode==='retained'){
    const retained=loaded.input.evidence.transcript;
    trace.boundary='Existing canonical transcript only; acquisition and original ASR latency/cost unavailable.';
    return finish({provider:'retained',segments:retained?[{startSeconds:0,endSeconds:loaded.input.media.duration_seconds??0,text:retained}]:[],language:null,status:retained?'success':'unavailable',...(retained?{}:{reason:'retained_transcript_absent'})});
  }
  if(loaded.input.media.audio_allowed!==true||['visual_only','visual_pixel_text_masked','text_only'].includes(loaded.input.view))fail('audio_not_permitted');
  const source=loaded.input.media.source_video??fail('neutral_audio_source_required');
  const declaredSourcePath=loaded.sourceVideoPath??fail('neutral_audio_source_required');
  const sourcePath=await containedFile(loaded.directory,'source/video.mp4');
  if(await realpath(declaredSourcePath)!==sourcePath||sha256(await readFile(sourcePath))!==source.sha256)fail('audio_source_hash_mismatch');
  const deps:Dependencies={inspect:inspectMedia,extract:extractAudio,provider:selectTranscriptionProvider,...args.dependencies};
  let sidecar:GoldLocalTranscript|undefined;
  if(mode==='local-retained'&&options.localTranscript!==undefined){
    const ref=options.localTranscript;
    if(!ref||ref.path!=='source/transcript.local.json'||!isHash(ref.sha256))fail('local_asr_reference_required');
    const file=await containedFile(loaded.directory,ref.path);
    if((await lstat(file)).size>8*1024*1024)fail('local_asr_sidecar_too_large');
    const bytes=await readFile(file);if(sha256(bytes)!==ref.sha256)fail('local_asr_sidecar_hash_mismatch');
    sidecar=validateGoldLocalTranscript(JSON.parse(bytes.toString('utf8')));
    if(sidecar.source_video_sha256!==source.sha256)fail('local_asr_source_hash_mismatch');
    trace.sidecar_sha256=ref.sha256;
  }
  const probeStarted=performance.now();
  const probe=await deps.inspect(args.config,sourcePath,signal);trace.probe_elapsed_ms=performance.now()-probeStarted;
  if(loaded.input.media.duration_seconds!==null&&Math.abs(probe.durationSeconds-loaded.input.media.duration_seconds)>.15)fail('audio_source_duration_mismatch');
  if(!probe.hasAudio){
    if(sidecar)fail('local_asr_for_absent_audio');
    return finish({provider:mode,segments:[],language:null,status:'no_audio',reason:'no_audio_stream'});
  }
  if(mode==='local-retained'&&!sidecar)fail('local_asr_reference_required');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'nearr-gold-audio-'));
  try{
    const extractionStarted=performance.now();
    const audioPath=await deps.extract(args.config,sourcePath,probe,temporary,signal);
    trace.extraction_elapsed_ms=performance.now()-extractionStarted;
    if(!audioPath){signal.throwIfAborted();return finish({provider:mode,segments:[],language:null,status:'failed',reason:'audio_extraction_failed'});}
    if(path.resolve(audioPath)!==path.join(temporary,'audio.wav')||(await lstat(audioPath)).isSymbolicLink())fail('unexpected_audio_output');
    if((await lstat(audioPath)).size>128*1024*1024)fail('audio_file_too_large');
    const bytes=await readFile(audioPath),duration=goldAudioPcmDuration(bytes),audioHash=sha256(bytes);
    Object.assign(trace,{audio_sha256:audioHash,audio_duration_seconds:duration});
    signal.throwIfAborted();
    if(sidecar){
      if(sidecar.audio.sha256!==audioHash||Math.abs(sidecar.audio.duration_seconds-duration)>1/16000)fail('local_asr_audio_hash_mismatch');
      Object.assign(trace,{boundary:'Evaluation-only local transcript; original local compute is reported separately from current preparation latency.',original_inference_elapsed_ms:sidecar.inference.elapsed_ms,local_generation:sidecar.inference,local_engine:sidecar.engine,transcription_model:sidecar.engine.model});
      return finish({provider:'local-retained',segments:sidecar.result.segments.map((s)=>({startSeconds:s.start_seconds,endSeconds:s.end_seconds,text:s.text})),language:sidecar.result.language,status:sidecar.result.status==='ok'?'success':'unavailable',...(sidecar.result.status==='no_speech'?{reason:'local_no_speech'}:{})});
    }
    if(!args.config.transcriptionApiKey)fail('openai_transcription_key_required');
    if(activeTranscription)fail('concurrent_audio_provider_scope');
    activeTranscription=true;
    const priorFetch=globalThis.fetch;
    try{
      globalThis.fetch=args.ledger.fetch.bind(args.ledger);
      const provider=deps.provider({...args.config,transcriptionProvider:'openai',transcriptionModel:'whisper-1'});
      const inferenceStarted=performance.now();
      const transcript=await provider.transcribe({audioPath,hasAudio:true,signal,sourceUrl:null,platform:'native'});
      trace.transcription_elapsed_ms=performance.now()-inferenceStarted;
      // Production transcription failure is non-fatal; uncertain paid usage is
      // not. Its catch block must not swallow a stopped ledger or an abort.
      args.ledger.assertHealthy();signal.throwIfAborted();
      trace.boundary='Fresh production whisper-1 on neutral full-source PCM; provider cost and stage latency measured in this run.';
      return finish(transcript);
    }finally{globalThis.fetch=priorFetch;activeTranscription=false;}
  }finally{
    const resolved=path.resolve(temporary);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('nearr-gold-audio-'))fail('unsafe_audio_cleanup_target');
    await rm(resolved,{recursive:true,force:true});
  }
}
