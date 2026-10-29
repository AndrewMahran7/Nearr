// Dependency-free pause router: never reads request body, auth, secrets or URLs.
// HTTP 200 is the legacy transport contract, NOT a successful recognition/save.
// A generic 503 makes old 1.4 clients enter their legacy AI fallback instead.
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nearr-app-version, x-app-version, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers });
  return Response.json({
    status: 'extracted', paused: true, reason: 'recognition_temporarily_unavailable',
    message: 'Recognition is temporarily unavailable. Your saved places are still available.',
    containmentVersion: 'nearr-production-pause-v1', candidates: [], candidate: null,
    extraction: {
      source: 'link', query: '', querySource: 'none', confidence: 'low', queryKind: 'unknown',
      searchAllowed: false, blockedReason: 'recognition_temporarily_unavailable',
      placeName: null, address: null, city: null, state: null, sourceContext: null,
      posterHandle: null, posterType: 'unknown', taggedAccounts: [], profileMetadata: [],
      agent: { userFacingDecision: 'manual_fallback', safeToAutoSave: false,
        candidates: [], rejectionReasons: ['recognition_temporarily_unavailable'],
        evidenceUsed: [], toolsUsed: [], warnings: [], reasoning: 'Recognition is temporarily unavailable.' },
    },
  }, { status: 200, headers });
});
