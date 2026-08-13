export type FinalizeErrorClass =
  | 'upstream_timeout'
  | 'upstream_503'
  | 'upstream_unavailable'
  | 'database_unavailable'
  | 'permanent_processing_error';

export type ProviderFailure = {
  providerError?: string;
  providerStatus?: string;
  providerRetryAfterSeconds?: number;
};

export type ProviderUnavailablePlan =
  | {
      action: 'requeue';
      delaySeconds: number;
      errorClass: FinalizeErrorClass;
      responseStatus: 202;
    }
  | {
      action: 'exhaust';
      errorClass: FinalizeErrorClass;
      responseStatus: 200;
    };

const MIN_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 900;

export function classifyProviderFailure(failures: ProviderFailure[]): FinalizeErrorClass {
  const statuses = failures
    .map((failure) => Number(failure.providerStatus))
    .filter(Number.isFinite);
  if (statuses.some((status) => status >= 500 && status <= 599)) return 'upstream_503';
  if (
    failures.length > 0 &&
    failures.every(
      (failure) => failure.providerError === 'http_error' && !failure.providerStatus,
    )
  ) {
    return 'upstream_timeout';
  }
  return 'upstream_unavailable';
}

export function classifyFinalizeException(error: unknown): FinalizeErrorClass {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/abort|timed?\s*out|timeout/i.test(message)) return 'upstream_timeout';
  if (
    /media_retry_schedule_failed|postgrest|database|connection|fetch failed|failed to fetch/i.test(
      message,
    )
  ) {
    return 'database_unavailable';
  }
  return 'permanent_processing_error';
}

export function planProviderUnavailable(args: {
  attempts: number;
  maxAttempts: number;
  failures: ProviderFailure[];
  random?: () => number;
}): ProviderUnavailablePlan {
  const attempts = Math.max(1, Math.floor(args.attempts || 1));
  const maxAttempts = Math.max(1, Math.floor(args.maxAttempts || 1));
  const numericStatuses = args.failures
    .map((failure) => Number(failure.providerStatus))
    .filter(Number.isFinite);
  const permanentHttpFailure =
    args.failures.length > 0 &&
    numericStatuses.length === args.failures.length &&
    numericStatuses.every(
      (status) => status >= 400 && status < 500 && ![408, 425, 429].includes(status),
    );
  const errorClass = permanentHttpFailure
    ? 'permanent_processing_error'
    : classifyProviderFailure(args.failures);
  if (permanentHttpFailure) return { action: 'exhaust', errorClass, responseStatus: 200 };
  if (attempts >= maxAttempts) return { action: 'exhaust', errorClass, responseStatus: 200 };

  const exponential = Math.min(
    MAX_BACKOFF_SECONDS,
    MIN_BACKOFF_SECONDS * 2 ** Math.max(attempts - 1, 0),
  );
  const requested = Math.max(
    0,
    ...args.failures.map((failure) => Number(failure.providerRetryAfterSeconds) || 0),
  );
  const base = Math.min(MAX_BACKOFF_SECONDS, Math.max(exponential, requested));
  const random = args.random ?? Math.random;
  const jitter = Math.floor(base * 0.2 * Math.max(0, Math.min(1, random())));
  return {
    action: 'requeue',
    delaySeconds: Math.min(MAX_BACKOFF_SECONDS, base + jitter),
    errorClass,
    responseStatus: 202,
  };
}

export function formatFinalizeReliabilityLog(fields: {
  invocationId: string;
  jobId: string;
  taskId: string;
  operation: string;
  attempt: number;
  claimState: string;
  elapsedMs: number;
  finalStatus: string;
  errorClass: string | null;
}): string {
  return JSON.stringify({ marker: 'phase2_reliability', ...fields });
}
