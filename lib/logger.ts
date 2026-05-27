const DEBUG_LOGS_ENABLED =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_DEBUG_LOGS === 'true';

function formatMessage(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

export function isDebugLoggingEnabled(): boolean {
  return DEBUG_LOGS_ENABLED;
}

export function logDebug(scope: string, message: string, data?: unknown): void {
  if (!DEBUG_LOGS_ENABLED) return;
  if (data === undefined) {
    console.log(formatMessage(scope, message));
    return;
  }
  console.log(formatMessage(scope, message), data);
}

export function logInfo(scope: string, message: string, data?: unknown): void {
  if (data === undefined) {
    console.log(formatMessage(scope, message));
    return;
  }
  console.log(formatMessage(scope, message), data);
}

export function logWarn(scope: string, message: string, data?: unknown): void {
  if (data === undefined) {
    console.warn(formatMessage(scope, message));
    return;
  }
  console.warn(formatMessage(scope, message), data);
}

export function logError(scope: string, message: string, data?: unknown): void {
  if (data === undefined) {
    console.error(formatMessage(scope, message));
    return;
  }
  console.error(formatMessage(scope, message), data);
}