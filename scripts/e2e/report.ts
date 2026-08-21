/**
 * scripts/e2e/report.ts
 *
 * Stage-level reporting for the deployed E2E suite.
 *
 * WHY THIS EXISTS AT ALL: a deployed pipeline crosses five service boundaries.
 * "E2E FAILED" is worthless there — it costs an hour of log archaeology to find
 * out which hop dropped the work. Every stage is therefore named, timed, and
 * printed as it happens, and a failure carries the last observed state plus the
 * identifiers needed to search Supabase and Railway logs.
 *
 * Nothing in this module ever prints a secret. Values that must be compared
 * across services are compared as SHA-256 digests (see config.ts).
 */

export type StageStatus = 'PASS' | 'FAIL' | 'SKIP' | 'WARN';

export type StageResult = {
  name: string;
  status: StageStatus;
  elapsedMs: number;
  /** One-line explanation. Required for FAIL/SKIP/WARN. */
  detail?: string;
  /** Last observed state of whatever was being polled, for diagnosis. */
  lastObserved?: Record<string, unknown>;
};

export type RunIdentifiers = {
  correlationId: string;
  userId?: string | null;
  jobId?: string | null;
  taskId?: string | null;
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export class StageReporter {
  readonly title: string;
  readonly correlationId: string;
  private readonly stages: StageResult[] = [];
  private readonly startedAt = Date.now();
  private ids: RunIdentifiers;

  constructor(title: string, correlationId: string) {
    this.title = title;
    this.correlationId = correlationId;
    this.ids = { correlationId };
  }

  /** Attach identifiers as they become known so failures can always name them. */
  identify(patch: Partial<RunIdentifiers>): void {
    this.ids = { ...this.ids, ...patch };
  }

  get identifiers(): RunIdentifiers {
    return { ...this.ids };
  }

  record(result: StageResult): StageResult {
    this.stages.push(result);
    const pad = result.status.padEnd(4);
    const timing = result.elapsedMs >= 0 ? ` (${fmtMs(result.elapsedMs)})` : '';
    console.log(`${pad} ${result.name}${timing}${result.detail ? ` — ${result.detail}` : ''}`);
    if (result.status === 'FAIL' && result.lastObserved) {
      for (const [key, value] of Object.entries(result.lastObserved)) {
        console.log(`       ${key}: ${formatObserved(value)}`);
      }
    }
    return result;
  }

  pass(name: string, elapsedMs: number, detail?: string): StageResult {
    return this.record({ name, status: 'PASS', elapsedMs, detail });
  }

  fail(
    name: string,
    elapsedMs: number,
    detail: string,
    lastObserved?: Record<string, unknown>,
  ): StageResult {
    return this.record({
      name,
      status: 'FAIL',
      elapsedMs,
      detail,
      lastObserved: { ...lastObserved, ...compactIds(this.ids) },
    });
  }

  skip(name: string, detail: string): StageResult {
    return this.record({ name, status: 'SKIP', elapsedMs: -1, detail });
  }

  warn(name: string, detail: string): StageResult {
    return this.record({ name, status: 'WARN', elapsedMs: -1, detail });
  }

  /** Run a stage, timing it and converting a throw into a FAIL. */
  async stage<T>(
    name: string,
    fn: () => Promise<{ ok: true; detail?: string; value: T } | { ok: false; detail: string; lastObserved?: Record<string, unknown> }>,
  ): Promise<T | null> {
    const startedAt = Date.now();
    try {
      const outcome = await fn();
      if (outcome.ok) {
        this.pass(name, Date.now() - startedAt, outcome.detail);
        return outcome.value;
      }
      this.fail(name, Date.now() - startedAt, outcome.detail, outcome.lastObserved);
      return null;
    } catch (err) {
      this.fail(name, Date.now() - startedAt, `threw: ${errText(err)}`);
      return null;
    }
  }

  get failures(): StageResult[] {
    return this.stages.filter((s) => s.status === 'FAIL');
  }

  get results(): StageResult[] {
    return [...this.stages];
  }

  get ok(): boolean {
    return this.failures.length === 0;
  }

  /** Print the closing block. Returns the process exit code. */
  summarize(): number {
    const counts = { PASS: 0, FAIL: 0, SKIP: 0, WARN: 0 };
    for (const stage of this.stages) counts[stage.status] += 1;
    console.log('');
    console.log(
      `${this.title}: ${counts.PASS} passed, ${counts.FAIL} failed, ` +
        `${counts.SKIP} skipped, ${counts.WARN} warned in ${fmtMs(Date.now() - this.startedAt)}`,
    );
    console.log(`correlation: ${this.correlationId}`);
    const ids = compactIds(this.ids);
    for (const [key, value] of Object.entries(ids)) {
      if (key !== 'correlationId') console.log(`${key}: ${String(value)}`);
    }
    if (counts.FAIL > 0) {
      console.log('');
      console.log('Failed stages:');
      for (const stage of this.failures) console.log(`  - ${stage.name}: ${stage.detail ?? ''}`);
      console.log('');
      console.log('Search the deployed logs with the identifiers above:');
      console.log(
        `  supabase functions logs process-share-jobs --project-ref <dev-ref> | grep ${
          this.ids.jobId ?? this.correlationId
        }`,
      );
      console.log(`  npm run dev:worker:logs | grep ${this.ids.taskId ?? this.correlationId}`);
    }
    return counts.FAIL > 0 ? 1 : 0;
  }
}

function compactIds(ids: RunIdentifiers): Record<string, unknown> {
  const out: Record<string, unknown> = { correlationId: ids.correlationId };
  if (ids.userId) out.userId = ids.userId;
  if (ids.jobId) out.jobId = ids.jobId;
  if (ids.taskId) out.taskId = ids.taskId;
  return out;
}

function formatObserved(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
