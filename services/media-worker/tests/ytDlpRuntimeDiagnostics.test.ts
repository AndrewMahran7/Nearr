import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import {
  logStartupRuntimeDiagnostics,
  startServer,
  type ServerContext,
} from '../src/server/httpServer.js';
import type { TaskDeps } from '../src/pipeline/runMediaTask.js';
import {
  diagnoseYtDlpVersionResult,
  inspectYtDlpRuntime,
  parseYtDlpVersion,
} from '../src/util/runtimeDiagnostics.js';

const EXPECTED_YT_DLP_VERSION = '2026.08.19';
const EXPECTED_YT_DLP_SHA256 = '1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6';

function config(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig(),
    port: 0,
    workerSecret: 'worker-secret',
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role',
    finalizeUrl: 'https://example.supabase.co/functions/v1/process-share-jobs',
    mediaFinalizeSecret: 'finalize-secret',
    transcriptionProvider: 'openai',
    transcriptionApiKey: 'openai-key',
    analysisProvider: 'gemini',
    geminiApiKey: 'gemini-key',
    ffmpegPath: process.execPath,
    ffprobePath: process.execPath,
    ...over,
  };
}

function readyDeps(): TaskDeps {
  return {
    client: {
      from: () => ({
        select: () => ({ limit: async () => ({ error: null }) }),
      }),
    },
  } as unknown as TaskDeps;
}

test('Dockerfile pins the tested stable release and verifies its artifact', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const version = dockerfile.match(/^ARG YT_DLP_VERSION=(\S+)$/m)?.[1];
  const checksum = dockerfile.match(/^ARG YT_DLP_SHA256=([a-f0-9]{64})$/m)?.[1];

  assert.equal(version, EXPECTED_YT_DLP_VERSION);
  assert.equal(checksum, EXPECTED_YT_DLP_SHA256);
  assert.doesNotMatch(dockerfile, /^ARG YT_DLP_VERSION=(?:latest|nightly|master)$/mi);
  assert.doesNotMatch(dockerfile, /releases\/latest(?:\/|$)/i);
  assert.match(dockerfile, /releases\/download\/\$\{YT_DLP_VERSION\}\/yt-dlp/);
  assert.match(dockerfile, /sha256sum -c -/);
});

test('parseYtDlpVersion accepts only a bounded stable release identifier', () => {
  assert.equal(parseYtDlpVersion(` ${EXPECTED_YT_DLP_VERSION}\n`), EXPECTED_YT_DLP_VERSION);
  for (const output of [
    '',
    'latest',
    'nightly',
    'master',
    'v2026.07.04',
    '2026.7.4',
    '2026.07.04\nextra-output',
    'x'.repeat(1_000),
  ]) {
    assert.equal(parseYtDlpVersion(output), null, output);
  }
});

test('yt-dlp result diagnostics fail closed on missing and unparseable binaries', async () => {
  assert.deepEqual(
    diagnoseYtDlpVersionResult({ code: 0, stdout: EXPECTED_YT_DLP_VERSION, stderr: '', timedOut: false }),
    { status: 'ok', version: EXPECTED_YT_DLP_VERSION },
  );
  assert.deepEqual(
    diagnoseYtDlpVersionResult({ code: 0, stdout: 'unexpected output', stderr: '', timedOut: false }),
    { status: 'unparseable', version: null },
  );
  assert.deepEqual(
    diagnoseYtDlpVersionResult({ code: 1, stdout: EXPECTED_YT_DLP_VERSION, stderr: 'failed', timedOut: false }),
    { status: 'unavailable', version: null },
  );
  assert.deepEqual(
    await inspectYtDlpRuntime('missing-yt-dlp', async () => {
      throw new Error('ENOENT');
    }),
    { status: 'unavailable', version: null },
  );
});

test('startup structured diagnostics include the installed yt-dlp version', async () => {
  const events: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const ctx: ServerContext = {
    cfg: config(),
    deps: null,
    inspectYtDlp: async () => ({ status: 'ok', version: EXPECTED_YT_DLP_VERSION }),
  };

  await logStartupRuntimeDiagnostics(ctx, {
    info: (event, fields) => events.push({ level: 'info', event, fields: fields ?? {} }),
    warn: (event, fields) => events.push({ level: 'warn', event, fields: fields ?? {} }),
  });

  assert.deepEqual(events, [{
    level: 'info',
    event: 'runtime_diagnostics',
    fields: { ytDlpVersion: EXPECTED_YT_DLP_VERSION, ytDlpStatus: 'ok' },
  }]);
});

test('/ready exposes the bounded installed version and marks yt-dlp ready', async (t) => {
  const server = startServer({
    cfg: config(),
    deps: readyDeps(),
    inspectYtDlp: async () => ({ status: 'ok', version: EXPECTED_YT_DLP_VERSION }),
  });
  t.after(() => server.close());
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/ready`);
  const body = await response.json() as {
    status: string;
    checks: { ytdlp: boolean };
    runtime: { ytDlpVersion: string | null; ytDlpStatus: string };
  };

  assert.equal(body.checks.ytdlp, true);
  assert.deepEqual(body.runtime, { ytDlpVersion: EXPECTED_YT_DLP_VERSION, ytDlpStatus: 'ok' });
});

test('/ready safely reports an unparseable yt-dlp without exposing its output', async (t) => {
  const server = startServer({
    cfg: config(),
    deps: readyDeps(),
    inspectYtDlp: async () => ({ status: 'unparseable', version: null }),
  });
  t.after(() => server.close());
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/ready`);
  const body = await response.json() as {
    checks: { ytdlp: boolean };
    runtime: { ytDlpVersion: string | null; ytDlpStatus: string };
  };

  assert.equal(response.status, 503);
  assert.equal(body.checks.ytdlp, false);
  assert.deepEqual(body.runtime, { ytDlpVersion: null, ytDlpStatus: 'unparseable' });
  assert.doesNotMatch(JSON.stringify(body), /unexpected output/i);
});
