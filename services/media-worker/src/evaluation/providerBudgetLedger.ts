import { createHash } from 'node:crypto';

export type ProviderOperation = 'openai_responses' | 'gemini_generate' | 'google_text_search' | 'google_legacy_search' | 'google_geocode' | 'openai_transcription';
export type RateCard = {
  operation: ProviderOperation;
  model?: string;
  /** Exact mask for the billed Google Text Search SKU; never infer a price from brand alone. */
  fieldMask?: string;
  inputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteInputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  /** A verified accepted-input ceiling, never an instruction to truncate. */
  maxInputTokens?: number;
  longContext?: { aboveInputTokens:number;inputUsdPerMillion:number;cachedInputUsdPerMillion:number;cacheWriteInputUsdPerMillion?:number;outputUsdPerMillion:number };
  requestUsd?: number;
  audioUsdPerMinute?: number;
  maxOutputTokens?: number;
  /** A verified provider ceiling preserves the request. An override deliberately changes inference. */
  outputTokenPolicy?: 'explicit_inference_override' | 'verified_provider_ceiling';
  outputTokenPolicyBasis?: string;
  maxRequestUsd: number;
  maxCalls: number;
  source: string;
  verifiedAt: string;
};
export type ProviderBudgetConfig = {
  allowPaidRequests: boolean;
  maxUsd: number;
  maxCalls: number;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  rates: RateCard[];
};
export type ProviderLedgerEntry = {
  sequence: number;
  operation: ProviderOperation;
  provider: 'openai' | 'google';
  model: string | null;
  endpoint: string;
  request_sha256: string;
  original_request_sha256: string;
  transport_overrides: Array<{field:string;before:unknown;after:unknown;basis:string}>;
  output_token_policy?: RateCard['outputTokenPolicy'];
  rate_card_sha256: string;
  started_at: string;
  reservation_usd: number;
  /** The fetch transport was invoked; this is not an invoice/billing assertion. */
  dispatch_attempted: boolean;
  status: 'reserved' | 'complete' | 'unknown';
  input_token_upper_bound?: number;
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_tokens?: number;
  applied_rate_tier?: 'standard'|'long_context';
  response_model?: string|null;
  response_service_tier?: string|null;
  output_tokens?: number;
  audio_seconds?: number;
  elapsed_ms?: number;
  http_status?: number;
  provider_status?: string;
  cost_usd: number | null;
  failure_code?: string;
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const normalizedMask = (mask: string) => mask.split(',').map((x) => x.trim()).sort().join(',');

export class ProviderBudgetError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ProviderBudgetError'; }
}

function identify(url: URL): ProviderOperation {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ProviderBudgetError('provider_url_not_allowed');
  if (url.hostname === 'api.openai.com' && url.pathname === '/v1/responses') return 'openai_responses';
  if (url.hostname === 'api.openai.com' && url.pathname === '/v1/audio/transcriptions') return 'openai_transcription';
  if (url.hostname === 'generativelanguage.googleapis.com' && /^\/v1beta\/models\/[^/]+:generateContent$/.test(url.pathname)) return 'gemini_generate';
  if (url.hostname === 'places.googleapis.com' && url.pathname === '/v1/places:searchText') return 'google_text_search';
  if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/place/textsearch/json') return 'google_legacy_search';
  if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/geocode/json') return 'google_geocode';
  throw new ProviderBudgetError('provider_endpoint_not_allowed');
}

function wavDuration(bytes: Buffer): number {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new ProviderBudgetError('asr_requires_pcm_wav');
  let byteRate = 0, dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    if (size > bytes.length - offset - 8) throw new ProviderBudgetError('invalid_wav_chunk');
    if (name === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(offset + 8) !== 1) throw new ProviderBudgetError('asr_requires_pcm_wav');
      byteRate = bytes.readUInt32LE(offset + 16);
    }
    if (name === 'data') dataBytes += size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new ProviderBudgetError('invalid_wav_duration');
  return dataBytes / byteRate;
}

/** A serial-run guard also accounts safely for concurrent Places requests within one case.
 * Persist reservations before dispatch. Unknown charges keep their reservation and stop the run.
 * Rate cards are explicit run inputs, not guessed or silently substituted from old defaults.
 */
export class ProviderBudgetLedger {
  readonly abortController = new AbortController();
  readonly entries: ProviderLedgerEntry[] = [];
  private committedUsd = 0;
  private stopped: string | null = null;
  private readonly config: ProviderBudgetConfig;

  constructor(config: ProviderBudgetConfig, private readonly underlyingFetch: typeof fetch,
    private readonly persist: (entry: ProviderLedgerEntry) => Promise<void>) {
    this.config = structuredClone(config);
    if (!finite(config.maxUsd) || !integer(config.maxCalls) || config.maxCalls < 1 ||
        !integer(config.requestTimeoutMs) || config.requestTimeoutMs < 1 || !integer(config.maxRequestBytes) || config.maxRequestBytes < 1) throw new ProviderBudgetError('invalid_budget_config');
    for (const rate of config.rates) {
      if (!finite(rate.maxRequestUsd) || !integer(rate.maxCalls) || rate.maxCalls < 1 || !rate.source || !Number.isFinite(Date.parse(rate.verifiedAt))) throw new ProviderBudgetError('invalid_rate_card');
      for (const key of ['inputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteInputUsdPerMillion','outputUsdPerMillion','requestUsd','audioUsdPerMinute'] as const) {
        if (rate[key] !== undefined && !finite(rate[key])) throw new ProviderBudgetError('invalid_rate_price');
      }
      if (rate.cachedInputUsdPerMillion !== undefined && rate.inputUsdPerMillion !== undefined && rate.cachedInputUsdPerMillion > rate.inputUsdPerMillion) throw new ProviderBudgetError('cached_rate_exceeds_reservation_rate');
      if (rate.operation === 'openai_responses' || rate.operation === 'gemini_generate') {
        if (!finite(rate.inputUsdPerMillion) || !finite(rate.outputUsdPerMillion) || !integer(rate.maxOutputTokens) || rate.maxOutputTokens < 1) throw new ProviderBudgetError('missing_model_budget_bounds');
        if (!['explicit_inference_override','verified_provider_ceiling'].includes(rate.outputTokenPolicy ?? '') || !rate.outputTokenPolicyBasis?.trim()) throw new ProviderBudgetError('explicit_output_token_policy_required');
        if(rate.maxInputTokens!==undefined&&(!integer(rate.maxInputTokens)||rate.maxInputTokens<1))throw new ProviderBudgetError('invalid_input_token_ceiling');
        if(rate.longContext&&(!integer(rate.longContext.aboveInputTokens)||rate.longContext.aboveInputTokens<1||!finite(rate.longContext.inputUsdPerMillion)||!finite(rate.longContext.cachedInputUsdPerMillion)||!finite(rate.longContext.outputUsdPerMillion)||(rate.longContext.cacheWriteInputUsdPerMillion!==undefined&&!finite(rate.longContext.cacheWriteInputUsdPerMillion))))throw new ProviderBudgetError('invalid_long_context_rates');
        if(rate.operation==='openai_responses'&&(!finite(rate.cacheWriteInputUsdPerMillion)||(rate.longContext&&!finite(rate.longContext.cacheWriteInputUsdPerMillion))))throw new ProviderBudgetError('cache_write_rate_required');
      }
    }
  }

  private stop(code: string): never {
    this.stopped ??= code;
    this.abortController.abort(new ProviderBudgetError(code));
    throw new ProviderBudgetError(code);
  }

  assertHealthy(): void { if (this.stopped) throw new ProviderBudgetError(this.stopped); }

  snapshot(fromSequence = 0) {
    const entries = this.entries.filter((x) => x.sequence > fromSequence).map((x) => ({ ...x }));
    const complete = entries.every((x) => x.status === 'complete' && x.cost_usd !== null);
    const byProvider = new Map<string, {provider:string;measurement:'measured';calls:number;cost_usd:number}>();
    for (const entry of entries) if (entry.cost_usd !== null) {
      const item = byProvider.get(entry.operation) ?? {provider:entry.operation,measurement:'measured' as const,calls:0,cost_usd:0};
      item.calls++; item.cost_usd += entry.cost_usd; byProvider.set(entry.operation,item);
    }
    return { entries, provider_ledger_complete: complete, reserved_attempts:entries.length,provider_calls:entries.filter((x)=>x.dispatch_attempted).length,
      cost_usd: complete ? entries.reduce((n,x) => n + (x.cost_usd ?? 0),0) : null,
      cost_basis: entries.length ? 'measured_provider_ledger' as const : 'no_paid_calls' as const,
      provider_usage: [...byProvider.values()], committed_budget_usd:this.committedUsd,
      stopped_reason:this.stopped, pricing_basis:'Observed provider usage/request units multiplied by the frozen supplied rate card; not an invoice claim.' };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    this.assertHealthy();
    if (!this.config.allowPaidRequests) return this.stop('paid_requests_disabled');
    if (input instanceof Request) return this.stop('request_objects_not_supported');
    let url: URL;
    try { url = new URL(String(input)); } catch { return this.stop('invalid_provider_url'); }
    let operation: ProviderOperation;
    try { operation = identify(url); } catch (error) { return this.stop((error as ProviderBudgetError).code); }
    const isModel = operation === 'openai_responses' || operation === 'gemini_generate';
    const isAsr = operation === 'openai_transcription';
    const expectedMethod = operation === 'google_legacy_search' || operation === 'google_geocode' ? 'GET' : 'POST';
    if ((init?.method ?? 'GET').toUpperCase() !== expectedMethod) return this.stop('provider_method_not_allowed');
    const headers = new Headers(init?.headers);
    let body: Record<string, any> = {}, model: string | undefined, audioSeconds: number | undefined;
    let wireBody = init?.body, requestText = '', requestBytes = 0;
    let originalRequestText = '';
    const overrides: ProviderLedgerEntry['transport_overrides'] = [];
    if (isAsr) {
      if (!(wireBody instanceof FormData)) return this.stop('invalid_asr_body');
      const file = wireBody.get('file');
      if (!(file instanceof Blob)) return this.stop('invalid_asr_file');
      const bytes = Buffer.from(await file.arrayBuffer());
      try { audioSeconds = wavDuration(bytes); } catch (error) { return this.stop((error as ProviderBudgetError).code); }
      model = String(wireBody.get('model') ?? '');
      requestBytes = bytes.length;
      requestText = JSON.stringify({model,sha256:digest(bytes.toString('base64')),audioSeconds});
      originalRequestText = requestText;
    } else if (wireBody != null) {
      if (typeof wireBody !== 'string') return this.stop('provider_body_must_be_json');
      try { body = object(JSON.parse(wireBody)); } catch { return this.stop('invalid_provider_json'); }
      model = operation === 'gemini_generate' ? decodeURIComponent(url.pathname.split('/').pop()!.split(':')[0]!) : typeof body.model === 'string' ? body.model : undefined;
      originalRequestText = wireBody;
    }
    const rates = this.config.rates.filter((r) => r.operation === operation && (!isModel && !isAsr || r.model === model) &&
      (operation !== 'google_text_search' || typeof r.fieldMask === 'string' && normalizedMask(r.fieldMask) === normalizedMask(headers.get('x-goog-fieldmask') ?? '')));
    if (rates.length !== 1) return this.stop('missing_or_ambiguous_rate_card');
    const rate = rates[0]!;
    let tokenBound: number | undefined, reservation: number;
    if (isModel) {
      if (!finite(rate.inputUsdPerMillion) || !finite(rate.outputUsdPerMillion) || !integer(rate.maxOutputTokens) || rate.maxOutputTokens < 1) return this.stop('missing_model_budget_bounds');
      if (!['explicit_inference_override','verified_provider_ceiling'].includes(rate.outputTokenPolicy ?? '') || !rate.outputTokenPolicyBasis?.trim()) return this.stop('explicit_output_token_policy_required');
      const outputLimit = (before:unknown,field:string):number|undefined => {
        if (before !== undefined && (!integer(before) || before < 1)) return this.stop('invalid_request_output_limit');
        if (rate.outputTokenPolicy === 'verified_provider_ceiling') {
          if (typeof before === 'number' && before > rate.maxOutputTokens!) return this.stop('request_exceeds_verified_provider_ceiling');
          return before as number|undefined;
        }
        const after = Math.min(typeof before === 'number' ? before : rate.maxOutputTokens!, rate.maxOutputTokens!);
        if (before !== after) overrides.push({field,before:before??null,after,basis:rate.outputTokenPolicyBasis!});
        return after;
      };
      if (operation === 'openai_responses') {
        if (Array.isArray(body.tools) && body.tools.length) return this.stop('unpriced_model_tools');
        const limit=outputLimit(body.max_output_tokens,'max_output_tokens');
        if(limit!==undefined)body.max_output_tokens=limit;
        if(body.store!==false)overrides.push({field:'store',before:body.store??null,after:false,basis:'Evaluation retention policy; no response storage.'});
        body.store = false;
      } else {
        if (Array.isArray(body.tools) && body.tools.length) return this.stop('unpriced_model_tools');
        const generation = object(body.generationConfig);
        const limit=outputLimit(generation.maxOutputTokens,'generationConfig.maxOutputTokens');
        if(limit!==undefined){generation.maxOutputTokens=limit;body.generationConfig=generation;}
      }
      // Conservative byte ceiling, including inline image bytes and prompt/schema overhead.
      // Never accept remotely hosted model inputs whose size is outside this bound.
      requestText = JSON.stringify(body);
      if (/"(?:image_url|file_uri|fileUri)"\s*:\s*"https?:/i.test(requestText)) return this.stop('remote_model_media_forbidden');
      requestBytes = Buffer.byteLength(requestText);
      tokenBound = Math.min(requestBytes + 4096,rate.maxInputTokens??Infinity);
      const reserveRates=[rate,...(rate.longContext&&tokenBound>rate.longContext.aboveInputTokens?[rate.longContext]:[])];
      const maxInputRate=Math.max(...reserveRates.flatMap((r)=>[r.inputUsdPerMillion!,r.cachedInputUsdPerMillion??0,r.cacheWriteInputUsdPerMillion??0]));
      reservation = (tokenBound * maxInputRate + rate.maxOutputTokens * Math.max(...reserveRates.map((r)=>r.outputUsdPerMillion!))) / 1e6;
      wireBody = requestText;
    } else if (isAsr) {
      if (!finite(rate.audioUsdPerMinute)) return this.stop('missing_asr_rate');
      reservation = Math.ceil(audioSeconds!) / 60 * rate.audioUsdPerMinute;
    } else {
      if (!finite(rate.requestUsd)) return this.stop('missing_request_rate');
      reservation = rate.requestUsd;
      requestText = wireBody == null ? url.pathname + url.search : JSON.stringify(body);
      originalRequestText = requestText;
      requestBytes = Buffer.byteLength(requestText);
    }
    if (requestBytes > this.config.maxRequestBytes) return this.stop('provider_request_too_large');
    if (reservation > rate.maxRequestUsd + 1e-12) return this.stop('request_budget_reservation_exceeded');
    const rateHash = digest(JSON.stringify(rate));
    if (this.entries.length >= this.config.maxCalls || this.entries.filter((x) => x.rate_card_sha256 === rateHash).length >= rate.maxCalls) return this.stop('provider_call_cap');
    if (this.committedUsd + reservation > this.config.maxUsd + 1e-12) return this.stop('run_budget_reservation_exceeded');
    const started = Date.now();
    const entry: ProviderLedgerEntry = {sequence:this.entries.length+1,operation,provider:operation.startsWith('openai')?'openai':'google',model:model ?? null,
      endpoint:url.origin+url.pathname,request_sha256:digest(requestText),original_request_sha256:digest(originalRequestText),transport_overrides:overrides,...(isModel?{output_token_policy:rate.outputTokenPolicy}:{}),rate_card_sha256:rateHash,started_at:new Date(started).toISOString(),reservation_usd:reservation,dispatch_attempted:false,status:'reserved',cost_usd:null,
      ...(tokenBound !== undefined ? {input_token_upper_bound:tokenBound}:{}),...(audioSeconds !== undefined ? {audio_seconds:audioSeconds}:{})};
    this.entries.push(entry); this.committedUsd += reservation;
    try { await this.persist({...entry}); } catch { return this.stop('ledger_reservation_persistence_failed'); }
    this.assertHealthy();
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signal = AbortSignal.any([this.abortController.signal,timeout,...(init?.signal?[init.signal]:[])]);
    let response: Response;
    try {
      entry.dispatch_attempted=true;
      response = await this.underlyingFetch(input,{...init,body:wireBody,headers,signal,redirect:'error'});
      entry.http_status = response.status;
      if (!response.ok) throw new ProviderBudgetError('provider_http_charge_unknown');
      if (isModel) {
        const json = object(await response.clone().json());
        entry.response_model=typeof(json.model??json.modelVersion)==='string'?(json.model??json.modelVersion):null;
        entry.response_service_tier=typeof json.service_tier==='string'?json.service_tier:null;
        // Tools are not part of this frozen baseline. Unexpected billed outputs
        // invalidate the cost ledger instead of being silently priced as tokens.
        if(operation==='openai_responses'&&Array.isArray(json.output)&&json.output.some((item:any)=>typeof item?.type==='string'&&item.type.endsWith('_call')))throw new ProviderBudgetError('unpriced_provider_tool_output');
        if(operation==='openai_responses'&&entry.response_service_tier&&entry.response_service_tier!=='default')throw new ProviderBudgetError('unpriced_provider_service_tier');
        if(operation==='gemini_generate'&&Array.isArray(json.candidates)&&json.candidates.some((item:any)=>item?.groundingMetadata||item?.urlContextMetadata))throw new ProviderBudgetError('unpriced_provider_grounding_output');
        const usage = object(operation === 'openai_responses' ? json.usage : json.usageMetadata);
        const inTokens = operation === 'openai_responses' ? usage.input_tokens : usage.promptTokenCount;
        const outTokens = operation === 'openai_responses' ? usage.output_tokens : (integer(usage.candidatesTokenCount) && (usage.thoughtsTokenCount == null || integer(usage.thoughtsTokenCount)) ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) : undefined);
        const cached = operation === 'openai_responses' ? object(usage.input_tokens_details).cached_tokens ?? 0 : usage.cachedContentTokenCount ?? 0;
        const written = operation === 'openai_responses' ? object(usage.input_tokens_details).cache_write_tokens : 0;
        if (!integer(inTokens) || !integer(outTokens) || !integer(cached) || !integer(written) || cached+written > inTokens) throw new ProviderBudgetError('provider_usage_missing');
        if (inTokens > tokenBound! || outTokens > rate.maxOutputTokens!) throw new ProviderBudgetError('provider_usage_exceeded_reserved_bound');
        const applied=rate.longContext&&inTokens>rate.longContext.aboveInputTokens?rate.longContext:rate;
        if (cached && !finite(applied.cachedInputUsdPerMillion)) throw new ProviderBudgetError('cached_input_rate_missing');
        entry.input_tokens=inTokens;entry.cached_input_tokens=cached;entry.cache_write_tokens=written;entry.output_tokens=outTokens;entry.applied_rate_tier=applied===rate?'standard':'long_context';
        entry.cost_usd=((inTokens-cached-written)*applied.inputUsdPerMillion!+cached*(applied.cachedInputUsdPerMillion ?? applied.inputUsdPerMillion!)+written*(applied.cacheWriteInputUsdPerMillion??0)+outTokens*applied.outputUsdPerMillion!)/1e6;
      } else {
        if(operation==='google_legacy_search'||operation==='google_geocode'){
          const json=object(await response.clone().json());entry.provider_status=typeof json.status==='string'?json.status:'missing';
          if(!['OK','ZERO_RESULTS'].includes(entry.provider_status))throw new ProviderBudgetError('provider_api_status_charge_unknown');
        }
        entry.cost_usd = reservation;
      }
      if (entry.cost_usd > reservation + 1e-12) throw new ProviderBudgetError('provider_charge_exceeded_reservation');
      entry.status='complete'; entry.elapsed_ms=Date.now()-started;
      await this.persist({...entry});
      this.committedUsd += entry.cost_usd - reservation;
      return response;
    } catch (error) {
      entry.status='unknown'; entry.cost_usd=null; entry.elapsed_ms=Date.now()-started;
      entry.failure_code=error instanceof ProviderBudgetError ? error.code : signal.aborted ? 'provider_aborted_charge_unknown' : 'provider_transport_charge_unknown';
      try { await this.persist({...entry}); } catch { entry.failure_code='ledger_completion_persistence_failed'; }
      return this.stop(entry.failure_code);
    }
  };
}
