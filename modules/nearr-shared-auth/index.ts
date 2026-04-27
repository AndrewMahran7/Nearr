/**
 * nearr-shared-auth — JS surface of the local Expo Module that bridges
 * the App Group UserDefaults between the Nearr app and its iOS Share
 * Extension.
 *
 * Native methods (iOS only):
 *   - getToken(): string | null
 *   - setToken(token: string | null): boolean
 *   - clearToken(): boolean
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
  getAppGroup: () => string | null;
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

export function getAppGroup(): string | null {
  try {
    return Native?.getAppGroup() ?? null;
  } catch {
    return null;
  }
}

export default {
  isAvailable,
  getToken,
  setToken,
  clearToken,
  getAppGroup,
};
