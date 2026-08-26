import { open } from 'node:fs/promises';
import { MediaError } from '../types/media.js';
import type { DownloadResult } from '../security/ssrf.js';

const MAX_PROVIDER_BODY_BYTES = 2 * 1024 * 1024;
const MIN_MEDIA_BYTES = 1024;

export type ScrapeCreatorsRequestDeps = {
  fetch: typeof fetch;
  now: () => number;
};

export type ScrapeCreatorsJsonResult = {
  body: unknown;
  providerLatencyMs: number;
};

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new MediaError('provider_unavailable', 'scrapecreators_response_too_large');
  }
  if (!response.body) throw new MediaError('provider_unavailable', 'scrapecreators_empty_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel();
        throw new MediaError('provider_unavailable', 'scrapecreators_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
  } catch {
    throw new MediaError('provider_unavailable', 'scrapecreators_invalid_json');
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.ceil(value), 900) : undefined;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

/** Convert a bounded provider error body into one stable, secret-free detail.
 * Raw messages and payloads are never returned to callers or logs. */
export function classifyScrapeCreatorsTerminalResponse(status: number, body: unknown): string {
  const root = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const nested = root?.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : null;
  const text = [
    stringField(root?.error),
    stringField(root?.message),
    stringField(root?.errorStatus),
    stringField(nested?.code),
    stringField(nested?.message),
    stringField(nested?.status),
  ].filter((value): value is string => !!value).join(' ').toLowerCase();

  if (/cannot\s+(?:get|post)|endpoint\s+not\s+found|route\s+not\s+found/.test(text)) {
    return 'scrapecreators_endpoint_not_found';
  }
  if (/(?:post|content|media|video)\s+not\s+found|not\s+found.*(?:post|content|media|video)/.test(text)) {
    return 'scrapecreators_content_not_found';
  }
  if (/unsupported|not\s+supported/.test(text)) return 'scrapecreators_unsupported_media';
  if (/invalid.*url|url.*(?:required|missing)|missing.*url/.test(text)) {
    return 'scrapecreators_invalid_request';
  }
  if (/pars(?:e|er|ing)|scrap(?:e|ing).*fail|fail.*scrap|could\s+not.*(?:fetch|retrieve)/.test(text)) {
    return 'scrapecreators_provider_parser_failure';
  }
  if (status === 400 || status === 422) return 'scrapecreators_invalid_request';
  if (status === 404) return 'scrapecreators_not_found_unknown';
  return `scrapecreators_status_${status}`;
}

/** Shared, server-only ScrapeCreators request boundary. It owns authentication,
 * bounded response parsing, timeouts, and structured HTTP errors. Platform
 * providers own endpoint parameters and response interpretation. */
export async function requestScrapeCreatorsJson(input: {
  endpoint: URL;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
  clientErrorCode?: 'download_failed' | 'missing_video';
  terminalNoMediaStatuses?: readonly number[];
  paymentRequiredDetail?: string;
  deps?: Partial<ScrapeCreatorsRequestDeps>;
}): Promise<ScrapeCreatorsJsonResult> {
  const deps: ScrapeCreatorsRequestDeps = {
    fetch: input.deps?.fetch ?? fetch,
    now: input.deps?.now ?? Date.now,
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (input.signal.aborted) throw new MediaError('cancelled');
  input.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.min(input.timeoutMs, 30_000));
  const finish = () => {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
  };
  const started = deps.now();
  let response: Response;
  try {
    response = await deps.fetch(input.endpoint, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'x-api-key': input.apiKey,
        'user-agent': 'NearrMediaWorker/0.1 (+https://nearr.app; contact=support@nearr.app)',
      },
    });
  } catch {
    finish();
    if (input.signal.aborted) throw new MediaError('cancelled');
    if (controller.signal.aborted) throw new MediaError('download_timeout', 'scrapecreators_api_timeout');
    throw new MediaError('provider_unavailable', 'scrapecreators_transport_error');
  }

  if (response.status === 429) {
    await response.body?.cancel().catch(() => undefined);
    finish();
    throw new MediaError('provider_rate_limited', 'scrapecreators_rate_limited', retryAfterSeconds(response));
  }
  if (response.status === 402) {
    await response.body?.cancel().catch(() => undefined);
    finish();
    throw new MediaError(
      'provider_unavailable',
      input.paymentRequiredDetail ?? 'scrapecreators_credits_exhausted',
    );
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    finish();
    throw new MediaError('provider_unavailable', 'scrapecreators_provider_auth_failed');
  }
  if (!response.ok) {
    let terminalBody: unknown = null;
    const terminal = input.terminalNoMediaStatuses?.includes(response.status) === true;
    if (terminal) {
      try {
        terminalBody = await readBoundedJson(response);
      } catch {
        // Status remains authoritative. A malformed/oversized error body must
        // not turn a deterministic provider result into a paid outer retry.
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    finish();
    const code = terminal
      ? 'missing_video'
      : response.status >= 500
        ? 'provider_unavailable'
        : input.clientErrorCode ?? 'download_failed';
    const detail = terminal
      ? classifyScrapeCreatorsTerminalResponse(response.status, terminalBody)
      : `scrapecreators_status_${response.status}`;
    throw new MediaError(code, detail);
  }

  try {
    const body = await readBoundedJson(response);
    return { body, providerLatencyMs: Math.max(0, deps.now() - started) };
  } catch (error) {
    if (input.signal.aborted) throw new MediaError('cancelled');
    if (controller.signal.aborted) throw new MediaError('download_timeout', 'scrapecreators_api_timeout');
    throw error;
  } finally {
    finish();
  }
}

export async function validateScrapeCreatorsDownloadedPayload(
  filePath: string,
  result: DownloadResult,
): Promise<void> {
  const contentType = result.contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
    throw new MediaError('invalid_media', 'scrapecreators_bad_content_type');
  }
  if (result.bytes < MIN_MEDIA_BYTES) throw new MediaError('invalid_media', 'scrapecreators_media_too_small');
  const file = await open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(Math.min(result.bytes, 512));
    await file.read(prefix, 0, prefix.byteLength, 0);
    const text = prefix.toString('utf8').trimStart().toLowerCase();
    if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('{') || text.startsWith('[')) {
      throw new MediaError('invalid_media', 'scrapecreators_non_media_payload');
    }
  } finally {
    await file.close();
  }
}
