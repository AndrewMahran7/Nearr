// supabase/functions/process-share-link/request.ts
//
// Pure request body parsing.

import type { RequestMode } from './types.ts';

export type ParsedRequest = {
  url: string;
  accessToken: string;
  mode: RequestMode;
  prompt?: string;
  model?: string;
  agentBudgetMs: number | null;
  geminiTimeoutMs: number | null;
};

export type ParseRequestResult =
  | { ok: true; req: ParsedRequest }
  | { ok: false; reason: 'invalid_json' | 'missing_url' | 'method_not_allowed' };

export async function parseRequest(req: Request): Promise<ParseRequestResult> {
  if (req.method !== 'POST') {
    return { ok: false, reason: 'method_not_allowed' };
  }

  let body: {
    url?: string;
    accessToken?: string;
    mode?: RequestMode;
    prompt?: string;
    model?: string;
    debugSlow?: boolean;
    agentBudgetMs?: number;
    geminiTimeoutMs?: number;
  };
  try {
    body = await req.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const mode: RequestMode =
    body.mode === 'extract_debug_slow' ||
    (body.mode === 'extract' && body.debugSlow === true)
      ? 'extract_debug_slow'
      : body.mode === 'extract'
      ? 'extract'
      : body.mode === 'debug_gemini'
      ? 'debug_gemini'
      : 'save';

  const url = (body.url ?? '').trim();
  if (mode !== 'debug_gemini' && (!url || !/^https?:\/\//i.test(url))) {
    return { ok: false, reason: 'missing_url' };
  }

  // Auth: body.accessToken takes precedence; otherwise Authorization
  // header. Mirrors prior behavior.
  const headerAuth = req.headers.get('authorization') ?? '';
  const bearer = headerAuth.toLowerCase().startsWith('bearer ')
    ? headerAuth.slice(7).trim()
    : '';
  const accessToken = (body.accessToken ?? bearer ?? '').trim();

  const agentBudgetMs =
    typeof body.agentBudgetMs === 'number' && Number.isFinite(body.agentBudgetMs)
      ? Math.max(1_000, Math.round(body.agentBudgetMs))
      : null;
  const geminiTimeoutMs =
    typeof body.geminiTimeoutMs === 'number' && Number.isFinite(body.geminiTimeoutMs)
      ? Math.max(1_000, Math.round(body.geminiTimeoutMs))
      : null;

  return {
    ok: true,
    req: {
      url,
      accessToken,
      mode,
      prompt: body.prompt,
      model: body.model,
      agentBudgetMs,
      geminiTimeoutMs,
    },
  };
}
