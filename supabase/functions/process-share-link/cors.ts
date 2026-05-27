// supabase/functions/process-share-link/cors.ts
//
// CORS configuration. Wildcard origin is required because the iOS
// Share Extension issues requests from a non-browser context with no
// `Origin` header at all, and the host React Native app uses the
// Supabase Edge Function URL directly.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function preflight(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}
