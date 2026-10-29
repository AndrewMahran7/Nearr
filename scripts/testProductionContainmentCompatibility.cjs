/* Independent, offline legacy compatibility check. No cloud writes or HTTP.
 * Executes actual historical client/parser code with injected runtime boundaries.
 * This is not a signed-iOS/physical-device or complete application-render test. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const historicalRef = process.env.NEARR_LEGACY_REVIEW_REF || '4e6b60e';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true });
const historicalCommit = git('rev-parse', historicalRef).trim();
const source = file => git('show', `${historicalCommit}:${file}`);
const files = ['lib/shareExtractionBackend.ts', 'lib/shareJobClient.ts', 'lib/aiExtractPlace.ts', 'app/share.tsx', 'ShareExtension.tsx'];
const sources = Object.fromEntries(files.map(file => [file, source(file)]));
const results = [];
const candidateHashes = {};
const quiet = { log() {}, warn() {}, error() {} };
const fixtureUrl = 'https://fixture.invalid/video';

function moduleVm(code, injected = {}, imports = {}) {
  const exports = {};
  const context = vm.createContext({ exports, module: { exports }, console: quiet, URL,
    Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import: ${name}`); },
    ...injected });
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInContext(js, context, { timeout: 2000 });
  return exports;
}

const inertProfiles = { pickBestVerifiedVenueProfile: () => null, buildVerifiedProfileQuery: () => null, isVerifiedVenueProfile: () => false };
async function parseResponse(status, body) {
  let fetches = 0;
  const client = moduleVm(sources['lib/shareExtractionBackend.ts'], {
    fetch: async () => { fetches++; return Response.json(body, { status }); },
  }, {
    'expo-constants': {}, './instagramProfileMetadata': inertProfiles,
    './shareEnvDiagnostics': { resolveProcessShareLinkUrl: () => ({ url: 'https://fixture.invalid/process-share-link', source: 'fixture' }), hostFromUrl: () => 'fixture.invalid' },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'OFFLINE_FIXTURE_ONLY' } } }) } } },
  });
  const outcome = [];
  const extraction = await client.extractShareOnServer(fixtureUrl, { onOutcome: value => outcome.push(value) });
  assert.equal(fetches, 1);
  assert.equal(outcome.length, 1);
  return { extraction, outcome: outcome[0] };
}

// Extract the original decision block verbatim; do not reimplement its logic.
const host = sources['app/share.tsx'];
const decisionStart = host.indexOf('const agentBlock = serverExtraction?.agent ?? null;');
const decisionEnd = host.indexOf('// ---- 2b. AI enhancement', decisionStart);
assert.ok(decisionStart > 0 && decisionEnd > decisionStart);
async function hostDecision(serverExtraction) {
  const calls = [];
  const client = moduleVm(`export async function decide() { ${host.slice(decisionStart, decisionEnd)} return 'legacy_fallback_reached'; }`, {
    serverExtraction, parsedResult: { url: fixtureUrl, source: 'link' }, extracted: { query: '' },
    setDebugState: callback => callback({}), pushShareDebug() {}, logDebug() {},
    saveCandidate: async () => { calls.push('save'); throw new Error('Unexpected save'); },
    setCandidates: () => calls.push('candidates'), setPhase: value => calls.push(`phase:${value}`),
    deriveManualFallbackQuery: args => args.query ?? '',
    enterManualFallback: args => calls.push({ kind: 'manual', reason: args.reason, suggestedQuery: args.suggestedQuery }),
  });
  return { result: await client.decide(), calls };
}

const referenceEnvelope = {
  status: 'extracted', paused: true, reason: 'recognition_temporarily_unavailable',
  message: 'Recognition is temporarily unavailable. Your saved places are still available.',
  candidates: [], candidate: null,
  extraction: {
    source: 'link', query: '', querySource: 'none', confidence: 'low', queryKind: 'unknown',
    searchAllowed: false, blockedReason: 'recognition_temporarily_unavailable',
    placeName: null, address: null, city: null, state: null, sourceContext: null,
    posterHandle: null, posterType: 'unknown', taggedAccounts: [], profileMetadata: [],
    agent: { userFacingDecision: 'manual_fallback', safeToAutoSave: false,
      candidates: [], rejectionReasons: ['recognition_temporarily_unavailable'],
      evidenceUsed: [], toolsUsed: [], warnings: [], reasoning: 'Recognition is temporarily unavailable.' },
  },
};

async function main() {
  assert.equal(JSON.parse(source('app.json')).expo.version, '1.4.55');
  const denied = await parseResponse(503, { error: 'recognition_temporarily_unavailable' });
  assert.equal(denied.extraction, null);
  assert.equal(denied.outcome.failureReason, 'non_200');
  assert.equal((await hostDecision(denied.extraction)).result, 'legacy_fallback_reached');
  results.push('Historical 1.4.55 parser plus original host decision block confirms generic 503 reaches legacy fallback (hazard, not safe containment).');

  const manual = await parseResponse(200, referenceEnvelope);
  assert.equal(manual.outcome.failureReason, null);
  assert.equal(manual.extraction.agent.userFacingDecision, 'manual_fallback');
  assert.equal(manual.extraction.searchAllowed, false);
  const decision = await hostDecision(manual.extraction);
  assert.equal(decision.result, undefined);
  assert.equal(decision.calls.length, 1);
  assert.equal(decision.calls[0].kind, 'manual');
  assert.equal(decision.calls[0].suggestedQuery, '');
  results.push('Reference HTTP200 extracted/manual_fallback envelope is accepted by actual old parser and original decision block exits without autosave or legacy fallback.');

  let jobCalls = 0;
  const jobClient = moduleVm(sources['lib/shareJobClient.ts'], {
    fetch: async () => { jobCalls++; return Response.json({ error: 'recognition_temporarily_unavailable' }, { status: 503 }); },
  });
  const job = await jobClient.createShareJob({ endpoint: 'https://fixture.invalid/create-share-job', url: fixtureUrl, accessToken: 'OFFLINE_FIXTURE_ONLY' });
  assert.equal(job.ok, false); assert.equal(job.reason, 'http_error'); assert.equal(job.httpStatus, 503);
  assert.equal(job.responseErrorCode, 'recognition_temporarily_unavailable'); assert.equal(jobCalls, 1);
  assert.equal(job.jobId, undefined);
  results.push('Actual old create-share-job client rejects paused503 as http_error and never acknowledges a fake durable job.');

  let providerCalls = 0;
  const ai = moduleVm(sources['lib/aiExtractPlace.ts'], {
    process: { env: {} }, fetch: async () => { providerCalls++; throw new Error('Unexpected provider'); },
  }, { './instagramProfileMetadata': inertProfiles,
    './queryValidation': { isGenericContentQuery: () => false, looksLikeVenueNameCandidate: () => true } });
  await ai.extractPlaceAI({ sourceType: 'link', url: fixtureUrl, fallbackQuery: '' });
  assert.equal(providerCalls, 0);
  assert.match(sources['lib/aiExtractPlace.ts'], /process\.env\.GEMINI_API_KEY/);
  assert.match(sources['lib/aiExtractPlace.ts'], /https:\/\/generativelanguage\.googleapis\.com/);
  results.push('Actual old AI fallback makes zero provider requests with an absent key; source has a direct Gemini route if a key exists. Signed-binary key absence is not established.');

  const manualStart = host.indexOf('function enterManualFallback(');
  const manualEnd = host.indexOf('// Manual fallback search', manualStart);
  assert.match(host.slice(manualStart, manualEnd), /setFailMessage\(MANUAL_FALLBACK_MESSAGE\)/);
  assert.doesNotMatch(host.slice(manualStart, manualEnd), /serverExtraction\??\.message|opts\.message/);
  results.push('Old manual fallback uses hardcoded MANUAL_FALLBACK_MESSAGE, not the response message: explicit pause copy in that binary is not claimed.');

  const candidateRoot = 'artifacts/global-release/final-production/backend/containment';
  for (const endpoint of ['process-share-link', 'create-share-job', 'process-share-jobs']) {
    const file = `${candidateRoot}/edge/supabase/functions/${endpoint}/index.ts`;
    const candidate = readFileSync(file, 'utf8');
    candidateHashes[file] = createHash('sha256').update(candidate).digest('hex');
    let handler, forbiddenCalls = 0;
    const forbidden = () => { forbiddenCalls++; throw new Error('Forbidden candidate I/O'); };
    moduleVm(candidate, { Deno: { serve: fn => { handler = fn; }, env: { get: forbidden } }, fetch: forbidden });
    assert.equal(typeof handler, 'function');
    for (const method of ['OPTIONS','GET','POST']) {
      // Access to body, auth, URLs, fetch or environment fails this test.
      const request = new Proxy({ method }, { get(target, property) {
        if (property === 'method') return method;
        forbidden();
      } });
      const response = await handler(request);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.status, method === 'OPTIONS' ? 204 : method === 'GET' ? 405 : endpoint === 'process-share-link' ? 200 : 503);
      if (method === 'POST') {
        const body = await response.json();
        assert.equal(body.containmentVersion, 'nearr-production-pause-v1');
        assert.equal(body.paused, true);
        assert.equal(body.jobId, undefined); assert.equal(body.savedPlaceId, undefined);
        if (endpoint === 'process-share-link') {
          const actualParsed = await parseResponse(response.status, body);
          const actualDecision = await hostDecision(actualParsed.extraction);
          assert.equal(actualDecision.result, undefined);
          assert.equal(actualDecision.calls.length, 1);
          assert.equal(actualDecision.calls[0].kind, 'manual');
          assert.equal(actualDecision.calls[0].reason, 'recognition_temporarily_unavailable');
        } else assert.equal(body.error, 'recognition_temporarily_unavailable');
      }
    }
    assert.equal(forbiddenCalls, 0);
    results.push(`Actual candidate ${endpoint}: OPTIONS/GET/POST execute with zero body/auth/env/network reads; correct no-store pause contract${endpoint === 'process-share-link' ? '; actual old parser/decision block exits without automatic fallback' : ''}.`);
  }

  const workerFile = `${candidateRoot}/worker/server.cjs`;
  const worker = readFileSync(workerFile, 'utf8');
  candidateHashes[workerFile] = createHash('sha256').update(worker).digest('hex');
  let httpHandler, imported = [];
  const workerExports = {};
  const fakeRequire = name => { imported.push(name); assert.equal(name, 'node:http'); return { createServer: handler => { httpHandler = handler; return {}; } }; };
  const workerContext = vm.createContext({ module: { exports: workerExports }, exports: workerExports, require: fakeRequire, setTimeout });
  vm.runInContext(worker, workerContext, { timeout: 1000 });
  workerContext.module.exports.createServer();
  for (const [method, url] of [['GET','/health'],['GET','/ready'],['POST','/v1/process-media-tasks'],['POST','/v1/finalize-media-task'],['POST','/unknown']]) {
    let code, body, consumed = 0;
    httpHandler({ method, url, resume() { consumed++; } }, { writeHead(status) { code = status; }, end(value) { body = JSON.parse(value); } });
    assert.equal(code, method === 'GET' && url === '/health' ? 200 : 503);
    assert.equal(body.containmentVersion, 'nearr-production-pause-v1');
    assert.equal(consumed, 1);
    if (code === 503) assert.equal(body.providerDispatchEnabled, false);
  }
  assert.deepEqual(imported, ['node:http']);
  results.push('Actual inert worker routes: health200, readiness/process/finalize/unknown503, only node:http imported, no provider/database/bootstrap modules.');

  const suffix = historicalCommit === '4e6b60e9b6e727381eeac98d8361d01423e95210' ? '' : `-${historicalCommit.slice(0,12)}`;
  const out = `artifacts/global-release/final-production/backend/containment-independent-tests${suffix}.json`;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ testedAt: new Date().toISOString(), kind: 'offline-historical-client-containment-compatibility',
    historicalCommit, historicalVersion: '1.4.55',
    buildMetadataLinkageVerified: true,
    buildMetadataEvidence: 'legacy-public-build-inspection.json (EAS Build55 git/version match) plus root live ASC selected Build55',
    publishedOtaMetadataEvidence: 'legacy-production-ota-inspection.json (production channel / clean ded0404 iOS update)',
    actualSignedBundleInspected: false, actualPublishedOtaBundleInspected: false,
    candidateSourceHandlersTested: true, candidateDeploymentTested: false, candidateHashes, realNetworkCalls: 0, cloudMutations: [],
    sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')])),
    passed: results.length, failed: 0, tests: results,
    boundaries: ['Supabase auth/session and fetch injected', 'Empty profile normalization helpers injected', 'Original host decision block executed, not a full React screen or iOS extension render'],
  }, null, 2) + '\n');
  console.log(`PASS ${results.length} independent legacy/candidate-source checks; zero real HTTP/cloud writes. No deployment or physical-iOS claim.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
