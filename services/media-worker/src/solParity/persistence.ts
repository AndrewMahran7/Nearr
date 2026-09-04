import { appendFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PersistedModelAttempt } from './types.js';

export type PersistenceEvent = { kind: 'response_persisted' | 'ground_truth_loaded'; at: number; id?: string };

/** Append one complete model attempt and fsync it before returning. */
export async function persistModelAttempt(filePath: string, attempt: PersistedModelAttempt, events?: PersistenceEvent[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const line = `${JSON.stringify(attempt)}\n`;
  await appendFile(filePath, line, 'utf8');
  // Windows requires a writable handle for fsync; r+ does not truncate.
  const handle = await open(filePath, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  events?.push({ kind: 'response_persisted', at: Date.now(), id: attempt.attempt_id });
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

/** This is the only benchmark-label loader. Inference modules never import it. */
export async function loadGroundTruthAfterPersistence(filePath: string, events?: PersistenceEvent[]): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  events?.push({ kind: 'ground_truth_loaded', at: Date.now() });
  return JSON.parse(raw) as unknown;
}

export async function readPersistedAttempts(filePath: string): Promise<PersistedModelAttempt[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as PersistedModelAttempt);
}
