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
    };

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

    if (res.status === 401) return { ok: false, reason: 'unauthorized', httpStatus: 401 };
    if (res.status === 400) return { ok: false, reason: 'invalid_url', httpStatus: 400 };
    if (!res.ok) return { ok: false, reason: 'http_error', httpStatus: res.status };

    const json = (await res.json().catch(() => null)) as
      | { jobId?: string; status?: string; duplicate?: boolean }
      | null;
    if (!json || typeof json.jobId !== 'string') {
      return { ok: false, reason: 'invalid_response' };
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
