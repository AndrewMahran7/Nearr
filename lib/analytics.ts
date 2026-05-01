/**
 * Lightweight analytics helper for Nearr.
 *
 * One job: insert a row into `public.analytics_events` so we can answer
 * product/growth questions in the Supabase SQL Editor (see
 * `docs/ANALYTICS_QUERIES.md`).
 *
 * Hard rules:
 *   1. NEVER throw to the UI. Tracking failures must not break the app.
 *   2. NEVER block the user-visible action. `trackEvent` returns a Promise
 *      but callers should fire-and-forget with `void trackEvent(...)`.
 *   3. NEVER include PII or auth tokens in `properties`. Pass IDs (saved
 *      place id, google place id) and short codes only.
 *   4. Skipped entirely in Demo Mode and Map Preview Mode — those are
 *      offline UX modes and shouldn't pollute production analytics.
 *
 * The user id (if signed in) and a stable per-install anonymous id from
 * AsyncStorage are attached automatically along with the platform and
 * app version/build number from `expo-constants`.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';

const ANON_ID_KEY = 'nearr.analytics.anonymousId';

// Cached per-process so we hit AsyncStorage at most once per app launch.
let cachedAnonymousId: string | null = null;
let anonymousIdPromise: Promise<string> | null = null;

/**
 * RFC4122-ish v4 uuid generated without bringing in a new dep. Good enough
 * for an analytics anonymous id (collision space is irrelevant for this
 * use case). Uses `Math.random` deliberately — we don't need crypto here.
 */
function generateAnonymousId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getAnonymousId(): Promise<string> {
  if (cachedAnonymousId) return cachedAnonymousId;
  if (anonymousIdPromise) return anonymousIdPromise;
  anonymousIdPromise = (async () => {
    try {
      const existing = await AsyncStorage.getItem(ANON_ID_KEY);
      if (existing) {
        cachedAnonymousId = existing;
        return existing;
      }
      const fresh = generateAnonymousId();
      await AsyncStorage.setItem(ANON_ID_KEY, fresh);
      cachedAnonymousId = fresh;
      return fresh;
    } catch {
      // AsyncStorage failure: fall back to an ephemeral in-memory id so we
      // can still group events within this session.
      const fallback = generateAnonymousId();
      cachedAnonymousId = fallback;
      return fallback;
    }
  })();
  return anonymousIdPromise;
}

function getAppVersion(): string | null {
  // `expoConfig.version` is the JS-level version (app.json `version`).
  // For prebuilt apps this matches the native CFBundleShortVersionString.
  return (Constants.expoConfig?.version as string | undefined) ?? null;
}

function getBuildNumber(): string | null {
  // iOS: ios.buildNumber; Android: android.versionCode. Either may be
  // undefined in Expo Go / dev client.
  const ios = Constants.expoConfig?.ios?.buildNumber as string | undefined;
  const android = Constants.expoConfig?.android?.versionCode as
    | number
    | undefined;
  if (Platform.OS === 'ios' && ios) return String(ios);
  if (Platform.OS === 'android' && android != null) return String(android);
  return null;
}

export type AnalyticsProperties = Record<string, unknown>;

/**
 * Fire-and-forget analytics insert. Always resolves; never throws.
 *
 * Usage:
 *   void trackEvent('open_in_maps_tapped', { saved_place_id: id });
 */
export async function trackEvent(
  eventName: string,
  properties: AnalyticsProperties = {},
): Promise<void> {
  // Skip offline UX modes — they're not real product usage.
  if (isDemoMode() || isMapPreviewMode()) {
    if (__DEV__) {
      console.log('[analytics] skipped (demo/preview)', eventName, properties);
    }
    return;
  }

  try {
    const [{ data: userData }, anonymousId] = await Promise.all([
      supabase.auth.getUser().catch(() => ({ data: { user: null } })),
      getAnonymousId(),
    ]);

    const userId = userData?.user?.id ?? null;

    const row = {
      user_id: userId,
      anonymous_id: anonymousId,
      event_name: eventName,
      properties: properties ?? {},
      platform: Platform.OS,
      app_version: getAppVersion(),
      build_number: getBuildNumber(),
    };

    const { error } = await supabase.from('analytics_events').insert(row);
    if (error) {
      // Always log analytics errors so missing migrations surface in device logs.
      // This is intentionally non-fatal — analytics failures never affect the user.
      console.warn(
        '[analytics] insert failed (non-fatal)',
        eventName,
        error.message,
      );
      return;
    }
    if (__DEV__) {
      console.log('[analytics]', eventName, properties);
    }
  } catch (err) {
    // Absolutely never throw to the UI.
    if (__DEV__) {
      console.warn(
        '[analytics] threw (non-fatal)',
        eventName,
        (err as Error)?.message,
      );
    }
  }
}
