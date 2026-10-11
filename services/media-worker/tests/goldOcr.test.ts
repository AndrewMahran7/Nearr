import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { validateGoldLocalOcr,prepareGoldOcr } from '../src/evaluation/goldOcr.js';
import { loadGoldInput } from '../src/evaluation/goldInputAdapter.js';
import { executeGoldInput } from '../src/evaluation/goldRuntimeAdapter.js';
import { runGoldInference } from '../src/cli/recognitionGoldInference.js';
import { ProviderBudgetLedger } from '../src/evaluation/providerBudgetLedger.js';
import { emptyEvidence } from '../src/types/evidence.js';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,20,0,10,1,1,0x11,0,0xff,0xd9]);
const input=()=>({schema_version:1,input_id:'i_'+'a'.repeat(24),view:'full',cache_policy:'disabled',evidence:{caption:null,description:null,hashtags:null,tagged_accounts:null,location_tag:null,source_geography:null,transcript:null},media:{frames:['frames/000.jpg'],duration_seconds:2,frame_timestamps_seconds:[0]}});
function receipt(){
  const frame={frame_index:0,relative_path:'frames/000.jpg',timestamp_seconds:0,frame_sha256:hash(jpeg),salience:{score:.5,line_count:1,glyph_count:5,probe_width:10,probe_height:20},text:'Copper Finch',text_angle:null,width:10,height:20,lines:[{text:'Copper Finch',words:[{text:'Copper Finch',box:{x:0,y:0,width:9,height:10},confidence:null}]}],elapsed_ms:7};
  return {schema_version:1,method:'sparse-local-ocr-v1',input_id:input().input_id,view:'full',parent_input_sha256:hash(JSON.stringify(input())),created_at:'2026-01-01T00:00:00Z',engine:{name:'Windows.Media.Ocr',os_build:'synthetic',languages:['en-US'],max_image_dimension:4096,dll_version:'synthetic',dll_sha256:'b'.repeat(64),word_confidence_available:false,network_used:false},language:'en-US',configuration:{max_probes:2,max_frames:1,min_salience:.15,temporal_bins:1,probe_max_dimension:768,min_glyphs_per_line:3,exact_frame_dedup:true},configuration_sha256:'c'.repeat(64),tool_sha256:'d'.repeat(64),helper_sha256:'e'.repeat(64),selection_environment:{python:'synthetic',opencv:'synthetic',pillow:'synthetic',numpy:'synthetic'},compute_hardware:{processor:'synthetic',architecture:'x64',logical_cpu_count:1,engine_device:'synthetic'},available_frames:1,probed_frames:1,ocr_frames:1,probes:[frame],frames:[frame],deduplicated_text:[{text:'Copper Finch',timestamps_seconds:[0],frame_indices:[0]}],selection_elapsed_ms:5,ocr_process_elapsed_ms:10,total_elapsed_ms:20,status:'completed',provenance:'Synthetic pixels only.',limitations:['Synthetic test; not real recognition.']};
}
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'gold-ocr-test-'));await mkdir(path.join(root,'frames'));await mkdir(path.join(root,'source'));await writeFile(path.join(root,'frames/000.jpg'),jpeg);
  return {root,async save(sidecar:any=receipt(),view='full'){
    const bytes=Buffer.from(JSON.stringify(sidecar)),ref={path:'source/ocr.local.json' as const,sha256:hash(bytes),parent_input_sha256:sidecar.parent_input_sha256};
    await writeFile(path.join(root,ref.path),bytes);const source=input();source.view=view;(source.media as any).local_ocr=ref;await writeFile(path.join(root,'input.json'),JSON.stringify(source));return {file:path.join(root,'input.json'),ref};
  },async cleanup(){const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('gold-ocr-test-'));await rm(target,{recursive:true,force:true});}};
}

test('OCR receipt accepts neutral generation provenance and rejects labels, invented confidence and malformed words',()=>{
  assert.equal(validateGoldLocalOcr(receipt()).ocr_frames,1);
  for(const edit of [(r:any)=>{r.labels={name:'secret'};},(r:any)=>{r.frames[0].lines[0].words[0].confidence=.99;},(r:any)=>{r.frames[0].lines[0].words[0].box.width=100;},(r:any)=>{delete r.compute_hardware;},(r:any)=>{r.engine.network_used=true;},(r:any)=>{r.frames[0].text='Hidden caption';}]){const r=receipt();edit(r);assert.throws(()=>validateGoldLocalOcr(r));}
});

test('sidecar binding checks parent/view and original frame bytes, not only input identifier',async()=>{
  const f=await fixture();try{
    const {file,ref}=await f.save(),loaded=await loadGoldInput(file);
    const result=await prepareGoldOcr(loaded,{mode:'local-retained',localOcr:ref});
    assert.deepEqual(result.segments,[{timestampSeconds:0,text:'Copper Finch',confidence:null}]);assert.equal(result.extracted,true);assert.equal(result.trace.original_ocr_elapsed_ms,20);
    await f.save(receipt(),'visual_pixel_text_masked');await assert.rejects(loadGoldInput(file),/local_ocr_parent_mismatch/);
    await f.save();await writeFile(path.join(f.root,'frames/000.jpg'),Buffer.concat([jpeg,Buffer.from('changed')]));await assert.rejects(loadGoldInput(file),/local_ocr_frame_hash_mismatch/);
  }finally{await f.cleanup();}
});

test('retained OCR mode remains delegated to the multimodal model; skipped sparse selection is not a completed extraction',async()=>{
  const f=await fixture();try{
    const {file}=await f.save(),loaded=await loadGoldInput(file);
    const retained=await prepareGoldOcr(loaded,{mode:'retained'});assert.equal(retained.extracted,false);assert.deepEqual(retained.segments,[]);
    const skipped:any=receipt();skipped.frames=[];skipped.ocr_frames=0;skipped.status='skipped_no_salient_text_candidates';skipped.deduplicated_text=[];
    for(const key of ['text','text_angle','width','height','lines','elapsed_ms'])delete skipped.probes[0][key];
    const next=await f.save(skipped),nextLoaded=await loadGoldInput(next.file),actual=await prepareGoldOcr(nextLoaded,{mode:'local-retained',localOcr:next.ref});
    assert.equal(actual.extracted,false);assert.deepEqual(actual.segments,[]);
  }finally{await f.cleanup();}
});

test('local OCR enters runtime as untrusted timestamped visible text without a confidence substitute or paid call',async()=>{
  const f=await fixture();try{
    const {file,ref}=await f.save(),loaded=await loadGoldInput(file);
    const cfg=JSON.parse(await readFile('../../scripts/gold-dataset/configs/local-ocr-pilot-2026-10-10.json','utf8'));
    const validation=await runGoldInference({inputs:[file],configuration:cfg,outDir:'unused',execute:false});assert.equal(validation.provider_calls,0);
    const ledger=new ProviderBudgetLedger(cfg.budget,async()=>{throw new Error('network_forbidden');},async()=>{});let called=0;
    const output=await executeGoldInput({loaded,config:{} as any,frames:cfg.frames,context:cfg.decisionContext,ocr:{mode:'local-retained',localOcr:ref},ledger,signal:new AbortController().signal,hashImage:async()=>'0'.repeat(16),model:{name:'stub',async analyze(actual){called++;assert.equal(actual.ocrExtracted,true);assert.equal(actual.ocr[0]?.confidence,null);assert.equal(actual.ocr[0]?.text,'Copper Finch');return {provider:'stub',promptVersion:'test',evidence:emptyEvidence()};}},resolve:async()=>{throw new Error('must_not_resolve');}});
    assert.equal(called,1);assert.equal(output.provider_calls,0);assert.equal(output.inference_evidence.ocr_evidence.trace.original_ocr_elapsed_ms,20);assert.equal(output.status,'review');assert.equal(output.inference_boundary,'retained_timed_evidence_live_runtime_with_local_ocr');
    const baseline=await executeGoldInput({loaded,config:{} as any,frames:cfg.frames,context:cfg.decisionContext,ledger,signal:new AbortController().signal,hashImage:async()=>'0'.repeat(16),model:{name:'stub',async analyze(actual){assert.deepEqual(actual.ocr,[]);assert.equal(actual.ocrExtracted,false);return {provider:'stub',promptVersion:'test',evidence:emptyEvidence()};}}});
    assert.equal(baseline.inference_evidence.ocr_evidence,undefined);assert.equal(baseline.inference_boundary,'retained_timed_evidence_live_runtime');
  }finally{await f.cleanup();}
});
