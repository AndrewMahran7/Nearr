/**
 * nearr-shared-auth — JS surface of the local Expo Module that bridges
 * the App Group UserDefaults between the Nearr app and its iOS Share
 * Extension.
 *
 * Native methods (iOS only):
 *   - getToken(): string | null
 *   - setToken(token: string | null): boolean
 *   - clearToken(): boolean
 *   - setInitialized(): boolean
 *   - isInitialized(): boolean
 *   - getAppGroup(): string | null
 *
 * On Android (or if the native module isn't linked yet because the user
 * hasn't run `expo prebuild --clean`), every method becomes a safe no-op
 * so callers can rely on returning sensible defaults.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeShape = {
  getToken: () => string | null;
  setToken: (token: string | null) => boolean;
  clearToken: () => boolean;
  setInitialized: () => boolean;
  isInitialized: () => boolean;
  getAppGroup: () => string | null;
  getStatus: () => SharedAuthNativeStatus;
  recordShareTrace: (invocationId: string, event: string, detail: string | null) => boolean;
  getShareTrace: () => ShareTraceEvent[];
};

export type ShareTraceEvent = {
  invocationId: string;
  event: string;
  timestamp: number;
  process: 'extension' | 'host' | string;
  detail?: string | null;
};

/** Non-secret diagnostic snapshot from the App Group container. */
export type SharedAuthNativeStatus = {
  appGroupAccessible: boolean;
  initialized: boolean;
  tokenPresent: boolean;
  tokenStructurallyValid: boolean;
  tokenExpiresAt: number | null;
  lastSyncAt: number | null;
  writerTarget: string | null;
  errorCode: string | null;
};

const Native = requireOptionalNativeModule<NativeShape>('NearrSharedAuth');

export function isAvailable(): boolean {
  return !!Native;
}

export function getToken(): string | null {
  try {
    return Native?.getToken() ?? null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null): boolean {
  try {
    return Native?.setToken(token ?? null) ?? false;
  } catch {
    return false;
  }
}

export function clearToken(): boolean {
  try {
    return Native?.clearToken() ?? false;
  } catch {
    return false;
  }
}

export function setInitialized(): boolean {
  try {
    return Native?.setInitialized() ?? false;
  } catch {
    return false;
  }
}

export function isInitialized(): boolean {
  try {
    return Native?.isInitialized() ?? false;
  } catch {
    return false;
  }
}

export function getAppGroup(): string | null {
  try {
    return Native?.getAppGroup() ?? null;
  } catch {
    return null;
  }
}

export function getStatus(): SharedAuthNativeStatus | null {
  try {
    return Native?.getStatus() ?? null;
  } catch {
    return null;
  }
}

export function recordShareTrace(
  invocationId: string,
  event: string,
  detail?: string | null,
): boolean {
  try {
    return Native?.recordShareTrace(invocationId, event, detail ?? null) ?? false;
  } catch {
    return false;
  }
}

export function getShareTrace(): ShareTraceEvent[] {
  try {
    const events = Native?.getShareTrace() ?? [];
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export default {
  isAvailable,
  getToken,
  setToken,
  clearToken,
  setInitialized,
  isInitialized,
  getAppGroup,
  getStatus,
  recordShareTrace,
  getShareTrace,
};
