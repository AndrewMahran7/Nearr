const workerPath = new URL(
  '../supabase/functions/process-share-jobs/index.ts',
  import.meta.url,
);
const testPort = 45_123;

const child = new Deno.Command(Deno.execPath(), {
  args: [
    'run',
    '--no-config',
    '--sloppy-imports',
    '--allow-env',
    '--allow-net',
    workerPath.pathname,
  ],
  env: { NEARR_EDGE_TEST_PORT: String(testPort) },
  stdout: 'null',
  stderr: 'piped',
}).spawn();

const stderrPromise = new Response(child.stderr).text();

try {
  const deadline = Date.now() + 15_000;
  let response = null;

  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${testPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (!response) {
    throw new Error(`worker did not boot:\n${await stderrPromise}`);
  }

  const body = await response.json();
  if (response.status !== 401 || body?.error !== 'unauthorized') {
    throw new Error(
      `worker boot probe expected 401 unauthorized, received ${response.status} ${JSON.stringify(body)}`,
    );
  }

  console.log('PASS process-share-jobs boots and reaches its auth guard');
} finally {
  child.kill('SIGTERM');
  await child.status;
}
