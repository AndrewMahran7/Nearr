// Bounded, secret-free diagnostics for external tools used by the worker.

import { execBinary, type ExecResult } from './exec.js';

const YT_DLP_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}$/;

export type YtDlpRuntimeStatus = 'ok' | 'unavailable' | 'unparseable';

export type YtDlpRuntimeDiagnostic = {
  status: YtDlpRuntimeStatus;
  version: string | null;
};

export type YtDlpVersionRunner = (
  bin: string,
  args: string[],
  opts: { timeoutMs: number; maxBuffer: number },
) => Promise<ExecResult>;

/** Accept only stable yt-dlp release identifiers; never echo arbitrary output. */
export function parseYtDlpVersion(stdout: string): string | null {
  const candidate = stdout.trim();
  return YT_DLP_VERSION_RE.test(candidate) ? candidate : null;
}

export function diagnoseYtDlpVersionResult(result: ExecResult): YtDlpRuntimeDiagnostic {
  if (result.timedOut || result.code !== 0) {
    return { status: 'unavailable', version: null };
  }
  const version = parseYtDlpVersion(result.stdout);
  return version
    ? { status: 'ok', version }
    : { status: 'unparseable', version: null };
}

/** Probe output is capped at 256 bytes and reduced to a date or null. */
export async function inspectYtDlpRuntime(
  ytDlpPath: string,
  run: YtDlpVersionRunner = execBinary,
): Promise<YtDlpRuntimeDiagnostic> {
  try {
    const result = await run(ytDlpPath, ['--version'], { timeoutMs: 5000, maxBuffer: 256 });
    return diagnoseYtDlpVersionResult(result);
  } catch {
    return { status: 'unavailable', version: null };
  }
}

export function ytDlpRuntimeFields(diagnostic: YtDlpRuntimeDiagnostic): {
  ytDlpVersion: string | null;
  ytDlpStatus: YtDlpRuntimeStatus;
} {
  return {
    ytDlpVersion: diagnostic.version,
    ytDlpStatus: diagnostic.status,
  };
}
