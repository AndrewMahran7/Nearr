import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat,realpath,readFile } from 'node:fs/promises';
import type { LoadedGoldInput } from './goldInputAdapter.js';
import type { OcrSegment } from '../types/media.js';
import { deduplicateOcrSegments } from '../providers/ocr.js';

export type GoldOcrMode='retained'|'local-retained';
export type GoldLocalOcrReference={path:'source/ocr.local.json';sha256:string;parent_input_sha256:string};
export type GoldOcrOptions={mode:GoldOcrMode;localOcr?:GoldLocalOcrReference};
export class GoldOcrError extends Error {constructor(readonly code:string){super(code);this.name='GoldOcrError';}}
const fail=(code:string):never=>{throw new GoldOcrError(code);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const isHash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const integer=(x:unknown):x is number=>finite(x)&&Number.isInteger(x);
const str=(x:unknown,max=1000):x is string=>typeof x==='string'&&x.length<=max;
const normalized=(x:string)=>x.replace(/\s+/g,' ').trim();
function object(raw:unknown,required:string[],optional:string[]=[]):Record<string,any>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_local_ocr_object');
  const value=raw as Record<string,any>;
  if(required.some((key)=>!(key in value))||Object.keys(value).some((key)=>!required.includes(key)&&!optional.includes(key)))fail('non_neutral_local_ocr_field');
  return value;
}
const probeKeys=['frame_index','relative_path','timestamp_seconds','frame_sha256','salience'];
const recognitionKeys=['text','text_angle','width','height','lines','elapsed_ms'];

/** Parse the generator's neutral, immutable evaluation receipt. Only verified
 * frame lines later enter model context; receipt descriptions never do.
 */
export function validateGoldLocalOcr(raw:unknown){
  const v=object(raw,['schema_version','method','input_id','view','parent_input_sha256','created_at','engine','language','configuration','configuration_sha256','tool_sha256','helper_sha256','selection_environment','compute_hardware','available_frames','probed_frames','ocr_frames','probes','frames','deduplicated_text','selection_elapsed_ms','ocr_process_elapsed_ms','total_elapsed_ms','status','provenance','limitations']);
  if(v.schema_version!==1||v.method!=='sparse-local-ocr-v1'||!/^i_[a-f0-9]{24}$/.test(v.input_id)||!['full','description_hidden','location_hidden','visual_only','visual_audio','visual_pixel_text_masked'].includes(v.view)||!isHash(v.parent_input_sha256)||!str(v.created_at)||!Number.isFinite(Date.parse(v.created_at)))fail('invalid_local_ocr_header');
  for(const field of ['configuration_sha256','tool_sha256','helper_sha256'])if(!isHash(v[field]))fail('invalid_local_ocr_tool_provenance');
  const engine=object(v.engine,['name','os_build','languages','max_image_dimension','dll_version','dll_sha256','word_confidence_available','network_used']);
  if(engine.name!=='Windows.Media.Ocr'||!str(engine.os_build)||!Array.isArray(engine.languages)||!engine.languages.every((x:unknown)=>str(x,100))||!integer(engine.max_image_dimension)||engine.max_image_dimension<1||!str(engine.dll_version)||!isHash(engine.dll_sha256)||engine.word_confidence_available!==false||engine.network_used!==false||!str(v.language,100)||!engine.languages.includes(v.language))fail('invalid_local_ocr_engine');
  const cfg=object(v.configuration,['max_probes','max_frames','min_salience','temporal_bins','probe_max_dimension','min_glyphs_per_line','exact_frame_dedup']);
  if(!integer(cfg.max_probes)||cfg.max_probes<2||cfg.max_probes>128||!integer(cfg.max_frames)||cfg.max_frames<1||cfg.max_frames>32||cfg.max_frames>cfg.max_probes||!integer(cfg.temporal_bins)||cfg.temporal_bins<1||cfg.temporal_bins>cfg.max_frames||!finite(cfg.min_salience)||cfg.min_salience<=0||cfg.min_salience>1||!integer(cfg.probe_max_dimension)||cfg.probe_max_dimension<1||!integer(cfg.min_glyphs_per_line)||cfg.min_glyphs_per_line<1||typeof cfg.exact_frame_dedup!=='boolean')fail('invalid_local_ocr_configuration');
  const environment=object(v.selection_environment,['python','opencv','pillow','numpy']);
  if(!Object.values(environment).every((x)=>str(x)))fail('invalid_local_ocr_environment');
  const hardware=object(v.compute_hardware,['processor','architecture','logical_cpu_count','engine_device']);
  if(!str(hardware.processor)||!str(hardware.architecture)||!str(hardware.engine_device)||!(hardware.logical_cpu_count===null||(integer(hardware.logical_cpu_count)&&hardware.logical_cpu_count>0)))fail('invalid_local_ocr_hardware');
  if(!integer(v.available_frames)||v.available_frames<1||!integer(v.probed_frames)||!integer(v.ocr_frames)||!Array.isArray(v.probes)||!Array.isArray(v.frames)||v.probes.length!==v.probed_frames||v.frames.length!==v.ocr_frames||v.probed_frames>cfg.max_probes||v.probed_frames>v.available_frames||v.ocr_frames>cfg.max_frames||v.ocr_frames>v.probed_frames)fail('invalid_local_ocr_counts');
  const validateFrame=(rawFrame:unknown,recognized:boolean)=>{
    const p=object(rawFrame,recognized?[...probeKeys,...recognitionKeys]:probeKeys,recognized?[]:recognitionKeys);
    if(!integer(p.frame_index)||p.frame_index>=v.available_frames||!/^frames\/\d{3,}\.jpg$/.test(p.relative_path)||!finite(p.timestamp_seconds)||!isHash(p.frame_sha256))fail('invalid_local_ocr_frame');
    const salience=object(p.salience,['score','line_count','glyph_count','probe_width','probe_height']);
    if(!finite(salience.score)||salience.score>1||!['line_count','glyph_count','probe_width','probe_height'].every((key)=>integer(salience[key])))fail('invalid_local_ocr_salience');
    if(recognized||recognitionKeys.some((key)=>key in p)){
      if(recognitionKeys.some((key)=>!(key in p))||!str(p.text,500_000)||!(p.text_angle===null||(typeof p.text_angle==='number'&&Number.isFinite(p.text_angle)))||!integer(p.width)||!integer(p.height)||p.width<1||p.height<1||p.width>engine.max_image_dimension||p.height>engine.max_image_dimension||!Array.isArray(p.lines)||p.lines.length>10_000||!finite(p.elapsed_ms))fail('invalid_local_ocr_recognition');
      for(const rawLine of p.lines){
        const line=object(rawLine,['text','words']);if(!str(line.text,50_000)||!Array.isArray(line.words)||line.words.length>10_000)fail('invalid_local_ocr_line');
        for(const rawWord of line.words){const word=object(rawWord,['text','box','confidence']);const box=object(word.box,['x','y','width','height']);if(!str(word.text,10_000)||word.confidence!==null||!Object.values(box).every(finite)||box.x+box.width>p.width+1||box.y+box.height>p.height+1)fail('invalid_local_ocr_word');}
      }
      if(normalized(p.text)!==normalized(p.lines.map((line:any)=>line.text).join(' ')))fail('inconsistent_local_ocr_text');
    }
    return p;
  };
  const probes=v.probes.map((p:unknown)=>validateFrame(p,false)),frames=v.frames.map((p:unknown)=>validateFrame(p,true));
  if(new Set(probes.map((p:any)=>p.frame_index)).size!==probes.length||new Set(frames.map((p:any)=>p.frame_index)).size!==frames.length)fail('duplicate_local_ocr_frame');
  for(const f of frames){const probe=probes.find((p:any)=>p.frame_index===f.frame_index);if(!probe||probe.relative_path!==f.relative_path||probe.frame_sha256!==f.frame_sha256||probe.timestamp_seconds!==f.timestamp_seconds)fail('ocr_frame_not_probed');}
  if(!Array.isArray(v.deduplicated_text)||v.deduplicated_text.length>20_000)fail('invalid_local_ocr_deduplication');
  for(const rawItem of v.deduplicated_text){const item=object(rawItem,['text','timestamps_seconds','frame_indices']);if(!str(item.text,50_000)||!Array.isArray(item.timestamps_seconds)||!item.timestamps_seconds.every(finite)||!Array.isArray(item.frame_indices)||item.frame_indices.length!==item.timestamps_seconds.length||!item.frame_indices.every(integer))fail('invalid_local_ocr_deduplication');}
  if(!['selection_elapsed_ms','ocr_process_elapsed_ms','total_elapsed_ms'].every((key)=>finite(v[key]))||v.total_elapsed_ms<v.selection_elapsed_ms||v.total_elapsed_ms<v.ocr_process_elapsed_ms||v.status!==(frames.length?'completed':'skipped_no_salient_text_candidates')||!str(v.provenance,10_000)||!Array.isArray(v.limitations)||!v.limitations.every((x:unknown)=>str(x,10_000)))fail('invalid_local_ocr_receipt');
  return structuredClone(v);
}

export async function loadGoldOcrReceipt(loaded:LoadedGoldInput,ref:GoldLocalOcrReference){
  if(ref.path!=='source/ocr.local.json'||!isHash(ref.sha256)||!isHash(ref.parent_input_sha256)||loaded.input.view==='text_only')fail('invalid_local_ocr_reference');
  const root=await realpath(loaded.directory);
  let target=root;
  for(const part of ref.path.split('/')){target=path.join(target,part);if((await lstat(target)).isSymbolicLink())fail('ocr_symlink_forbidden');}
  const actual=await realpath(target),relative=path.relative(root,actual),st=await lstat(actual);
  if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||!st.isFile()||st.size>16*1024*1024)fail('invalid_local_ocr_file');
  const bytes=await readFile(actual);if(hash(bytes)!==ref.sha256)fail('local_ocr_hash_mismatch');
  const receipt=validateGoldLocalOcr(JSON.parse(bytes.toString('utf8')));
  if(receipt.input_id!==loaded.input.input_id||receipt.view!==loaded.input.view||receipt.parent_input_sha256!==ref.parent_input_sha256||receipt.available_frames!==loaded.input.media.frames.length)fail('local_ocr_parent_mismatch');
  for(const probe of receipt.probes){
    const i=probe.frame_index;
    if(probe.relative_path!==loaded.input.media.frames[i]||probe.timestamp_seconds!==loaded.input.media.frame_timestamps_seconds[i]||hash(await readFile(loaded.framePaths[i]!))!==probe.frame_sha256)fail('local_ocr_frame_hash_mismatch');
  }
  return receipt;
}

export async function prepareGoldOcr(loaded:LoadedGoldInput,options:GoldOcrOptions){
  const started=performance.now();
  if(options.mode==='retained')return {segments:[] as OcrSegment[],extracted:false,trace:{mode:'retained',original_ocr_elapsed_ms:null,stage_elapsed_ms:performance.now()-started}};
  if(options.mode!=='local-retained'||!options.localOcr)fail('local_ocr_reference_required');
  const receipt=await loadGoldOcrReceipt(loaded,options.localOcr!);
  const segments:OcrSegment[]=deduplicateOcrSegments(receipt.frames.flatMap((f:any)=>f.lines.map((line:any)=>({timestampSeconds:f.timestamp_seconds,text:normalized(line.text),confidence:null}))));
  return {segments,extracted:receipt.ocr_frames>0,trace:{mode:options.mode,sidecar_sha256:options.localOcr!.sha256,parent_input_sha256:receipt.parent_input_sha256,original_ocr_elapsed_ms:receipt.total_elapsed_ms,original_selection_elapsed_ms:receipt.selection_elapsed_ms,original_recognition_elapsed_ms:receipt.ocr_process_elapsed_ms,stage_elapsed_ms:performance.now()-started,engine:receipt.engine,compute_hardware:receipt.compute_hardware,configuration:receipt.configuration,configuration_sha256:receipt.configuration_sha256,tool_sha256:receipt.tool_sha256,helper_sha256:receipt.helper_sha256,selection_environment:receipt.selection_environment,available_frames:receipt.available_frames,probed_frames:receipt.probed_frames,ocr_frames:receipt.ocr_frames,selected_timestamps_seconds:receipt.frames.map((f:any)=>f.timestamp_seconds),selected_frames:receipt.frames.map((f:any)=>({frame_index:f.frame_index,timestamp_seconds:f.timestamp_seconds,frame_sha256:f.frame_sha256,salience:f.salience})),provider_cost_usd:0,local_compute_cost_usd:null,coverage:'Sparse local OCR over hash-matched neutral pixels; this does not establish absence of text in uninspected frames.',limitations:receipt.limitations}};
}
