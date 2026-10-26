// Disabled candidate route. Account/consent eligibility remains the worker's
// database gate; these configuration checks cannot grant account permission.
import { readFile, stat } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { MediaError } from '../types/media.js';
import { emptyEvidence, parseEvidenceWithDiagnostics } from '../types/evidence.js';
import { PLACE_EVIDENCE_SYSTEM_PROMPT, PROMPT_VERSION, buildUserContext } from '../prompts/placeEvidencePrompt.js';
import { AI_SAVE_NOTE_SYSTEM_PROMPT, AI_NOTE_PROMPT_VERSION, buildAiNoteUserContext } from '../prompts/aiNotePrompt.js';
import { extractResponsesText } from '../solParity/parser.js';
import { parseRetryAfterSeconds } from '../util/backoff.js';
import { groundClaimedEvidence, parseTargetedAiNoteResponse, type AnalyzeInput, type AnalyzeOutput, type ModelProvider } from './model.js';

export const OPENAI_RECOGNITION_LIMITS = Object.freeze({
  frames:12,frameBytes:1_048_576,totalFrameBytes:6_291_456,contextCharacters:24_000,responseBytes:262_144,
  timeoutMs:90_000,outputTokens:8_000,
});
type Settings = NonNullable<WorkerConfig['openaiRecognition']>;
function boundedSegments<T extends { text:string }>(values:T[],count:number,budget:number):T[] {
  let remaining=budget;
  return values.slice(0,count).map(value=>{
    const text=value.text.slice(0,Math.min(400,remaining)); remaining-=text.length;
    return {...value,text};
  }).filter(value=>value.text.length>0);
}
function boundedInput(input:AnalyzeInput):AnalyzeInput {
  const clip=(value:string|null|undefined,max=1000)=>value?.slice(0,max);
  return {...input,
    transcript:boundedSegments(input.transcript,input.targetPlace?40:120,input.targetPlace?2_500:10_000),ocr:boundedSegments(input.ocr,input.targetPlace?30:80,input.targetPlace?1_200:5_000),
    metadataTitle:clip(input.metadataTitle,input.targetPlace?500:1000),metadataDescription:clip(input.metadataDescription),
    metadataLocation:clip(input.metadataLocation,300),metadataCreatorName:clip(input.metadataCreatorName,200),metadataCreatorHandle:clip(input.metadataCreatorHandle,200),
    retainedEvidence:input.targetPlace ? input.retainedEvidence?.slice(0,8).map(value=>({...value,value:value.value.slice(0,240)})) : [],
    targetPlace:input.targetPlace ? {...input.targetPlace,name:input.targetPlace.name.slice(0,200),formattedAddress:clip(input.targetPlace.formattedAddress,300)} : input.targetPlace,
  };
}
function context(input:AnalyzeInput):string {
  const common={platform:input.platform.slice(0,40),
    transcriptText:input.transcript.map(s=>`[${s.startSeconds.toFixed(1)}] ${s.text}`).join('\n'),
    ocrText:input.ocr.map(s=>`[${s.timestampSeconds.toFixed(1)}] ${s.text}`).join('\n'),
    ocrExtracted:input.ocrExtracted===true,metadataTitle:input.metadataTitle,metadataDescription:input.metadataDescription,retainedEvidence:input.retainedEvidence};
  return input.targetPlace
    ? buildAiNoteUserContext({...common,targetPlace:input.targetPlace,attempt:input.aiNoteAttempt??'initial'})
    : buildUserContext({...common,metadataLocation:input.metadataLocation,metadataCreatorHandle:input.metadataCreatorHandle,metadataCreatorName:input.metadataCreatorName});
}
function counter(value:unknown):number|null {
  return typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : null;
}
function record(value:unknown):Record<string,unknown> {
  return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
export function openAiModelCost(usage:AnalyzeOutput['usage'],cached:number,cfg:Settings):number|null {
  const rates=[cfg.inputPricePerMillion,cfg.cachedInputPricePerMillion,cfg.outputPricePerMillion];
  if(!usage || !cfg.pricingReference || rates.some(rate=>rate===null || !Number.isFinite(rate) || rate<0)) return null;
  const cachedTokens=Math.min(Math.max(cached,0),usage.inputTokens);
  return Number(((usage.inputTokens-cachedTokens)*cfg.inputPricePerMillion! / 1e6
    + cachedTokens*cfg.cachedInputPricePerMillion! / 1e6 + usage.outputTokens*cfg.outputPricePerMillion! / 1e6).toFixed(8));
}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown> {
  const limit=OPENAI_RECOGNITION_LIMITS.responseBytes;
  if(Number(response.headers.get('content-length'))>limit) {
    await response.body?.cancel(); throw new MediaError('provider_unavailable','openai_response_too_large');
  }
  const reader=response.body?.getReader();
  if(!reader) throw new MediaError('provider_unavailable','openai_empty_response');
  const chunks:Uint8Array[]=[]; let bytes=0;
  const abort=()=>{ void reader.cancel().catch(()=>{}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    while(true) {
      if(signal.aborted) throw new MediaError('provider_unavailable','openai_timeout');
      const chunk=await reader.read(); if(chunk.done) break;
      bytes+=chunk.value.byteLength;
      if(bytes>limit) { await reader.cancel(); throw new MediaError('provider_unavailable','openai_response_too_large'); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { signal.removeEventListener('abort',abort); reader.releaseLock(); }
}

export class OpenAiRecognitionModel implements ModelProvider {
  readonly name='openai';
  constructor(private readonly cfg:WorkerConfig,private readonly transport:typeof fetch=fetch) {}
  async analyze(original:AnalyzeInput):Promise<AnalyzeOutput> {
    const cfg=this.cfg.openaiRecognition;
    // Offline transport injection does not bypass any configuration gate.
    if(this.cfg.analysisProvider!=='openai' || cfg?.enabled!==true || cfg.allowedRoute!=='openai_only')
      throw new MediaError('provider_unavailable','openai_route_not_qualified');
    if(!cfg.apiKey || !cfg.model || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(cfg.model))
      throw new MediaError('provider_unavailable','openai_configuration_missing');
    if(original.signal.aborted) throw new MediaError('provider_unavailable','openai_aborted');
    const signal=(AbortSignal as typeof AbortSignal & { any(signals:AbortSignal[]):AbortSignal }).any([
      original.signal,
      AbortSignal.timeout(Math.min(OPENAI_RECOGNITION_LIMITS.timeoutMs,Math.max(1,cfg.timeoutMs||60_000))),
    ]);
    const input=boundedInput(original);
    const textContext=context(input);
    if(textContext.length>OPENAI_RECOGNITION_LIMITS.contextCharacters) throw new MediaError('provider_unavailable','openai_context_too_large');
    const content:unknown[]=[{type:'input_text',text:textContext}];
    const sentFrames:AnalyzeInput['frames']=[]; let frameBytes=0;
    for(const frame of input.frames.slice(0,Math.min(this.cfg.maxSelectedFrames,OPENAI_RECOGNITION_LIMITS.frames))) {
      if(signal.aborted) throw new MediaError('provider_unavailable','openai_timeout');
      const size=(await stat(frame.path)).size;
      if(size>OPENAI_RECOGNITION_LIMITS.frameBytes || frameBytes+size>OPENAI_RECOGNITION_LIMITS.totalFrameBytes)
        throw new MediaError('provider_unavailable','openai_frame_budget_exceeded');
      const bytes=await readFile(frame.path,{signal});
      if(bytes.byteLength>OPENAI_RECOGNITION_LIMITS.frameBytes || frameBytes+bytes.byteLength>OPENAI_RECOGNITION_LIMITS.totalFrameBytes)
        throw new MediaError('provider_unavailable','openai_frame_budget_exceeded');
      frameBytes+=bytes.byteLength;
      const mime=frame.path.toLowerCase().endsWith('.png')?'image/png':frame.path.toLowerCase().endsWith('.webp')?'image/webp':'image/jpeg';
      content.push({type:'input_text',text:`frame_timestamp_seconds: ${frame.timestampSeconds.toFixed(3)}`},
        {type:'input_image',image_url:`data:${mime};base64,${bytes.toString('base64')}`,detail:'high'});
      sentFrames.push(frame);
    }
    input.frames=sentFrames;
    const started=Date.now();
    try {
      const response=await this.transport('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${cfg.apiKey}`},signal,
        body:JSON.stringify({model:cfg.model,store:false,
          instructions:input.targetPlace ? AI_SAVE_NOTE_SYSTEM_PROMPT : PLACE_EVIDENCE_SYSTEM_PROMPT+'\nReturn one JSON object matching the supplied place-evidence contract.',
          input:[{role:'user',content}],max_output_tokens:Math.min(OPENAI_RECOGNITION_LIMITS.outputTokens,Math.max(256,cfg.maxOutputTokens||4000)),
          ...(input.targetPlace ? {} : {text:{format:{type:'json_object'}}}),
        }),
      });
      if(!response.ok) {
        await response.body?.cancel();
        throw new MediaError(response.status===429?'provider_rate_limited':'provider_unavailable',`openai_http_${response.status}`,parseRetryAfterSeconds(response.headers.get('retry-after')));
      }
      const body=record(await boundedJson(response,signal));
      if(signal.aborted) throw new MediaError('provider_unavailable','openai_timeout');
      if(body.status!=='completed' || body.error || body.incomplete_details)
        throw new MediaError('provider_unavailable','openai_incomplete_response');
      const text=extractResponsesText(body);
      let parsed:ReturnType<typeof parseEvidenceWithDiagnostics>;
      if(input.targetPlace) parsed=parseTargetedAiNoteResponse(text,input as AnalyzeInput & {targetPlace:NonNullable<AnalyzeInput['targetPlace']>});
      else {
        try { parsed=parseEvidenceWithDiagnostics(JSON.parse(text)); }
        catch { parsed=parseEvidenceWithDiagnostics(null); }
      }
      const rawUsage=record(body.usage), inputCount=counter(rawUsage.input_tokens),outputCount=counter(rawUsage.output_tokens),total=counter(rawUsage.total_tokens);
      const cached=counter(record(rawUsage.input_tokens_details).cached_tokens)??0;
      const usage:AnalyzeOutput['usage']=inputCount===null || outputCount===null || total===null ? undefined : {
        inputTokens:inputCount,outputTokens:outputCount,totalTokens:total,thinkingTokens:counter(record(rawUsage.output_tokens_details).reasoning_tokens)??0,
      };
      const evidence=groundClaimedEvidence(parsed.evidence,input);
      // Recognition never writes notes for unsaved hypotheses, regardless of model output.
      if(!input.targetPlace) for(const place of evidence.places) { place.memoryCue=null; place.memoryCueEvidence=[]; }
      return {provider:this.name,modelName:cfg.model,promptVersion:input.targetPlace?AI_NOTE_PROMPT_VERSION:PROMPT_VERSION,
        evidence:parsed.diagnostics.topLevelInvalid?emptyEvidence(['openai_schema_invalid']):evidence,parseDiagnostics:parsed.diagnostics,
        recognitionFailureClass:parsed.diagnostics.topLevelInvalid?'model_schema_invalid':parsed.diagnostics.rejected>0?'candidate_field_invalid':undefined,
        usage,latencyMs:Date.now()-started,providerCost:{estimatedUsd:openAiModelCost(usage,cached,cfg),cachedInputTokens:cached,pricingReference:cfg.pricingReference||null},
        modelInput:{model:cfg.model,frameCount:sentFrames.length,timestampsSeconds:sentFrames.map(frame=>frame.timestampSeconds),
          textContextCategories:['platform',...(input.metadataTitle||input.metadataDescription?['caption']:[]),...(input.transcript.length?['transcript']:[]),...(input.ocr.length?['visible_text']:[]),...(input.targetPlace?['saved_place_target']:[])]},
      };
    } catch(error) {
      if(error instanceof MediaError) throw error;
      throw new MediaError('provider_unavailable',signal.aborted?'openai_timeout':'openai_transport_failure');
    }
  }
}
