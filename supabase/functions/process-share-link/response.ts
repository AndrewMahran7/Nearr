// supabase/functions/process-share-link/response.ts
//
// JSON response helpers + wire-level status shapes.
//
// IMPORTANT: every status string here is part of the contract with
// the React Native host AND the iOS Share Extension. Do NOT rename
// without updating both clients in lockstep.

import { CORS_HEADERS } from './cors.ts';

export function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

// ---- Wire-level status helpers ------------------------------------

export function statusSaved(args: {
  placeId: string;
  googlePlaceId: string;
  saved: any;
  extracted?: any;
  agent?: any;
  diagnostics?: any;
}) {
  return json({
    status: 'saved',
    placeId: args.placeId,
    googlePlaceId: args.googlePlaceId,
    saved: args.saved,
    extraction: args.extracted ?? null,
    agent: args.agent ?? null,
    diagnostics: args.diagnostics ?? null,
  });
}

export function statusExtracted(args: {
  candidate?: any;
  candidates: any[];
  extracted: any;
  agent?: any;
  diagnostics?: any;
}) {
  return json({
    status: 'extracted',
    candidate: args.candidate ?? args.candidates[0] ?? null,
    candidates: args.candidates,
    extraction: args.extracted,
    agent: args.agent ?? null,
    diagnostics: args.diagnostics ?? null,
  });
}

export function statusAmbiguous(args: {
  candidates: any[];
  primaryCandidate?: any;
  extracted?: any;
  agent?: any;
  diagnostics?: any;
}) {
  return json({
    status: 'ambiguous',
    candidates: args.candidates,
    // Backward-compat with clients that prefer a single best guess.
    primaryCandidate: args.primaryCandidate ?? args.candidates[0] ?? null,
    extraction: args.extracted ?? null,
    agent: args.agent ?? null,
    diagnostics: args.diagnostics ?? null,
  });
}

export function statusOpenApp(args: {
  reason: string;
  extracted?: any;
  agent?: any;
  diagnostics?: any;
}) {
  return json({
    status: 'open_app',
    reason: args.reason,
    extraction: args.extracted ?? null,
    agent: args.agent ?? null,
    diagnostics: args.diagnostics ?? null,
  });
}

export function statusFailedRequiresApp(args: {
  reason: string;
  extracted?: any;
  agent?: any;
  diagnostics?: any;
}) {
  return json({
    status: 'failed_requires_app',
    reason: args.reason,
    extraction: args.extracted ?? null,
    agent: args.agent ?? null,
    diagnostics: args.diagnostics ?? null,
  });
}

export function statusFailed(reason: string, httpStatus = 400) {
  return json({ status: 'failed', reason }, { status: httpStatus });
}
