// Permanent fail-closed containment build. No imports, credentials, I/O or queue.
// The platform retains this endpoint's existing verify_jwt=true setting.
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers });
  // Do not fabricate a job, deduct a use, or acknowledge a queued operation.
  return Response.json({ error: 'recognition_temporarily_unavailable', paused: true,
    message: 'Recognition is temporarily unavailable. Your saved places are still available.',
    containmentVersion: 'nearr-production-pause-v1' },
    { status: 503, headers: { ...headers, 'Retry-After': '3600' } });
});
