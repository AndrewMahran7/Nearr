import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { prepareGoldAudio,validateGoldLocalTranscript,goldAudioPcmDuration,type GoldLocalTranscript } from '../src/evaluation/goldAudio.js';
import { ProviderBudgetLedger } from '../src/evaluation/providerBudgetLedger.js';
import type { LoadedGoldInput } from '../src/evaluation/goldInputAdapter.js';
import { loadGoldInput } from '../src/evaluation/goldInputAdapter.js';
import { executeGoldInput } from '../src/evaluation/goldRuntimeAdapter.js';
import { runGoldInference,configuredWorker } from '../src/cli/recognitionGoldInference.js';
import { emptyEvidence } from '../src/types/evidence.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function wav(){
  const bytes=Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);return bytes;
}
const audio=wav(),source=Buffer.from('Synthetic neutral source; media decoding is stubbed.');
function sidecar():GoldLocalTranscript{return {
  schema_version:1,purpose:'gold_evaluation_local_asr',source_video_sha256:hash(source),
  audio:{sha256:hash(audio),format:'pcm_s16le_wav',sample_rate_hz:16000,channels:1,duration_seconds:1,extractor:{name:'ffmpeg',version:'synthetic'}},
  engine:{implementation:'openai-whisper',version:'synthetic',model:'medium',checkpoint_sha256:'b'.repeat(64)},
  inference:{started_at:'2026-01-01T00:00:00.000Z',completed_at:'2026-01-01T00:00:01.000Z',elapsed_ms:875,hardware:{device:'cpu',device_name:'synthetic',runtime_version:null},configuration:{language:null,task:'transcribe',fp16:false,temperature:0,beam_size:5,best_of:null,condition_on_previous_text:true,word_timestamps:false,initial_prompt:null,audio_preprocessing:'none'}},
  result:{status:'ok',language:'en',text:'Synthetic spoken words.',segments:[{start_seconds:.1,end_seconds:.9,text:'Synthetic spoken words.'}]},
};}
const budget=(fetcher:typeof fetch=async()=>{throw new Error('network_forbidden');})=>new ProviderBudgetLedger({allowPaidRequests:true,maxUsd:.1,maxCalls:2,requestTimeoutMs:1000,maxRequestBytes:100_000,rates:[{operation:'openai_transcription',model:'whisper-1',audioUsdPerMinute:.006,maxRequestUsd:.01,maxCalls:2,source:'https://example.test/synthetic-audio-rate',verifiedAt:'2026-01-01T00:00:00Z'}]},fetcher,async()=>{});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),'gold-audio-test-'));await mkdir(path.join(directory,'source'));await writeFile(path.join(directory,'source/video.mp4'),source);
  const loaded:LoadedGoldInput={directory,inputSha256:'c'.repeat(64),framePaths:[],sourceVideoPath:path.join(directory,'source/video.mp4'),input:{schema_version:1,input_id:'i_'+'a'.repeat(24),view:'full',cache_policy:'disabled',evidence:{caption:null,description:null,hashtags:null,tagged_accounts:null,location_tag:null,source_geography:null,transcript:'Old retained text.'},media:{frames:[],frame_timestamps_seconds:[],duration_seconds:1,source_video:{path:'source/video.mp4',sha256:hash(source)},audio_allowed:true}}};
  const cfg={transcriptionApiKey:'synthetic-test-key',jobTimeoutMs:1000,maxDurationSeconds:30} as any;
  const probe={hasVideo:true,hasAudio:true,durationSeconds:1,container:'mp4',videoCodec:null,audioCodec:null,width:null,height:null,frameRate:null,rotation:null};
  const tempDirectories:string[]=[];
  const dependencies={inspect:async()=>probe,extract:async(_cfg:any,_source:any,_probe:any,dir:string)=>{tempDirectories.push(dir);const target=path.join(dir,'audio.wav');await writeFile(target,audio);return target;}};
  const args={loaded,config:cfg,ledger:budget(),signal:new AbortController().signal,dependencies};
  return {args,probe,tempDirectories,async receipt(value=sidecar()) {const bytes=Buffer.from(JSON.stringify(value));await writeFile(path.join(directory,'source/transcript.local.json'),bytes);return {path:'source/transcript.local.json' as const,sha256:hash(bytes)};},async cleanup(){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('gold-audio-test-'));await rm(target,{recursive:true,force:true});for(const dir of tempDirectories)await assert.rejects(stat(dir),/ENOENT/);}};
}

test('local ASR contract rejects extra labels, prompt hints, missing provenance and timestamps outside original audio',()=>{
  assert.equal(validateGoldLocalTranscript(sidecar()).inference.elapsed_ms,875);
  const pythonUtc=sidecar();pythonUtc.inference.started_at='2026-01-01T00:00:00.000000+00:00';pythonUtc.inference.completed_at='2026-01-01T00:00:01.000000+00:00';assert.equal(validateGoldLocalTranscript(pythonUtc).inference.elapsed_ms,875);
  for(const edit of [(s:any)=>{s.labels={place:'secret'};},(s:any)=>{s.inference.configuration.initial_prompt='Secret venue';},(s:any)=>{delete s.engine.checkpoint_sha256;},(s:any)=>{s.result.segments[0].end_seconds=2;},(s:any)=>{s.purpose='truth_review';},(s:any)=>{s.result.text='Different transcript';}]){
    const s=sidecar();edit(s);assert.throws(()=>validateGoldLocalTranscript(s));
  }
});

test('PCM validation requires the actual mono 16k sample format',()=>{
  assert.equal(goldAudioPcmDuration(audio),1);const bad=Buffer.from(audio);bad.writeUInt16LE(2,22);assert.throws(()=>goldAudioPcmDuration(bad),/audio_requires_mono_16k_pcm/);
});

test('optional audio pilot configurations remain unfunded and preserve baseline recognition settings',async()=>{
  for(const mode of ['openai','local']){
    const cfg=JSON.parse(await readFile('../../scripts/gold-dataset/configs/'+mode+'-asr-pilot-2026-10-10.json','utf8'));
    const worker=configuredWorker(cfg);assert.equal(cfg.budget.allowPaidRequests,false);assert.equal(worker.geminiModel,'gemini-3.5-flash-lite');assert.equal(worker.transcriptionProvider,mode==='openai'?'openai':'noop');
    if(mode==='openai'){assert.equal(worker.transcriptionModel,'whisper-1');assert.equal(cfg.budget.rates.find((r:any)=>r.operation==='openai_transcription').audioUsdPerMinute,.006);}
  }
});

test('retained mode preserves baseline text without inspecting media or invoking providers',async()=>{
  const f=await fixture();try{
    const result=await prepareGoldAudio({...f.args,options:{mode:'retained'},dependencies:{inspect:async()=>{throw new Error('must_not_probe');}}});
    assert.equal(result.transcript.segments[0]?.text,'Old retained text.');assert.equal(result.trace.provider_cost.provider_calls,0);assert.equal(result.trace.original_inference_elapsed_ms,null);
  }finally{await f.cleanup();}
});

test('local sidecar is source/audio hash bound and reports historical compute separately from loading',async()=>{
  const f=await fixture();try{
    const ref=await f.receipt();const result=await prepareGoldAudio({...f.args,options:{mode:'local-retained',localTranscript:ref}});
    assert.equal(result.transcript.provider,'local-retained');assert.equal(result.transcript.segments[0]?.startSeconds,.1);assert.equal(result.trace.original_inference_elapsed_ms,875);assert.equal(result.trace.provider_cost.provider_calls,0);assert.equal(result.trace.sidecar_sha256,ref.sha256);
    const wrong=sidecar();wrong.audio.sha256='d'.repeat(64);const wrongRef=await f.receipt(wrong);
    await assert.rejects(prepareGoldAudio({...f.args,options:{mode:'local-retained',localTranscript:wrongRef}}),/local_asr_audio_hash_mismatch/);
    await assert.rejects(prepareGoldAudio({...f.args,options:{mode:'local-retained',localTranscript:{...wrongRef,sha256:'e'.repeat(64)}}}),/local_asr_sidecar_hash_mismatch/);
  }finally{await f.cleanup();}
});

test('raw audio modes cannot undo view masks, use mutated source bytes or silently fall back to retained text',async()=>{
  const f=await fixture();try{
    for(const mode of ['openai','local-retained'] as const){
      f.args.loaded.input.media.audio_allowed=false;
      await assert.rejects(prepareGoldAudio({...f.args,options:{mode}}),/audio_not_permitted/);
      f.args.loaded.input.media.audio_allowed=true;f.args.loaded.input.view='visual_only';
      await assert.rejects(prepareGoldAudio({...f.args,options:{mode}}),/audio_not_permitted/);f.args.loaded.input.view='full';
    }
    await assert.rejects(prepareGoldAudio({...f.args,options:{mode:'local-retained'}}),/local_asr_reference_required/);
    const extraction=await prepareGoldAudio({...f.args,options:{mode:'openai'},dependencies:{...f.args.dependencies,extract:async()=>null}});
    assert.equal(extraction.transcript.status,'failed');assert.deepEqual(extraction.transcript.segments,[]);
    await writeFile(f.args.loaded.sourceVideoPath!,Buffer.from('Mutated source'));
    await assert.rejects(prepareGoldAudio({...f.args,options:{mode:'openai'}}),/audio_source_hash_mismatch/);
  }finally{await f.cleanup();}
});

test('audio-free media does not need a local sidecar and makes no request',async()=>{
  const f=await fixture();try{
    f.probe.hasAudio=false;
    for(const mode of ['openai','local-retained'] as const){const result=await prepareGoldAudio({...f.args,options:{mode}});assert.equal(result.transcript.status,'no_audio');assert.equal(result.trace.provider_cost.provider_calls,0);}
  }finally{await f.cleanup();}
});

test('fresh Whisper uses the production provider through the physical cost ledger and restores global fetch',async()=>{
  const f=await fixture(),priorFetch=globalThis.fetch;try{
    const ledger=budget(async(url,init)=>{
      assert.equal(String(url),'https://api.openai.com/v1/audio/transcriptions');assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('model'),'whisper-1');assert.equal(init.body.get('response_format'),'verbose_json');
      return new Response(JSON.stringify({language:'en',segments:[{start:.2,end:.8,text:'  Fresh   audio. '}]}));
    });
    const result=await prepareGoldAudio({...f.args,ledger,options:{mode:'openai'}});
    assert.equal(result.transcript.segments[0]?.text,'Fresh audio.');assert.equal(result.trace.provider_cost.provider_calls,1);assert.equal(result.trace.provider_cost.cost_usd,.0001);assert.equal(globalThis.fetch,priorFetch);
    const broken=budget(async()=>new Response('{}',{status:500}));
    await assert.rejects(prepareGoldAudio({...f.args,ledger:broken,options:{mode:'openai'}}),/provider_http_charge_unknown/);assert.equal(globalThis.fetch,priorFetch);assert.equal(broken.snapshot().cost_usd,null);
  }finally{await f.cleanup();}
});

test('immutable local sidecar passes CLI validation and supplies timestamped ASR to the actual runtime adapter',async()=>{
  const f=await fixture();try{
    const file=f.args.loaded.sourceVideoPath!;
    const video=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=16x16:r=10:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(video.status,0,video.stderr);
    const referenceWav=path.join(f.args.loaded.directory,'reference.wav');
    const extracted=spawnSync('ffmpeg',['-y','-i',file,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',referenceWav],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(extracted.status,0,extracted.stderr);
    const sourceHash=hash(await readFile(file)),wavBytes=await readFile(referenceWav),s=sidecar();
    s.source_video_sha256=sourceHash;s.audio.sha256=hash(wavBytes);s.audio.duration_seconds=goldAudioPcmDuration(wavBytes);
    const ref=await f.receipt(s),input=f.args.loaded.input;
    input.media.source_video!.sha256=sourceHash;input.media.local_transcript=ref;input.media.frames=['frames/000.jpg'];input.media.frame_timestamps_seconds=[0];
    await mkdir(path.join(f.args.loaded.directory,'frames'));
    await writeFile(path.join(f.args.loaded.directory,'frames/000.jpg'),Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,20,0,10,1,1,0x11,0,0xff,0xd9]));
    const inputFile=path.join(f.args.loaded.directory,'input.json');await writeFile(inputFile,JSON.stringify(input));
    const loaded=await loadGoldInput(inputFile),configuration=JSON.parse(await readFile('../../scripts/gold-dataset/configs/retained-baseline-pilot-2026-10-10.json','utf8'));
    configuration.audio={mode:'local-retained',ffprobePath:'ffprobe'};
    const validated=await runGoldInference({inputs:[inputFile],configuration,outDir:path.join(f.args.loaded.directory,'must-not-create'),execute:false});
    assert.equal('validated_inputs' in validated?validated.validated_inputs:null,1);assert.equal(validated.provider_calls,0);
    let analyses=0;
    const result=await executeGoldInput({loaded,config:{...f.args.config,ffmpegPath:'ffmpeg',ffprobePath:'ffprobe',jobTimeoutMs:10000},frames:{strategy:'runtime_schedule',maxFrames:1,intervalSeconds:1,deduplicate:true,ffmpegPath:'ffmpeg'},context:{autoSaveAuthorized:true,auditRecordPresent:true},audio:{mode:'local-retained',localTranscript:ref},ledger:f.args.ledger,signal:f.args.signal,hashImage:async()=>'0'.repeat(16),model:{name:'synthetic',async analyze(actual){analyses++;assert.deepEqual(actual.transcript,[{startSeconds:.1,endSeconds:.9,text:'Synthetic spoken words.'}]);return {provider:'synthetic',promptVersion:'test',evidence:emptyEvidence()};}},resolve:async()=>{throw new Error('must_not_resolve');}});
    assert.equal(analyses,1);assert.equal(result.inference_boundary,'retained_visual_evidence_local_asr_live_runtime');assert.equal(result.provider_calls,0);assert.equal(result.inference_evidence.audio_evidence.trace.original_inference_elapsed_ms,875);assert.equal(result.status,'review');
    const baseline=await runGoldInference({inputs:[inputFile],configuration:{...configuration,audio:{mode:'retained'}},outDir:'unused',execute:false});assert.equal(baseline.provider_calls,0);
  }finally{await f.cleanup();}
});
