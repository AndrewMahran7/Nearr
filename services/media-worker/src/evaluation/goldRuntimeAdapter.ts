import type { WorkerConfig } from '../config/env.js';
import type { ModelProvider, AnalyzeOutput } from '../providers/model.js';
import { groundClaimedEvidence } from '../providers/model.js';
import { evaluateNormalResultSpecificity } from '../automaticDeep/normalResultSpecificity.js';
import { hammingDistanceHex } from '../util/hash.js';
import { classifyRecognitionFinalResult } from '../pipeline/recognitionOutcome.js';
import { parseMediaEvidence, buildVayrinPartialResult } from '../../../../supabase/functions/process-share-jobs/mediaEvidence.ts';
import { planPreResolve } from '../../../../supabase/functions/process-share-jobs/mediaFinalizePlan.ts';
import { prepareMediaResolverInput, planMediaFinalization, type MediaFinalizationResult } from '../../../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { resolveSharedPlace } from '../../../../supabase/functions/process-share-link/resolver/resolveSharedPlace.ts';
import { isRetryableNameDrivenProviderFailure } from '../../../../supabase/functions/process-share-link/resolver/nameDrivenResolver.ts';
import { prepareGoldInput, type LoadedGoldInput, type GoldFrameConfig } from './goldInputAdapter.js';
import type { ProviderBudgetLedger } from './providerBudgetLedger.js';
import { prepareGoldAudio, type GoldAudioOptions } from './goldAudio.js';
import { prepareGoldOcr, type GoldOcrOptions } from './goldOcr.js';
import { parseAdaptiveRecognitionConfig,type AdaptiveRecognitionConfig } from '../../../../lib/adaptiveRecognitionConfig.ts';
import { applyLiteralSourceStreetEvidence,appendLiteralStreetToQuery,type LiteralSourceText } from '../../../../lib/adaptiveSourceStreet.ts';

export type GoldDecisionContext = { autoSaveAuthorized:boolean; auditRecordPresent:boolean };
export type GoldObservedPlace = {name:string;place_id:string|null;address:string|null;country:string|null;region:string|null;city:string|null;coordinates:{lat:number;lng:number}|null;logical_result_id?:string};
const value = (x:unknown):string|null => typeof x==='string'&&x.trim()?x.trim():null;

/** Private inference provenance only; never image payloads, credentials or labels. */
function privateObservation(value:unknown):any {
  return JSON.parse(JSON.stringify(value, (key,item)=>
    /^(?:api.?key|authorization|access.?token|service.?role.?key)$/i.test(key)?'[redacted]':
      typeof item==='string'&&/^data:.*;base64,/i.test(item)?'[inline media omitted]':item));
}
function evidenceFeatures(evidence:any,resolver:any,plan:any){
  const places=evidence?.places??[],partials=evidence?.partialPlaces??[];
  const roles:Record<string,number>={},sources:Record<string,number>={};
  for(const place of [...places,...partials]){roles[place.role??'unknown']=(roles[place.role??'unknown']??0)+1;for(const item of place.explicitEvidence??[])sources[item.source]=(sources[item.source]??0)+1;}
  const scores=(resolver?.candidates??[]).map((c:any)=>c.confidenceScore??c.matchScore).filter((x:unknown)=>typeof x==='number'&&Number.isFinite(x)).sort((a:number,b:number)=>b-a);
  const geo=[...(plan?.perPlaceDecisions??[]).map((d:any)=>d.geography),plan?.detail?.legacyGeography,plan?.detail?.geography].filter(Boolean);
  return {canonical_entity_count:places.length,partial_entity_count:partials.length,role_counts:roles,explicit_evidence_source_counts:sources,resolver_candidate_count:resolver?.candidates?.length??0,top_candidate_score:scores[0]??null,top_two_score_gap:scores.length>1?scores[0]-scores[1]:null,geography_decisions:geo,source_geography_conflict:geo.some((g:any)=>g.autoSaveEligible===false)||plan?.reasonCodes?.includes('source_geography_conflict')||false};
}

/** Provider fields only. Never backfill missing geography from labels or model hypotheses. */
export function observedPlace(raw:any,logicalId?:string):GoldObservedPlace|null{
  const candidate=raw?.candidate??raw, name=value(candidate?.name);
  if(!name)return null;
  const id=value(candidate.googlePlaceId)??value(candidate.place_id);
  const lat=candidate.latitude??candidate.coordinates?.lat,lng=candidate.longitude??candidate.coordinates?.lng;
  return {name,place_id:id?(/^[a-z][a-z0-9-]*:/i.test(id)?id:'google:'+id):null,address:value(candidate.formattedAddress)??value(candidate.address),country:value(candidate.country),region:value(candidate.region),city:value(candidate.city),coordinates:typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null,...(logicalId?{logical_result_id:logicalId}:{})};
}

/** Retrieval ranking is distinct from UI review options and never grants autonomy.
 * Export selected identities first, followed by the original provider ranking.
 * Deep's UI ranked list is capped at three, so retain its canonical slot/aggregate
 * candidates too: a fourth depicted destination must not disappear from recall.
 */
export function scoredCandidates(plan:MediaFinalizationResult,ordinaryResult?:any,automaticDeepRuntime?:any):GoldObservedPlace[]{
  const ranked:GoldObservedPlace[]=[];
  const sameIdentity=(a:GoldObservedPlace,b:GoldObservedPlace)=>
    a.place_id&&b.place_id?a.place_id===b.place_id:
      a.name===b.name&&JSON.stringify(a.coordinates)===JSON.stringify(b.coordinates);
  const add=(candidate:GoldObservedPlace|null)=>{
    if(!candidate)return;
    const existing=ranked.find((item)=>sameIdentity(item,candidate));
    if(!existing){ranked.push(candidate);return;}
    // A saved safeCandidate can omit locality that the original provider retains.
    for(const field of ['place_id','address','country','region','city','coordinates'] as const)
      if(existing[field]===null&&candidate[field]!==null)(existing as any)[field]=candidate[field];
  };
  for(const selected of plan.autonomousPlaces)add(observedPlace(selected.candidate,selected.logicalResultId));
  if(plan.lane==='automatic_deep'){
    const runtime=plan.detail?.runtimePlan;
    const canonicalById=new Map<string,any>((runtime?.candidatePayload?.candidates??[]).map((c:any)=>[c.googlePlaceId,c]));
    const deepRanking=Array.isArray(automaticDeepRuntime?.destinations)
      ? automaticDeepRuntime.destinations.slice(0,10).flatMap((d:any)=>(d.hypotheses??[]).slice(0,3).map((h:any)=>({
        name:h.name,canonicalPlaceId:h.canonical?.googlePlaceId,canonical:h.canonical,
        country:h.country,region:h.region,locality:h.city,
      })))
      : runtime?.rankedCandidates??[];
    for(const candidate of deepRanking){
      // These are reported hypotheses, not provider-parent identities. In
      // particular, rankedCandidates coordinates can fall back to a parent;
      // only the actual canonical record may supply an exact coordinate.
      const canonical=candidate.canonical??canonicalById.get(candidate.canonicalPlaceId);
      add(observedPlace({name:candidate.name,googlePlaceId:candidate.canonicalPlaceId,
        latitude:canonical?.latitude,longitude:canonical?.longitude,formattedAddress:canonical?.formattedAddress,
        country:candidate.country,region:candidate.region,city:candidate.locality}));
    }
    for(const candidate of runtime?.candidatePayload?.candidates??[])add(observedPlace(candidate));
    for(const slot of runtime?.candidatePayload?.mentionSlots??[])
      for(const candidate of slot.candidates??[])add(observedPlace(candidate,slot.mentionId));
  }else{
    for(const candidate of ordinaryResult?.candidates??[])add(observedPlace(candidate));
    add(observedPlace(ordinaryResult?.primaryCandidate));
    for(const mention of ordinaryResult?.diagnostics?.mentionResults??[])
      for(const candidate of mention.candidates??[])add(observedPlace(candidate,mention.mentionId));
  }
  for(const candidate of plan.reviewCandidates)add(observedPlace(candidate));
  return ranked;
}

export const OBSERVED_SCORING_POOL_BOUNDARY='Provider identities recorded in name-driven mention scoring after context filtering; production keeps at most eight explanations per mention and also caps consolidated identity variants at eight. This is an unordered observed subset, not all raw provider hits or the retained candidate ranking. Missing coordinates/address remain null. No model-only or Automatic Deep hypotheses are included.';
export function observedScoringPool(ordinaryResult:any){
  const providerById=new Map<string,any>();
  const mentions=ordinaryResult?.diagnostics?.mentionResults??[];
  for(const candidate of [...(ordinaryResult?.candidates??[]),...mentions.flatMap((m:any)=>m.candidates??[])])
    if(value(candidate?.googlePlaceId))providerById.set(candidate.googlePlaceId,candidate);
  const pool=new Map<string,GoldObservedPlace&{scoring_observations:any[]}>();
  for(const mention of mentions)for(const score of mention.scoring??[]){
    const id=value(score?.googlePlaceId),name=value(score?.name);
    if(!id||!name||/^[a-z][a-z0-9-]*:/i.test(id)||typeof score.rawScore!=='number'||!Number.isFinite(score.rawScore)||typeof score.normalizedScore!=='number'||!Number.isFinite(score.normalizedScore)||typeof score.rejected!=='boolean')continue;
    const place=observedPlace({...providerById.get(id),googlePlaceId:id,name});
    if(!place)continue;
    const record=pool.get(id)??{...place,scoring_observations:[]};
    record.scoring_observations.push({mention_id:value(mention.mentionId),raw_score:score.rawScore,normalized_score:score.normalizedScore,rejected:score.rejected,rejection_reason:value(score.rejectionReason),reasons:Array.isArray(score.reasons)?score.reasons.filter((x:unknown)=>typeof x==='string'):[]});
    pool.set(id,record);
  }
  return [...pool.values()];
}

export async function executeGoldInput(args:{
  loaded:LoadedGoldInput;config:WorkerConfig;frames:GoldFrameConfig;context:GoldDecisionContext;
  model:ModelProvider;ledger:ProviderBudgetLedger;signal:AbortSignal;
  audio?:GoldAudioOptions;
  ocr?:GoldOcrOptions;
  adaptive?:AdaptiveRecognitionConfig;
  adaptiveTaxonomyTrace?:()=>unknown;
  /** Test seam. Production uses the same resolver as the Edge callback. */
  resolve?:typeof resolveSharedPlace;
  normalAnalysis?:()=>AnalyzeOutput|null;
  hashImage?:Parameters<typeof prepareGoldInput>[3];
}){
  const started=performance.now(),sequence=args.ledger.entries.length;
  const audioMode=args.audio?.mode??'retained';
  const boundary=(audioMode==='retained'?'retained_timed_evidence_live_runtime':audioMode==='openai'?'retained_visual_evidence_fresh_asr_live_runtime':'retained_visual_evidence_local_asr_live_runtime')+(args.ocr?.mode==='local-retained'?'_with_local_ocr':'');
  const base={input_id:args.loaded.input.input_id,view:args.loaded.input.view,adapter_version:'gold-live-runtime-v1',inference_boundary:boundary,cache_policy:'disabled',cache_boundary:'No cross-case or stored-result reuse; production request-local Places coalescing is preserved.',input_sha256:args.loaded.inputSha256,observed_scoring_pool:[] as ReturnType<typeof observedScoringPool>,observed_scoring_pool_available:false,observed_scoring_pool_boundary:OBSERVED_SCORING_POOL_BOUNDARY};
  let trace:unknown=null;
  let scoringPool:ReturnType<typeof observedScoringPool>=[];
  let scoringPoolAvailable=false;
  const provenance:Record<string,any>={};
  try{
    const adaptive=parseAdaptiveRecognitionConfig(args.adaptive);
    provenance.adaptive_configuration=adaptive;
    args.ledger.assertHealthy();args.signal.throwIfAborted();
    const prepared=await prepareGoldInput(args.loaded,args.frames,args.signal,args.hashImage);trace=prepared.trace;
    if(audioMode!=='retained'){
      const audio=await prepareGoldAudio({loaded:args.loaded,config:args.config,options:args.audio!,ledger:args.ledger,signal:args.signal});
      prepared.analyzeInput.transcript=audio.transcript.segments;
      Object.assign(prepared.trace,{inference_boundary:boundary,asr_mode:audioMode,audio:audio.trace});
      provenance.audio_evidence=privateObservation(audio);
    }
    if(args.ocr?.mode==='local-retained'){
      const ocr=await prepareGoldOcr(args.loaded,args.ocr);
      args.signal.throwIfAborted();
      prepared.analyzeInput.ocr=ocr.segments;prepared.analyzeInput.ocrExtracted=ocr.extracted;
      Object.assign(prepared.trace,{inference_boundary:boundary,ocr_mode:'local-retained',ocr:ocr.trace});
      provenance.ocr_evidence=privateObservation(ocr);
    }
    const frameHashes=prepared.analyzeInput.frames.map((f)=>f.aHash),distances:number[]=[];
    for(let i=1;i<frameHashes.length;i++)distances.push(hammingDistanceHex(frameHashes[i-1]!,frameHashes[i]!));
    provenance.source_geography=prepared.sourceGeography;
    provenance.frame_diversity={selected_count:frameHashes.length,unique_perceptual_hashes:new Set(frameHashes).size,adjacent_hamming_distances:distances,mean_adjacent_hamming_distance:distances.length?distances.reduce((a,b)=>a+b,0)/distances.length:null};
    const analyzed=await args.model.analyze(prepared.analyzeInput);
    if(args.adaptiveTaxonomyTrace)provenance.adaptive_taxonomy=privateObservation(args.adaptiveTaxonomyTrace()??null);
    args.ledger.assertHealthy();args.signal.throwIfAborted();
    const grounded=groundClaimedEvidence(analyzed.evidence,prepared.analyzeInput);
    const normal=args.normalAnalysis?.()??(!analyzed.automaticDeepRecognition?analyzed:null);
    Object.assign(provenance,{model_evidence:privateObservation(analyzed.evidence),grounded_model_evidence:privateObservation(grounded),normal_model_evidence:normal?privateObservation(normal.evidence):null,normal_grounded_model_evidence:normal?privateObservation(groundClaimedEvidence(normal.evidence,prepared.analyzeInput)):null,normal_specificity:normal?privateObservation(evaluateNormalResultSpecificity(normal)):null,model_parse_diagnostics:privateObservation(analyzed.parseDiagnostics??null),recognition_failure_class:analyzed.recognitionFailureClass??null,automatic_deep_runtime:privateObservation(analyzed.automaticDeepRecognition??null),deterministic_features:evidenceFeatures(grounded,null,null)});
    const parsed=parseMediaEvidence(grounded);
    let ordinaryResult:any,mediaMentions:any;
    if(!analyzed.automaticDeepRecognition){
      // Match the worker classifier: grounded survivors win over malformed siblings.
      // The synthetic lifecycle represents a newly claimed recognition task only.
      const classification=classifyRecognitionFinalResult({...analyzed,evidence:grounded});
      // Gold deliberately omits source-platform provenance; the link resolver's
      // equivalent neutral platform is "unknown" (the media model uses "native").
      let input=prepareMediaResolverInput({platform:'unknown',groundedEvidence:parsed.ok?parsed.value:null,sourceMetadata:prepared.sourceMetadata});
      provenance.resolver_input=privateObservation(input);
      const pre=planPreResolve({taskStatus:'processing',parentStatus:'processing_metadata',outcome:classification.outcome,failureCode:classification.failureCode,evidenceParseOk:parsed.ok,renderedPlaces:input.rendered.renderedPlaces,partialPlaces:parsed.ok&&buildVayrinPartialResult(parsed.value)?1:0});
      if(pre.action!=='resolve'){
        if(pre.action!=='manual_fallback')throw new Error('unexpected_pre_resolve_lifecycle');
        return {...base,status:pre.taskTerminalStatus==='failed'?'failed':'review',autonomous:false,places:[],candidates:[],multi_place_detected:parsed.ok?parsed.value.multipleIntentionalPlaces:null,elapsed_ms:performance.now()-started,first_usable_result_ms:null,...args.ledger.snapshot(sequence),evidence_trace:trace,inference_evidence:provenance,runtime_finalization_status:pre.taskTerminalStatus,runtime_pre_resolve:pre,runtime_result_class:classification.resultClass,reason_codes:[pre.failureCode],runtime_model_input:analyzed.modelInput??null,automatic_deep:analyzed.automaticDeep??null};
      }
      if(adaptive.literalSourceStreet&&parsed.ok){
        const original=args.loaded.input.evidence;
        const sources:LiteralSourceText[]=[
          {id:'original_caption',kind:'caption',text:original.caption??''},
          {id:'original_description',kind:'caption',text:original.description??''},
          {id:'transcript',kind:'transcript',text:prepared.analyzeInput.transcript.map((s)=>s.text).join('\n')},
          {id:'ocr',kind:'ocr',text:prepared.analyzeInput.ocr.map((s)=>s.text).join('\n')},
        ];
        const enriched=applyLiteralSourceStreetEvidence({prepared:input,sources,groundedEvidence:parsed.value,config:adaptive});
        input=enriched.input;
        provenance.adaptive_source_street=privateObservation(enriched.trace);
        provenance.literal_source_sizes=sources.map((s)=>({id:s.id,kind:s.kind,characters:s.text.length}));
        provenance.resolver_input=privateObservation(input);
      }
      mediaMentions=input.mediaMentions;
      ordinaryResult=await(args.resolve??resolveSharedPlace)({evidence:input.mediaEvidence,env:{supabaseUrl:'',serviceRoleKey:'',googlePlacesKey:args.config.googlePlacesServerApiKey??'',geminiApiKey:'',geminiModel:''},mentions:input.mediaMentions.mentions,geoContext:input.mediaMentions.geoContext,relationships:input.mediaMentions.relationships,...(adaptive.literalSourceStreet?{nameDrivenDeps:{queryExtension:(base,mention)=>appendLiteralStreetToQuery(base,mention,adaptive)}}:{})});
      provenance.resolver_result=privateObservation(ordinaryResult);
      scoringPool=observedScoringPool(ordinaryResult);
      scoringPoolAvailable=Array.isArray(ordinaryResult.diagnostics?.mentionResults)&&ordinaryResult.diagnostics.mentionResults.some((m:any)=>Array.isArray(m.scoring));
      args.ledger.assertHealthy();args.signal.throwIfAborted();
      const mentionResults=ordinaryResult.diagnostics?.mentionResults??[];
      if(isRetryableNameDrivenProviderFailure({mentionResults,aggregateCandidates:ordinaryResult.candidates??[],providerErrorCount:mentionResults.filter((m:any)=>m.outcome==='provider_error').length} as any))throw new Error('resolver_provider_outage');
    }
    // Automatic Deep intercepts ordinary manual routing in the Edge finalizer.
    if(!parsed.ok)throw new Error('grounded_evidence_schema_invalid');
    const plan=planMediaFinalization({groundedEvidence:parsed.value,ordinaryResult,mediaMentions,automaticDeepRuntime:analyzed.automaticDeepRecognition,sourceGeography:prepared.sourceGeography,context:args.context,requireLegacyCandidateIdentity:adaptive.legacyTenantIdentity===true});
    provenance.finalization_plan=privateObservation(plan);provenance.deterministic_features=evidenceFeatures(grounded,ordinaryResult,plan);
    args.ledger.assertHealthy();args.signal.throwIfAborted();
    if(plan.status==='retry'||plan.status==='invalid')throw new Error('finalization_'+plan.status);
    const places=plan.autonomousPlaces.map((p:any)=>observedPlace(p.candidate,p.logicalResultId)).filter((p):p is GoldObservedPlace=>p!==null);
    const candidates=scoredCandidates(plan,ordinaryResult,analyzed.automaticDeepRecognition);
    const elapsed=performance.now()-started;
    return {...base,status:places.length?'completed':'review',autonomous:places.length>0,places,candidates,observed_scoring_pool:scoringPool,observed_scoring_pool_available:scoringPoolAvailable,observed_scoring_pool_boundary:OBSERVED_SCORING_POOL_BOUNDARY,multi_place_detected:plan.multiPlaceDetected,elapsed_ms:elapsed,first_usable_result_ms:places.length||candidates.length?elapsed:null,...args.ledger.snapshot(sequence),evidence_trace:trace,inference_evidence:provenance,runtime_finalization_status:plan.status,reason_codes:plan.reasonCodes,per_place_decisions:plan.perPlaceDecisions,runtime_model_input:analyzed.modelInput??null,automatic_deep:analyzed.automaticDeep??null};
  }catch(error){
    const code=error instanceof Error&&/^[a-zA-Z0-9_:-]+$/.test(error.message)?error.message:'inference_exception';
    return {...base,status:'failed',autonomous:false,places:[],candidates:[],observed_scoring_pool:scoringPool,observed_scoring_pool_available:scoringPoolAvailable,observed_scoring_pool_boundary:OBSERVED_SCORING_POOL_BOUNDARY,multi_place_detected:null,elapsed_ms:performance.now()-started,first_usable_result_ms:null,...args.ledger.snapshot(sequence),error_code:code,evidence_trace:trace,inference_evidence:provenance};
  }
}
