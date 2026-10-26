/** Bounded live DENIAL proof, not a recognition-quality benchmark.
 * Creates only synthetic users in the fixed Development project, never opens
 * qualification gates, never invokes a model, and deletes its own users.
 * Credentials stay in memory; reports contain no email, password, token or URL.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolveCli } = require('./lib/cliRunner');

const project = '4037a3b5-d66f-409e-b734-56c22c244e3e';
const environment = '57d055b7-5326-4f96-a7a9-70523ee0d3f0';
const service = '3c8cd190-b118-4ee4-9338-407843ef4e1f';
const base = 'https://qnfxnmvxpjzfydgudtvs.supabase.co';
const worker = 'https://media-worker-development.up.railway.app';
const output = 'artifacts/global-release/recognition-qualification';
const runId = randomUUID();
const created = [];
const report = { runId, startedAt: new Date().toISOString(), kind: 'live-disabled-route-denial-only', tests: [], cleanup: [], externalInferenceRequestsIssuedByHarness: 0 };
mkdirSync(output, { recursive: true });
mkdirSync('.tmp', { recursive: true });
const cli = resolveCli('railway');
assert.ok(cli);
const result = spawnSync(cli.file, [...cli.prefixArgs, 'variables', '--project', project, '--environment', environment, '--service', service, '--json'], {
  encoding: 'utf8', timeout: 30_000, windowsHide: true,
  env: { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5', RAILWAY_AGENT_SESSION: 'nearr-provider-20261026' },
});
assert.equal(result.status, 0, 'Unable to read scoped Railway credentials');
const vars = JSON.parse(result.stdout);
assert.equal(vars.SUPABASE_URL, base);
assert.equal(vars.MEDIA_OPENAI_RECOGNITION_ENABLED, 'false');
assert.equal(vars.NEARR_ALLOWED_PROVIDER_ROUTE, 'disabled');
const key = vars.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key);
const deployment = spawnSync(cli.file, [...cli.prefixArgs, 'deployment', 'list', '--project', project, '--environment', environment, '--service', service, '--limit', '1', '--json'], {
  encoding: 'utf8', timeout: 30_000, windowsHide: true,
  env: { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5', RAILWAY_AGENT_SESSION: 'nearr-provider-20261026' },
});
assert.equal(deployment.status, 0, 'Unable to verify worker deployment');
const active = JSON.parse(deployment.stdout)[0];
assert.equal(active.id, '70fc5c6f-1b8b-4e5c-915e-7c30ccbab360', 'Review a newer deployment before rerunning this release-specific proof');
assert.equal(active.status, 'SUCCESS');
report.workerDeployment = active.id;
async function request(route, body, token = key, method = body === undefined ? 'GET' : 'POST', headers = {}) {
  const res = await fetch(base + route, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, data };
}
async function rpc(name, body, token) { return request('/rest/v1/rpc/' + name, body, token); }
async function ownCount(table, id) {
  const r = await request(`/rest/v1/${table}?select=id&user_id=eq.${id}`);
  assert.equal(r.status, 200, `Cannot count ${table}`);
  return r.data.length;
}
async function main() {
  const policy = await request('/rest/v1/global_release_policy?select=*');
  assert.equal(policy.status, 200);
  assert.equal(policy.data.length, 1);
  assert.equal(policy.data[0].legal_approved, false);
  assert.equal(policy.data[0].recognition_qualified, false);
  assert.equal(policy.data[0].provider_route, 'disabled');
  report.policyBefore = policy.data[0];
  const corpus = JSON.parse(readFileSync('scripts/mediaRegressionCorpus.json', 'utf8'));
  const source = corpus.entries.find(entry => entry.platform === 'instagram' && /^https:\/\//.test(entry.url));
  assert.ok(source, 'Retained valid social URL required');
  report.sourceCase = source.id;
  for (const scenario of ['adult', 'minor13', 'under13', 'withdrawn', 'legacy14']) {
    const email = `nearr-qa-${runId}-${scenario}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const user = await request('/auth/v1/admin/users', { email, password, email_confirm: true, app_metadata: { qualification_run: runId } });
    assert.equal(user.status, 200, 'Synthetic user creation failed');
    const id = user.data.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    created.push(id);
    writeFileSync('.tmp/disabled-recognition-cleanup.json', JSON.stringify({ runId, userIds: created }));
    const login = await request('/auth/v1/token?grant_type=password', { email, password });
    assert.equal(login.status, 200, 'Synthetic sign-in failed');
    const token = login.data.access_token;
    assert.ok(token);
    let declaration;
    if (scenario === 'legacy14') {
      declaration = await rpc('declare_age_eligibility_18_plus', { p_at_least_18: true }, token);
    } else {
      declaration = await rpc('declare_global_eligibility', { p_age_band: scenario === 'minor13' ? '13' : scenario === 'under13' ? 'under_13' : '18_plus', p_country_code: 'US' }, token);
    }
    assert.equal(declaration.status, 200, `Declaration failed for ${scenario}`);
    if (scenario === 'withdrawn') {
      const withdrawal = await rpc('set_ai_sharing_permission', { p_allowed: false, p_notice_version: 'nearr-ai-openai-v1' }, token);
      assert.ok(withdrawal.status === 200 || withdrawal.status === 204, 'Withdrawal RPC must succeed');
    }
    const reason = await rpc('account_ai_access_reason', { p_user_id: id });
    assert.equal(reason.status, 200);
    assert.notEqual(reason.data, 'allowed');
    const start = Date.now();
    const submission = await request('/functions/v1/create-share-job', { url: source.url, submissionPath: 'host_app', clientRequestId: randomUUID() }, token, 'POST', { 'x-nearr-contract': 'global-v1' });
    assert.equal(submission.status, 403, `Submission not denied for ${scenario}`);
    assert.equal(submission.data.error, 'age_eligibility_required');
    const legacy = await request('/functions/v1/process-share-link', { url: source.url, accessToken: token, mode: 'save' }, token, 'POST', { 'x-nearr-app-version': '1.4' });
    assert.equal(legacy.status, 426, `Legacy submission not denied for ${scenario}`);
    assert.equal(legacy.data.reason, 'update_required');
    const modernDirect = await request('/functions/v1/process-share-link', { url: source.url, accessToken: token, mode: 'save' }, token, 'POST', { 'x-nearr-contract': 'global-v1' });
    assert.equal(modernDirect.status, 403);
    assert.equal(modernDirect.data.reason, 'age_eligibility_required');
    assert.equal(await ownCount('share_jobs', id), 0);
    assert.equal(await ownCount('share_media_tasks', id), 0);
    report.tests.push({ scenario, declaration: declaration.data, reason: reason.data, createShareJob: submission, legacyProcessShareLink: legacy, modernProcessShareLink: modernDirect, jobCount: 0, mediaTaskCount: 0, denialRequestGroupLatencyMs: Date.now() - start });
  }
  const wake = await fetch(worker + '/v1/process-media-tasks', { method: 'POST', headers: { Authorization: `Bearer ${vars.SHARE_MEDIA_WORKER_SECRET}` }, signal: AbortSignal.timeout(20_000) });
  const wakeBody = await wake.json();
  assert.equal(wake.status, 503);
  assert.equal(wakeBody.error, 'not_ready');
  report.workerAuthenticatedWake = { status: wake.status, body: wakeBody };
  const after = await request('/rest/v1/global_release_policy?select=*');
  assert.deepEqual(after, policy);
  report.policyUnchanged = true;
}
(async () => {
  try { await main(); report.passed = true; }
  catch (error) { report.passed = false; report.error = error instanceof assert.AssertionError ? error.message : 'Transport/operation failed; inspect without exposing credentials'; process.exitCode = 1; }
  finally {
    for (const id of created) {
      try {
        const owned = await request('/auth/v1/admin/users/' + id);
        assert.equal(owned.data.app_metadata.qualification_run, runId, 'Refuse unrelated cleanup');
        const deletion = await request('/auth/v1/admin/users/' + id, undefined, key, 'DELETE');
        assert.equal(deletion.status, 200);
        const absent = await request('/auth/v1/admin/users/' + id);
        assert.equal(absent.status, 404);
        assert.equal(await ownCount('share_jobs', id), 0);
        assert.equal(await ownCount('share_media_tasks', id), 0);
        report.cleanup.push({ userId: id, deleted: true, authReadback: 404, jobs: 0, mediaTasks: 0 });
      } catch { report.cleanup.push({ userId: id, deleted: false }); process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    report.cleanupComplete = report.cleanup.length === created.length && report.cleanup.every(item => item.deleted);
    if (!report.cleanupComplete) report.passed = false;
    writeFileSync(output + '/disabled-route-live-proof-' + runId + '.json', JSON.stringify(report, null, 2) + '\n');
    writeFileSync(output + '/disabled-route-live-proof.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
})();
