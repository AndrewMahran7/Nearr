import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegressionAttempt } from './types.js';
import { BenchmarkLifecycle } from './firewall.js';

export async function persistAttempt(filePath: string, attempt: RegressionAttempt, lifecycle?: BenchmarkLifecycle): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(attempt)}\n`, 'utf8');
  const handle = await open(filePath, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  lifecycle?.resultsPersisted();
}

export async function readAttempts(filePath: string): Promise<RegressionAttempt[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RegressionAttempt);
}

export function assertNoCasesDisappear(expectedCaseIds: string[], attempts: RegressionAttempt[]): void {
  const present = new Set(attempts.map((attempt) => attempt.caseId));
  const missing = expectedCaseIds.filter((caseId) => !present.has(caseId));
  if (missing.length) throw new Error(`cases_missing_from_results:${missing.join(',')}`);
}
