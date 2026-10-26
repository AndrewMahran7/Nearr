/** Execute the actual complete host runSaveFlow function with explicit external
 * boundary mocks. No copied guard implementation, React tree, network or keys. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../lib/i18nEngine';
import { shareAccessPresentation } from '../lib/shareAccessPresentation';

const source = readFileSync('app/share.tsx', 'utf8');
const parsed = ts.createSourceFile('share.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let flow: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'runSaveFlow') flow = node;
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(flow, 'actual host flow must exist');
const executable = ts.transpileModule(flow!.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const url = 'https://example.invalid/public-post';
type Session = { user: { id: string }; access_token: string } | null;
type Access = { data: { aiAllowed?: unknown }; error: unknown };
function harness(options: {
  access?: () => Promise<Access>;
  sessions?: Session[];
  granted?: boolean;
  backendFailure?: string | null;
  backendThrows?: boolean;
} = {}) {
  const events: string[] = [];
  const states: { phase?: string; message?: string | null; pending?: string } = {};
  const grant = { current: options.granted === false ? null : url };
  const sessions = options.sessions ?? [{ user: { id: 'owner-a' }, access_token: 'a-token' }];
  let sessionIndex = 0;
  const noOp = () => undefined;
  const context: Record<string, unknown> = {
    t, shareAccessPresentation, URL, Set,
    console: { log: noOp, warn: noOp },
    isLikelyUrl: (value: string) => value.startsWith('https://'),
    Alert: { alert: () => events.push('alert') },
    aiPermissionGrantedUrlRef: grant,
    aiPermissionDecisionRef: { current: true },
    setPendingAiPermissionUrl: (value: string) => { states.pending = value; },
    supabase: {
      auth: { getSession: async () => {
        events.push('session');
        return { data: { session: sessions[Math.min(sessionIndex++, sessions.length - 1)] } };
      } },
      rpc: async (name: string) => {
        assert.equal(name, 'get_my_global_access'); events.push('access');
        return options.access ? options.access() : { data: { aiAllowed: true }, error: null };
      },
    },
    setFailMessage: (value: string | null) => { states.message = value; },
    setPhase: (value: string) => { states.phase = value; },
    params: {}, vayrinEnabled: false, Platform: { OS: 'ios' },
    prepareOnboardingV2RealPracticeShare: noOp,
    trackEvent: noOp, isProcessShareLinkConfigured: () => true,
    safeHostname: () => 'example.invalid', createInitialShareDebugState: () => ({}),
    setDebugState: noOp, pushShareDebug: noOp, pushShareDebugEvent: noOp,
    detectShareDebugSource: () => 'link', sanitizeShareDebugUrl: (value: string) => value,
    truncateShareDebugText: (value: unknown) => value,
    setUrl: noOp, setCandidates: noOp, setMultiSelectedIds: noOp,
    setAiExtraction: noOp, setSavedResult: noOp, setCorrectionOpen: noOp,
    setCorrectionSaved: noOp, setParsed: noOp, setExtraction: noOp,
    parseShare: async (value: string) => {
      events.push('parse'); assert.equal(value, url);
      return { url, source: 'link', title: 'Synthetic source', description: null, suggestedQuery: 'Synthetic place', metadataFailed: false };
    },
    detectShareDebugHandles: () => [],
    extractPlaceQueryFromShareMetadata: () => ({ query: 'Synthetic place', confidence: 'high' }),
    extractAccountIdentityFromShareMetadata: () => null,
    logDebug: noOp,
    extractShareOnServer: async (_value: string, callbacks: { onOutcome: (value: unknown) => void }) => {
      events.push('backend');
      callbacks.onOutcome({ extraction: null, didCallEdgeFunction: true, failureDetail: options.backendFailure ?? null });
      if (options.backendThrows) throw new Error('synthetic backend unavailable');
      return null;
    },
    // These sentinels catch both deliberate fallbacks and unexpected runtime
    // errors routed into the original flow's catch block.
    enterManualFallback: () => events.push('manual-fallback'),
    extractPlaceAI: async () => { events.push('client-ai'); return null; },
    runSearchAndMaybeSave: async () => { events.push('places-search'); },
    saveCandidate: async () => { events.push('save'); },
    isInvalidRegexError: () => false,
    FAIL_GENERIC: 'synthetic failure',
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { timeout: 1000 });
  const run = () => (context.runSaveFlow as (value: string) => Promise<void>)(url);
  return { run, events, states, grant };
}
function noDispatch(events: string[]) {
  assert.equal(events.some(event => ['parse', 'backend', 'client-ai', 'places-search', 'save', 'manual-fallback'].includes(event)), false);
}
async function main() {
  const noLocalGrant = harness({ granted: false });
  await noLocalGrant.run();
  assert.equal(noLocalGrant.states.pending, url);
  assert.deepEqual(noLocalGrant.events, []);

  for (const access of [
    { data: { aiAllowed: false }, error: null },
    { data: {}, error: null },
    { data: { aiAllowed: 'true' }, error: null },
    { data: { aiAllowed: true }, error: { message: 'synthetic denied read' } },
  ]) {
    const restricted = harness({ access: async () => access });
    await restricted.run();
    noDispatch(restricted.events);
    assert.equal(restricted.states.phase, 'failed');
    assert.equal(restricted.grant.current, null, 'cached prompt approval is cleared');
  }
  const switched = harness({ sessions: [
    { user: { id: 'owner-a' }, access_token: 'a' },
    { user: { id: 'owner-b' }, access_token: 'b' },
  ] });
  await switched.run(); noDispatch(switched.events);
  const signedOut = harness({ sessions: [null] });
  await signedOut.run(); noDispatch(signedOut.events);

  let resolveAccess!: (value: Access) => void;
  const waiting = harness({ access: () => new Promise(resolve => { resolveAccess = resolve; }) });
  const work = waiting.run();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(waiting.events, ['session', 'access']);
  noDispatch(waiting.events);
  resolveAccess({ data: { aiAllowed: true }, error: null });
  await work;
  assert.deepEqual(waiting.events, ['session', 'access', 'session', 'parse', 'backend']);
  assert.equal(waiting.states.phase, 'failed');

  for (const reason of [null, 'ai_permission_required', 'age_eligibility_required', 'recognition_not_available', 'plus_allowance_exhausted']) {
    const unavailable = harness({ backendFailure: reason });
    await unavailable.run();
    assert.deepEqual(unavailable.events, ['session', 'access', 'session', 'parse', 'backend']);
    assert.equal(unavailable.states.phase, 'failed');
    assert.equal(unavailable.grant.current, null);
    if (reason) assert.equal(unavailable.states.message, shareAccessPresentation(reason)!.body);
  }
  const failedBackend = harness({ backendThrows: true });
  await failedBackend.run();
  assert.deepEqual(failedBackend.events, ['session', 'access', 'session', 'parse', 'backend']);
  assert.equal(failedBackend.states.phase, 'failed');
  console.log('PASS actual host recognition flow: fresh authorization before source parsing; identity and withdrawal deny; null/failed server never invokes client AI, Places, save or manual fallback. No live calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
