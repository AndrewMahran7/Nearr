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
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 10_000);
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
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeout);
  }
}
