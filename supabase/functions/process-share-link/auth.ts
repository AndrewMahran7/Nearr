// supabase/functions/process-share-link/auth.ts
//
// User authentication using a service-role Supabase client. Mirrors
// prior behavior exactly: pass-through the user's accessToken to
// `auth.getUser()` and extract the user id.

// @ts-nocheck — Deno runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Env } from './env.ts';

export type AuthResult =
  | { ok: true; userId: string; userClient: any }
  | { ok: false; reason: 'missing_auth' | 'invalid_auth' };

export async function authenticate(
  env: Env,
  accessToken: string,
): Promise<AuthResult> {
  if (!accessToken) return { ok: false, reason: 'missing_auth' };
  const userClient = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data?.user) {
    return { ok: false, reason: 'invalid_auth' };
  }
  return { ok: true, userId: data.user.id, userClient };
}
