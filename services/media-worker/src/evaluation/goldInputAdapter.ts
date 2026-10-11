import path from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { AnalyzeInput } from '../providers/model.js';
import type { SelectedFrame } from '../types/media.js';
import { averageHashFromGray8x8 } from '../util/hash.js';
import { selectFrameTimestamps } from '../pipeline/extractFrames.js';
import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import { selectFramesForVayrin } from '../vayrin/frameSelection.js';
import { sourceGeographyFromTaggedLocation, sourceGeographyFromCaptionText, type SourceGeographyEvidence } from '../../../../lib/geographyConsistency.ts';
import type { MediaSourceMetadata } from '../../../../supabase/functions/process-share-jobs/mediaSourceMetadata.ts';
import { validateGoldLocalTranscript, type GoldLocalTranscriptReference } from './goldAudio.js';
import { loadGoldOcrReceipt, type GoldLocalOcrReference } from './goldOcr.js';
import { temporalProbeIndices, selectAdaptiveFrames } from './adaptiveFrameSelection.js';

const execFileAsync = promisify(execFile);
export const GOLD_VIEWS = ['full','description_hidden','location_hidden','visual_audio','visual_only','visual_pixel_text_masked','text_only'] as const;
export type GoldView = typeof GOLD_VIEWS[number];
export type GoldInput = {
  schema_version: 1;
  input_id: string;
  view: GoldView;
  evidence: {
    caption: string | null; description: string | null;
    hashtags: string[] | null; tagged_accounts: string[] | null;
    location_tag: string | null;
    source_geography: {country?:string|null;region?:string|null;city?:string|null} | null;
    transcript: string | null;
  };
  media: {
    frames: string[];
    duration_seconds: number | null;
    frame_timestamps_seconds: number[];
    source_video?: {path:string;sha256:string};
    audio_allowed?: boolean;
    local_transcript?: GoldLocalTranscriptReference;
    local_ocr?: GoldLocalOcrReference;
  };
  cache_policy: 'disabled';
};
export type LoadedGoldInput = {input:GoldInput;directory:string;inputSha256:string;framePaths:string[];sourceVideoPath:string|null};
export type GoldFrameConfig = {
  strategy: 'runtime_schedule' | 'uniform' | 'diverse' | 'adaptive' | 'text_only';
  maxFrames: number;
  intervalSeconds: number;
  deduplicate: boolean;
  ffmpegPath: string;
};
export class GoldInputError extends Error { constructor(readonly code:string) { super(code); this.name='GoldInputError'; } }
const fail = (code:string):never => {throw new GoldInputError(code);};
const record = (value:unknown):Record<string,any> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,any> : fail('expected_object');
const fields = (value:Record<string,any>,allowed:string[]) => { if(Object.keys(value).some((key)=>!allowed.includes(key))) fail('non_neutral_input_field'); };
const textOrNull = (value:unknown) => value==null ? null : typeof value==='string' && value.length<=500_000 ? value : fail('invalid_evidence_text');
const listOrNull = (value:unknown) => value==null ? null : Array.isArray(value) && value.every((x)=>typeof x==='string' && x.length<=10_000) ? value as string[] : fail('invalid_evidence_list');
const present = (value:unknown) => value!=null && value!=='' && (!Array.isArray(value)||value.length>0);
const hash = (value:Buffer) => createHash('sha256').update(value).digest('hex');

export function validateGoldInput(raw:unknown):GoldInput {
  const value=record(raw); fields(value,['schema_version','input_id','view','evidence','media','cache_policy']);
  if(value.schema_version!==1 || !/^i_[a-f0-9]{24}$/.test(value.input_id) || !GOLD_VIEWS.includes(value.view) || value.cache_policy!=='disabled') fail('invalid_gold_input_header');
  const e=record(value.evidence); fields(e,['caption','description','hashtags','tagged_accounts','location_tag','source_geography','transcript']);
  const evidence:GoldInput['evidence']={caption:textOrNull(e.caption),description:textOrNull(e.description),hashtags:listOrNull(e.hashtags),tagged_accounts:listOrNull(e.tagged_accounts),location_tag:textOrNull(e.location_tag),source_geography:null,transcript:textOrNull(e.transcript)};
  if(e.source_geography!=null){const geo=record(e.source_geography);fields(geo,['country','region','city']); evidence.source_geography={};for(const key of ['country','region','city'] as const) if(geo[key]!=null)evidence.source_geography[key]=textOrNull(geo[key]);}
  if(['visual_only','visual_pixel_text_masked'].includes(value.view) && Object.values(evidence).some(present)) fail('masked_view_contains_text');
  if(value.view==='visual_audio' && Object.entries(evidence).some(([key,v])=>key!=='transcript'&&present(v))) fail('visual_audio_contains_metadata');
  if(value.view==='description_hidden' && [evidence.caption,evidence.description,evidence.hashtags].some(present)) fail('description_hidden_contains_description');
  if(value.view==='location_hidden' && [evidence.location_tag,evidence.source_geography].some(present)) fail('location_hidden_contains_location');
  const m=record(value.media);fields(m,['frames','duration_seconds','frame_timestamps_seconds','source_video','audio_allowed','local_transcript','local_ocr']);
  if(!Array.isArray(m.frames)||m.frames.length>20_000||!m.frames.every((x:unknown)=>typeof x==='string'&&/^frames\/\d{3,}\.jpg$/.test(x as string))||new Set(m.frames).size!==m.frames.length)fail('invalid_neutral_frame_paths');
  if(m.duration_seconds!==null&&(!(typeof m.duration_seconds==='number')||!Number.isFinite(m.duration_seconds)||m.duration_seconds<=0))fail('invalid_duration');
  if(!Array.isArray(m.frame_timestamps_seconds)||m.frame_timestamps_seconds.length!==m.frames.length||m.frame_timestamps_seconds.some((x:unknown,i:number)=>typeof x!=='number'||!Number.isFinite(x)||x<0||m.duration_seconds===null||x>m.duration_seconds||(i>0&&x<=m.frame_timestamps_seconds[i-1])))fail('invalid_frame_timestamps');
  if(value.view==='text_only' && m.frames.length)fail('text_only_contains_frames');
  if(value.view!=='text_only' && !m.frames.length)fail('visual_frames_missing');
  if(m.audio_allowed!==undefined&&typeof m.audio_allowed!=='boolean')fail('invalid_audio_permission');
  if(['visual_only','visual_pixel_text_masked','text_only'].includes(value.view) && (m.source_video!=null||m.audio_allowed===true))fail('view_forbids_raw_media');
  let source:GoldInput['media']['source_video'];
  if(m.source_video!=null){const s=record(m.source_video);fields(s,['path','sha256']);if(s.path!=='source/video.mp4'||!/^[a-f0-9]{64}$/.test(s.sha256))fail('invalid_neutral_video');source={path:s.path,sha256:s.sha256};}
  let localTranscript:GoldLocalTranscriptReference|undefined;
  if(m.local_transcript!=null){const ref=record(m.local_transcript);fields(ref,['path','sha256']);if(!source||m.audio_allowed!==true||ref.path!=='source/transcript.local.json'||!/^[a-f0-9]{64}$/.test(ref.sha256))fail('invalid_neutral_local_transcript');localTranscript={path:ref.path,sha256:ref.sha256};}
  let localOcr:GoldLocalOcrReference|undefined;
  if(m.local_ocr!=null){const ref=record(m.local_ocr);fields(ref,['path','sha256','parent_input_sha256']);if(value.view==='text_only'||ref.path!=='source/ocr.local.json'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!/^[a-f0-9]{64}$/.test(ref.parent_input_sha256))fail('invalid_neutral_local_ocr');localOcr={path:ref.path,sha256:ref.sha256,parent_input_sha256:ref.parent_input_sha256};}
  return {schema_version:1,input_id:value.input_id,view:value.view,evidence,media:{frames:[...m.frames],duration_seconds:m.duration_seconds,frame_timestamps_seconds:[...m.frame_timestamps_seconds],...(source?{source_video:source}:{}),...(m.audio_allowed!==undefined?{audio_allowed:m.audio_allowed}:{}),...(localTranscript?{local_transcript:localTranscript}:{}),...(localOcr?{local_ocr:localOcr}:{})},cache_policy:'disabled'};
}

async function containedFile(root:string,relative:string):Promise<string>{
  if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some((part)=>!part||part==='.'||part==='..'))fail('input_path_escape');
  let current=root;
  for(const part of relative.split('/')){current=path.join(current,part);const stat=await lstat(current);if(stat.isSymbolicLink())fail('input_symlink_forbidden');}
  const target=await realpath(current),rel=path.relative(root,target);
  if(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel)||!(await lstat(target)).isFile())fail('input_path_escape');
  return target;
}

export async function loadGoldInput(inputFile:string):Promise<LoadedGoldInput>{
  if(path.basename(inputFile)!=='input.json')fail('neutral_input_filename_required');
  const rawRoot=path.resolve(path.dirname(inputFile));
  if((await lstat(rawRoot)).isSymbolicLink())fail('input_symlink_forbidden');
  const root=await realpath(rawRoot),file=await containedFile(root,'input.json');
  if((await lstat(file)).size>8*1024*1024)fail('input_json_too_large');
  const bytes=await readFile(file),input=validateGoldInput(JSON.parse(bytes.toString('utf8')));
  const framePaths:string[]=[];
  for(const relative of input.media.frames) framePaths.push(await containedFile(root,relative));
  const source=input.media.source_video;
  const sourceVideoPath=source?await containedFile(root,source.path):null;
  if(source&&sourceVideoPath&&hash(await readFile(sourceVideoPath))!==source.sha256)fail('neutral_video_hash_mismatch');
  if(input.media.local_transcript){
    const ref=input.media.local_transcript,file=await containedFile(root,ref.path);
    if((await lstat(file)).size>8*1024*1024)fail('local_transcript_too_large');
    const data=await readFile(file);if(hash(data)!==ref.sha256)fail('local_transcript_hash_mismatch');
    const local=validateGoldLocalTranscript(JSON.parse(data.toString('utf8')));
    if(local.source_video_sha256!==source?.sha256)fail('local_transcript_source_mismatch');
  }
  const loaded={input,directory:root,inputSha256:hash(bytes),framePaths,sourceVideoPath};
  if(input.media.local_ocr)await loadGoldOcrReceipt(loaded,input.media.local_ocr);
  return loaded;
}

export function jpegDimensions(bytes:Buffer):{width:number;height:number}{
  if(bytes[0]!==0xff||bytes[1]!==0xd8)fail('frame_not_jpeg');
  for(let offset=2;offset+4<=bytes.length;){
    if(bytes[offset]!==0xff)fail('invalid_jpeg_marker');
    while(bytes[offset]===0xff)offset++;
    const marker=bytes[offset++]!;
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>bytes.length)break;
    const size=bytes.readUInt16BE(offset);
    if(size<2||offset+size>bytes.length)fail('invalid_jpeg_size');
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      if(size<7)fail('invalid_jpeg_dimensions');
      const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
      if(!height||!width)fail('invalid_jpeg_dimensions');return {width,height};
    }
    offset+=size;
  }
  return fail('jpeg_dimensions_missing');
}

export async function hashFrameGray(file:string,ffmpegPath:string,signal:AbortSignal):Promise<string>{
  const {stdout}=await execFileAsync(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-i',file,'-frames:v','1','-vf','scale=8:8,format=gray','-f','rawvideo','pipe:1'],{encoding:'buffer',windowsHide:true,timeout:20_000,maxBuffer:4096,signal});
  if(stdout.length!==64)fail('invalid_frame_gray_hash');
  return averageHashFromGray8x8(stdout);
}

export async function prepareGoldInput(loaded:LoadedGoldInput,config:GoldFrameConfig,signal:AbortSignal,
  hashImage:(file:string,ffmpegPath:string,signal:AbortSignal)=>Promise<string>=hashFrameGray){
  if(!Number.isInteger(config.maxFrames)||config.maxFrames<1||config.maxFrames>256||!Number.isFinite(config.intervalSeconds)||config.intervalSeconds<=0||!['runtime_schedule','uniform','diverse','adaptive','text_only'].includes(config.strategy))fail('invalid_frame_configuration');
  const {input}=loaded, times=input.media.frame_timestamps_seconds;
  let indices:number[]=[];
  let plannedTimestamps:number[]=[];
  if(times.length&&config.strategy!=='text_only'){
    if(config.strategy==='runtime_schedule'){
      plannedTimestamps=selectFrameTimestamps(input.media.duration_seconds!,config.intervalSeconds,config.maxFrames).map((x)=>x.timestampSeconds);
      indices=[...new Set(plannedTimestamps.map((t)=>times.reduce((best,x,i)=>Math.abs(x-t)<Math.abs(times[best]!-t)?i:best,0)))];
    } else if(config.strategy==='uniform') {
      const count=Math.min(times.length,config.maxFrames);indices=Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(times.length-1)/(count-1)));
    } else if(config.strategy==='adaptive') indices=temporalProbeIndices(times);
    else indices=times.map((_,i)=>i);
  }
  const considered:SelectedFrame[]=[],frameHashes:Array<{timestamp_seconds:number;sha256:string}>=[];
  for(const i of indices){signal.throwIfAborted();const file=loaded.framePaths[i]!,bytes=await readFile(file);const dimensions=jpegDimensions(bytes),aHash=await hashImage(file,config.ffmpegPath,signal);if(!/^[a-f0-9]{16}$/.test(aHash))fail('invalid_perceptual_hash');considered.push({path:file,timestampSeconds:times[i]!,...dimensions,aHash,reason:'interval'});frameHashes.push({timestamp_seconds:times[i]!,sha256:hash(bytes)});}
  let selected=config.strategy==='diverse'?selectFramesForVayrin(considered,'diverse',config.maxFrames).frames:considered;
  let adaptiveTrace:unknown=null;
  if(config.strategy==='adaptive'){
    const result=selectAdaptiveFrames(considered,config.maxFrames,[input.evidence.caption,input.evidence.description,input.evidence.transcript].filter(Boolean).join('\n'));
    selected=result.frames;adaptiveTrace=result.trace;
  }
  selected=selected.map((frame,i)=>({...frame,reason:i===0?'first' as const:i===selected.length-1?'last' as const:'interval' as const}));
  if(config.deduplicate&&config.strategy!=='adaptive')selected=deduplicateFrames(selected);
  const e=input.evidence;
  const parts=[...new Set([e.caption,e.description].filter((x):x is string=>!!x))];
  for(const item of [...(e.hashtags??[]),...(e.tagged_accounts??[]).map((x)=>x.startsWith('@')?x:'@'+x)])if(!parts.some((p)=>p.includes(item)))parts.push(item);
  const description=parts.join('\n')||null;
  const sourceMetadata:MediaSourceMetadata={title:null,description,creatorHandle:null,postId:null,sourceId:null,creatorName:null,creatorId:null,location:e.location_tag};
  let sourceGeography:SourceGeographyEvidence|null=sourceGeographyFromTaggedLocation({taggedLocation:e.location_tag?{placeName:e.location_tag,provenance:'materialized_original_location_tag'}:null})??sourceGeographyFromCaptionText(description);
  if(!sourceGeography&&e.source_geography){
    const geo=e.source_geography;
    sourceGeography=sourceGeographyFromTaggedLocation({taggedLocation:{placeName:[geo.city,geo.region,geo.country].filter(Boolean).join(', '),provenance:'materialized_source_geography'}});
    if(sourceGeography)sourceGeography={...sourceGeography,locality:geo.city??null,region:geo.region??null,country:geo.country??null};
  }
  const analyzeInput:AnalyzeInput={platform:'native',canonicalUrl:'neutral://materialized-source',transcript:e.transcript?[{startSeconds:0,endSeconds:input.media.duration_seconds??0,text:e.transcript}]:[],ocr:[],ocrExtracted:false,frames:selected,metadataTitle:null,metadataDescription:description,metadataLocation:e.location_tag,metadataCreatorHandle:null,metadataCreatorName:null,signal};
  return {analyzeInput,sourceMetadata,sourceGeography,trace:{inference_boundary:'retained_timed_evidence_live_runtime',input_sha256:loaded.inputSha256,available_frames:times.length,planned_timestamps_seconds:plannedTimestamps,selected_timestamps_seconds:selected.map((f)=>f.timestampSeconds),frame_selection:config.strategy,deduplicate:config.deduplicate,considered_frame_hashes:frameHashes,retained_grid_approximation:config.strategy==='runtime_schedule',asr_mode:'retained_transcript_only',...(adaptiveTrace?{adaptive_frame_selection:adaptiveTrace}:{})}};
}
