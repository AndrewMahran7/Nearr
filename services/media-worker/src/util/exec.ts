// services/media-worker/src/util/exec.ts
//
// Spawn an external binary (ffmpeg / ffprobe / yt-dlp) with NO shell (argv
// array only → no shell injection), a hard timeout, and bounded output capture.

import { spawn } from 'node:child_process';

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ExecOptions = {
  timeoutMs: number;
  /** Max bytes to retain from stdout/stderr (prevents unbounded memory). */
  maxBuffer?: number;
  signal?: AbortSignal;
  cwd?: string;
};

export async function execBinary(
  bin: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  const maxBuffer = opts.maxBuffer ?? 4 * 1024 * 1024;
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    const onAbort = () => child.kill('SIGKILL');
    if (opts.signal) {
      if (opts.signal.aborted) child.kill('SIGKILL');
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxBuffer) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < maxBuffer) stderr += d.toString('utf8');
    });

    const cleanup = () => {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Whether a binary is invocable (used by /ready). */
export async function binaryAvailable(bin: string, versionArg = '-version'): Promise<boolean> {
  try {
    const r = await execBinary(bin, [versionArg], { timeoutMs: 5000, maxBuffer: 64 * 1024 });
    return r.code === 0 || (!!r.stdout && r.stdout.length > 0);
  } catch {
    return false;
  }
}
