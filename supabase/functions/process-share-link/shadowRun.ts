// supabase/functions/process-share-link/shadowRun.ts
//
// Thin wrapper that persists a single resolver run to the
// `share_agent_runs` table for offline diagnostics. The new
// architecture writes the user-facing decision directly in the
// hot path (see `resolver/resolveSharedPlace.ts`), so this module
// is now a "fire-and-forget" persistence sink only.
//
// Rules (preserved from the legacy implementation):
//   - MUST NOT throw — all errors swallowed and logged under
//     `[agent-shadow]`.
//   - MUST NOT call into the synchronous response path.
//   - MUST NOT expose API keys or persist raw HTML / login secrets.

// @ts-nocheck — Deno runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { ResolverResult } from './types.ts';

export type PersistResolverRunArgs = {
  userId: string;
  url: string;
  platform: string;
  result: ResolverResult;
  /** End-to-end latency from request received → response built. */
  latencyMs: number;
  errors?: string[];
};

export async function persistResolverRun(
  args: PersistResolverRunArgs,
): Promise<string | null> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;

  try {
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await adminClient
      .from('share_agent_runs')
      .insert({
        user_id: args.userId,
        url: args.url,
        platform: args.platform,
        prompt_version: 'resolver-v2',
        model_used: null,
        agent_decision: args.result.decision,
        safety_decision: args.result.decision,
        safe_to_auto_save: args.result.safeToAutoSave,
        confidence: args.result.confidence,
        reasoning: (args.result.diagnostics?.decisionReasons as string[] | undefined)
          ?.join('; ') ?? null,
        tool_calls: null,
        candidates: args.result.candidates,
        evidence_used: args.result.evidenceUsed,
        latency_ms: args.latencyMs,
        errors: [...(args.errors ?? []), ...args.result.warnings],
        raw_response: args.result,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      console.log(`[agent-shadow] persist_failed msg=${truncate(error.message)}`);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.log(
      `[agent-shadow] persist_failed msg=${truncate((err as Error)?.message)}`,
    );
    return null;
  }
}

function truncate(s: string | null | undefined, max = 200): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
