// Intentional pause of sweep, recovery and finalize callbacks alike.
// No imports/provider/DB/notification calls: existing jobs, leases, notification
// logical IDs, provider-attempt markers and receipt states remain untouched.
// This pauses pending recognition-result notices, not device-local reminders.
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nearr-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers });
  return Response.json({ error: 'recognition_temporarily_unavailable', paused: true,
    claimed: 0, processed: 0, notificationsDispatched: 0,
    containmentVersion: 'nearr-production-pause-v1' },
    { status: 503, headers: { ...headers, 'Retry-After': '3600' } });
});
