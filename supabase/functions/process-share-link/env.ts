// supabase/functions/process-share-link/env.ts
//
// Centralized env-var reader. Pure: never throws, never logs values.
//
// Required (auto-populated by Supabase runtime):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Required (must be configured via `supabase secrets set ...`):
//   GOOGLE_PLACES_KEY (also accepts EXPO_PUBLIC_GOOGLE_PLACES_KEY /
//                     EXPO_PUBLIC_GOOGLE_MAPS_API_KEY for parity with
//                     existing eas/expo configurations)
//
// Optional:
//   GEMINI_API_KEY  — if missing, AI step degrades to deterministic
//                      caption-only extraction.
//   GEMINI_MODEL    — overrides the default model name.

// @ts-nocheck — Deno runtime.

export type Env = {
  supabaseUrl: string;
  serviceRoleKey: string;
  googlePlacesKey: string;
  geminiApiKey: string;
  geminiModel: string | null;
};

export function readEnv(): Env {
  return {
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    googlePlacesKey:
      Deno.env.get('GOOGLE_PLACES_KEY') ??
      Deno.env.get('EXPO_PUBLIC_GOOGLE_PLACES_KEY') ??
      Deno.env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ??
      '',
    geminiApiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
    geminiModel: Deno.env.get('GEMINI_MODEL') || null,
  };
}

export type EnvValidation =
  | { ok: true; env: Env }
  | { ok: false; reason: 'missing_supabase' | 'missing_places_key' };

export function validateEnv(env: Env): EnvValidation {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { ok: false, reason: 'missing_supabase' };
  }
  if (!env.googlePlacesKey) {
    return { ok: false, reason: 'missing_places_key' };
  }
  return { ok: true, env };
}
