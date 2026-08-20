/**
 * lib/shareJobClient.ts
 *
 * Tiny, dependency-free client for the `create-share-job` Edge Function.
 * Importable from BOTH the host app and the iOS Share Extension target
 * (fetch only — no supabase, no expo-router, no react).
 *
 * NEVER logs the URL or the token. Callers pass the access token in; it is
 * sent as a Bearer header and never persisted.
 */

export type CreateShareJobResult =
  | { ok: true; jobId: string; status: string; duplicate: boolean }
  | {
      ok: false;
      reason:
        | 'no_endpoint'
        | 'missing_auth'
        | 'invalid_url'
        | 'unauthorized'
        | 'timeout'
        | 'network'
        | 'http_error'
        | 'invalid_response';
      httpStatus?: number;
      responseErrorCode?: string;
      requestId?: string;
    };

// Bound a request whose native networking callback never reaches JavaScript.
// Host callers reconcile this indeterminate result against the durable queue
// by clientRequestId; a timeout alone is therefore not treated as proof that
// create-share-job failed.
export const DEFAULT_SHARE_JOB_TIMEOUT_MS = 10_000;

function boundedCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,60}$/.test(code) ? code : undefined;
}

function responseRequestId(res: Response): string | undefined {
  return boundedCode(res.headers.get('sb-request-id') ?? res.headers.get('x-request-id'));
}

export async function createShareJob(args: {
  endpoint: string;
  url: string;
  accessToken: string;
  clientRequestId?: string;
  timeoutMs?: number;
}): Promise<CreateShareJobResult> {
  const endpoint = (args.endpoint ?? '').trim();
  if (!endpoint) return { ok: false, reason: 'no_endpoint' };
  if (!args.accessToken) return { ok: false, reason: 'missing_auth' };
  if (!args.url || !/^https?:\/\//i.test(args.url)) {
    return { ok: false, reason: 'invalid_url' };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_SHARE_JOB_TIMEOUT_MS,
  );
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify({
        url: args.url,
        clientRequestId: args.clientRequestId,
      }),
      signal: controller.signal,
    });

    // The network/bridge acknowledgement has arrived. Do not let its old
    // deadline abort response parsing and turn a durable HTTP 200 into a false
    // timeout. From here the parsed response contract decides success/failure.
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    const json = (await res.json().catch(() => null)) as
      | { jobId?: string; status?: string; duplicate?: boolean; error?: string }
      | null;
    const diagnostic = {
      httpStatus: res.status,
      responseErrorCode: boundedCode(json?.error),
      requestId: responseRequestId(res),
    };

    if (res.status === 401) return { ok: false, reason: 'unauthorized', ...diagnostic };
    if (res.status === 400) return { ok: false, reason: 'invalid_url', ...diagnostic };
    if (!res.ok) return { ok: false, reason: 'http_error', ...diagnostic };

    if (!json || typeof json.jobId !== 'string') {
      return {
        ok: false,
        reason: 'invalid_response',
        ...diagnostic,
        responseErrorCode: diagnostic.responseErrorCode ?? 'missing_job_id',
      };
    }
    return {
      ok: true,
      jobId: json.jobId,
      status: typeof json.status === 'string' ? json.status : 'queued',
      duplicate: !!json.duplicate,
    };
  } catch (err) {
    // React Native can surface an AbortController cancellation as either an
    // AbortError or TypeError("Network request failed"). The signal is the
    // authoritative indication that our deadline, rather than the network,
    // caused the failure.
    const timedOut =
      controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return { ok: false, reason: timedOut ? 'timeout' : 'network' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
