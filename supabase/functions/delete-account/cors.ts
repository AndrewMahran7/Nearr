// supabase/functions/delete-account/cors.ts
//
// CORS configuration for the account-deletion Edge Function.
//
// Only POST (the deletion call) and OPTIONS (browser/preflight) are
// permitted. The React Native host app calls this endpoint directly via
// the Supabase Functions client, which does not send an Origin header, so
// a wildcard origin is safe and required for parity with the other
// function in this project.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function preflight(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}
