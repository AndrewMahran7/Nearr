/**
 * lib/deviceDiagnostics.ts
 *
 * Persists a small, SANITIZED crash/diagnostic record on-device so the next
 * TestFlight failure can be reported (via a "Copy diagnostic" action) WITHOUT
 * requiring macOS Console. NEVER stores tokens, full private URLs, captions, or
 * user content — messages/stacks are run through lib/sanitizeError first, and
 * only an error code, route, sanitized message/stack, app build, and timestamp
 * are kept.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { sanitizeErrorText, sanitizeStack } from './sanitizeError';
import { getBreadcrumbs, renderBreadcrumbs } from './breadcrumbs';
import { getDiagnosticContext } from './diagnosticContext';

/**
 * Read the OTA-update runtime classification (expo-updates). Every field is
 * defensively read — in Expo Go / dev clients these are null and the getters
 * can throw, so this must NEVER throw. Explains the "installed 1.1.38 vs update
 * runtime 1.1.42" class of confusion: `runtime` is the update-compatibility key
 * (from runtimeVersion.policy=appVersion), `embedded=true` means the JS shipped
 * inside the native binary is running (no OTA applied), and `updateId`/`channel`
 * identify which published update is live.
 */
export function getUpdateInfo(): {
  runtimeVersion: string | null;
  updateId: string | null;
  channel: string | null;
  embedded: boolean | null;
  emergencyLaunch: boolean | null;
} {
  try {
    return {
      runtimeVersion:
        typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion : null,
      updateId: typeof Updates.updateId === 'string' ? Updates.updateId : null,
      channel: typeof Updates.channel === 'string' ? Updates.channel : null,
      embedded:
        typeof Updates.isEmbeddedLaunch === 'boolean' ? Updates.isEmbeddedLaunch : null,
      emergencyLaunch:
        typeof Updates.isEmergencyLaunch === 'boolean' ? Updates.isEmergencyLaunch : null,
    };
  } catch {
    return {
      runtimeVersion: null,
      updateId: null,
      channel: null,
      embedded: null,
      emergencyLaunch: null,
    };
  }
}

const KEY = 'nearr:device-diagnostics:v1';
const MAX_RECORDS = 8;

export type DeviceDiagnostic = {
  errorCode: string;
  route: string | null;
  message: string; // sanitized
  stack: string | null; // sanitized + truncated
  appVersion: string | null;
  buildNumber: string | null;
  platform: string;
  osVersion: string | null;
  timestamp: string; // ISO
  jobId?: string | null; // current share-job id when safe to include
  httpStatus?: number | null; // response HTTP status when the failure was a request
  responseErrorCode?: string | null; // server-provided error code / reason
};

function appBuild(): { version: string | null; buildNumber: string | null } {
  const cfg = Constants.expoConfig;
  const version = cfg?.version ?? null;
  let buildNumber: string | null = null;
  if (Platform.OS === 'ios') {
    buildNumber = cfg?.ios?.buildNumber ?? null;
  } else if (Platform.OS === 'android') {
    const vc = cfg?.android?.versionCode;
    buildNumber = vc != null ? String(vc) : null;
  }
  return { version, buildNumber };
}

/** Record a sanitized diagnostic. Never throws. */
export async function recordDiagnostic(input: {
  errorCode: string;
  route?: string | null;
  error: unknown;
  componentStack?: string | null;
  jobId?: string | null;
  httpStatus?: number | null;
  responseErrorCode?: string | null;
}): Promise<void> {
  try {
    const { version, buildNumber } = appBuild();
    const stackSource = input.componentStack
      ? input.componentStack
      : input.error instanceof Error
      ? input.error.stack ?? null
      : null;
    const record: DeviceDiagnostic = {
      errorCode: String(input.errorCode).slice(0, 80),
      route: input.route ? sanitizeErrorText(input.route).slice(0, 120) : null,
      message: sanitizeErrorText(input.error).slice(0, 300),
      stack: stackSource ? sanitizeStack(stackSource, 1200) : null,
      appVersion: version,
      buildNumber,
      platform: Platform.OS,
      osVersion:
        Platform.Version != null ? String(Platform.Version).slice(0, 24) : null,
      timestamp: new Date().toISOString(),
      jobId: input.jobId ? String(input.jobId).slice(0, 64) : null,
      httpStatus: typeof input.httpStatus === 'number' ? input.httpStatus : null,
      responseErrorCode: input.responseErrorCode
        ? String(input.responseErrorCode).slice(0, 60)
        : null,
    };
    const existing = await getRecentDiagnostics();
    const next = [record, ...existing].slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never throw.
  }
}

/** Read the most-recent diagnostics (newest first). Never throws. */
export async function getRecentDiagnostics(): Promise<DeviceDiagnostic[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is DeviceDiagnostic => !!d && typeof d === 'object' && typeof d.timestamp === 'string',
    );
  } catch {
    return [];
  }
}

/** Clear all stored diagnostics. */
export async function clearDiagnostics(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Assemble a full, SANITIZED diagnostic block for the global error boundary's
 * "Copy diagnostic" action. Combines the caught error, current app context
 * (route, initial-URL classification, last notification id, current share-job
 * id, AppState, location-watcher state), the recent breadcrumb trail, and the
 * app version/build/runtime. Never includes tokens, signed URLs, or private
 * content. Pure/synchronous — safe to call while rendering the boundary.
 */
export function buildErrorDiagnostic(input: {
  error: unknown;
  componentStack?: string | null;
}): string {
  // One line summarising the running JS: visible version, embedded runtime,
  // live update id + channel, and whether the embedded (in-binary) JS is
  // running (no OTA applied).
  const updateInfoLine = (visibleVersion: string | null): string => {
    const u = getUpdateInfo();
    return [
      `update: visibleVersion=${visibleVersion ?? '?'}`,
      `runtime=${u.runtimeVersion ?? '?'}`,
      `updateId=${u.updateId ?? 'embedded'}`,
      `channel=${u.channel ?? '?'}`,
      `embedded=${u.embedded == null ? '?' : u.embedded}`,
      u.emergencyLaunch ? 'emergencyLaunch=true' : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const { version, buildNumber } = appBuild();
  const runtimeVersion =
    (Constants.expoConfig as { runtimeVersion?: unknown } | null)?.runtimeVersion;
  const ctx = getDiagnosticContext();
  const errName =
    input.error instanceof Error ? input.error.name : typeof input.error;
  const stackSource =
    input.componentStack ??
    (input.error instanceof Error ? input.error.stack ?? null : null);

  const lines: string[] = [
    'Nearr crash diagnostic',
    `time=${new Date().toISOString()}`,
    `errorName=${errName}`,
    `message=${sanitizeErrorText(input.error).slice(0, 300)}`,
    `route=${ctx.route ?? 'unknown'}`,
    `initialUrl=${ctx.initialUrlClassification}`,
    `lastNotificationId=${ctx.lastNotificationId ?? 'none'}`,
    `shareJobId=${ctx.currentShareJobId ?? 'none'}`,
    `appState=${ctx.appState}`,
    `locationWatcher=${ctx.locationWatcherState}`,
    `app=${version ?? '?'} build=${buildNumber ?? '?'} runtime=${
      typeof runtimeVersion === 'string' ? runtimeVersion : '?'
    } ${Platform.OS} ${Platform.Version ?? ''}`.trim(),
    updateInfoLine(version),
    '--- breadcrumbs (oldest→newest) ---',
    renderBreadcrumbs(),
    '--- stack ---',
    stackSource ? sanitizeStack(stackSource, 1600) : '(no stack)',
  ];
  // Reference getBreadcrumbs so the trail is captured even if renderBreadcrumbs
  // is later changed; keeps the two in sync during refactors.
  void getBreadcrumbs;
  return lines.join('\n');
}

/** One-block, copy/paste-friendly rendering of a diagnostic (no secrets). */
export function formatDiagnosticForCopy(d: DeviceDiagnostic): string {
  return [
    'Nearr diagnostic',
    `time=${d.timestamp}`,
    `code=${d.errorCode}`,
    `route=${d.route ?? 'unknown'}`,
    `app=${d.appVersion ?? '?'} build=${d.buildNumber ?? '?'} ${d.platform} ${d.osVersion ?? ''}`.trim(),
    d.jobId ? `jobId=${d.jobId}` : '',
    d.httpStatus != null ? `httpStatus=${d.httpStatus}` : '',
    d.responseErrorCode ? `responseErrorCode=${d.responseErrorCode}` : '',
    `msg=${d.message}`,
    d.stack ? `stack=${d.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
