// services/media-worker/src/db/supabase.ts
//
// Service-role Supabase client. The service-role key is used INTERNALLY only —
// never sent to clients, never returned in HTTP responses, never logged.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config/env.js';

export function createAdminClient(cfg: WorkerConfig): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
