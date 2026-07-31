/**
 * lib/pushTokens.ts
 *
 * Expo push-token registration for server-sent job-result notifications.
 *
 * This is DISTINCT from lib/notifications.ts (local place reminders). It only
 * runs when the async share-jobs feature flag is on, only when notification
 * permission is already granted (it never prompts here), and never logs the
 * token value.
 *
 * The token is persisted via the `register_push_token` SECURITY DEFINER RPC
 * (last-writer-wins) so a device that switched accounts reassigns cleanly.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';
import { isAsyncShareJobsEnabled } from '@/lib/featureFlags';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { logDebug, logInfo } from '@/lib/logger';

const DEVICE_ID_KEY = 'nearr:push:deviceId:v1';

let cachedDeviceId: string | null = null;
// Guard so we don't spam the RPC when several effects fire at once.
let lastRegisteredToken: string | null = null;
let inFlight = false;

function generateDeviceId(): string {
  return 'dev-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const fresh = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    cachedDeviceId = fresh;
    return fresh;
  } catch {
    const fallback = generateDeviceId();
    cachedDeviceId = fallback;
    return fallback;
  }
}

function resolveProjectId(): string | null {
  const fromEas =
    (Constants?.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId ?? null;
  const fromEasConfig =
    (Constants as unknown as { easConfig?: { projectId?: string } })?.easConfig?.projectId ?? null;
  return fromEas || fromEasConfig || null;
}

/**
 * Register (or refresh) this device's Expo push token for the current user.
 *
 * Best-effort and idempotent: safe to call on login, on app foreground, and
 * after the user grants notification permission. Silently no-ops when:
 *   - the async share-jobs flag is off
 *   - demo / map-preview mode
 *   - notification permission is not granted
 *   - no EAS projectId is configured
 *   - running on a simulator (getExpoPushTokenAsync throws → caught)
 */
export async function registerPushTokenForCurrentUser(): Promise<
  'registered' | 'skipped' | 'unchanged' | 'error'
> {
  if (!isAsyncShareJobsEnabled()) return 'skipped';
  if (isDemoMode() || isMapPreviewMode()) return 'skipped';
  if (inFlight) return 'skipped';

  const projectId = resolveProjectId();
  if (!projectId) {
    logDebug('push-token', 'no_project_id — skipping registration');
    return 'skipped';
  }

  inFlight = true;
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') {
      return 'skipped';
    }

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) return 'skipped';

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (err) {
      // Simulator / no APNs entitlement / offline. Non-fatal.
      logDebug('push-token', `getExpoPushTokenAsync failed: ${(err as Error)?.message ?? 'unknown'}`);
      return 'error';
    }
    if (!token) return 'error';

    if (token === lastRegisteredToken) return 'unchanged';

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_device_id: await getDeviceId(),
    });
    if (error) {
      logDebug('push-token', `register rpc failed: ${error.message}`);
      return 'error';
    }
    lastRegisteredToken = token;
    // Log presence only — NEVER the token value.
    logInfo('push-token', 'registered=true platform=' + Platform.OS);
    return 'registered';
  } catch (err) {
    logDebug('push-token', `unexpected: ${(err as Error)?.message ?? 'unknown'}`);
    return 'error';
  } finally {
    inFlight = false;
  }
}

/** Deactivate this device's token locally on sign-out (best-effort). */
export async function deactivatePushTokenForCurrentUser(): Promise<void> {
  lastRegisteredToken = null;
  try {
    if (!isAsyncShareJobsEnabled()) return;
    const projectId = resolveProjectId();
    if (!projectId) return;
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!data) return;
    await supabase.from('user_push_tokens').update({ enabled: false }).eq('token', data);
  } catch {
    // best-effort
  }
}
