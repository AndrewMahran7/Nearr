/**
 * Feedback service for Nearr.
 *
 * Submits in-app, founder-led feedback into `public.feedback` (see
 * supabase/migrations/20260706000001_feedback.sql). Append-only from the
 * client — RLS lets an authenticated user insert feedback attributed to
 * themselves; nothing here reads feedback back.
 *
 * Hard rules:
 *   - NEVER throw to the UI. A failed insert returns a friendly error.
 *   - NEVER store secrets/tokens in `metadata`.
 *   - Requires auth (Settings entry point). Demo Mode is a no-op success so
 *     the UI still works offline/without a real session.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';

export type FeedbackCategory =
  | 'bug'
  | 'confusing'
  | 'save_extraction'
  | 'feature_idea'
  | 'other';

export type SubmitFeedbackInput = {
  category: FeedbackCategory;
  message: string;
  /** Optional contact email; falls back to the account email. */
  email?: string | null;
  /** Route/screen the user came from, for triage context. */
  route?: string | null;
};

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

function getAppVersion(): string | null {
  return (Constants.expoConfig?.version as string | undefined) ?? null;
}

function getBuildNumber(): string | null {
  const ios = Constants.expoConfig?.ios?.buildNumber as string | undefined;
  const android = Constants.expoConfig?.android?.versionCode as
    | number
    | undefined;
  if (Platform.OS === 'ios' && ios) return String(ios);
  if (Platform.OS === 'android' && android != null) return String(android);
  return null;
}

/** Diagnostic context attached to every submission. No PII beyond email. */
function buildMetadata(args: {
  route?: string | null;
  signedIn: boolean;
}): Record<string, unknown> {
  return {
    app_version: getAppVersion(),
    build_number: getBuildNumber(),
    platform: Platform.OS,
    os_version: String(Platform.Version),
    device_name: (Constants.deviceName as string | undefined) ?? null,
    route: args.route ?? null,
    signed_in: args.signedIn,
    client_created_at: new Date().toISOString(),
  };
}

/**
 * Submit feedback. Validates a non-empty message, attaches diagnostic
 * metadata, and inserts one row. Always resolves — never throws.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: 'Please enter a message.' };

  // Demo Mode has no real Supabase session — pretend success so the flow is
  // still walkable, but don't attempt a doomed RLS insert.
  if (isDemoMode()) return { ok: true };

  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user ?? null;

    if (!user) {
      // Settings feedback requires auth; RLS would reject an anonymous row.
      return { ok: false, error: 'Please sign in to send feedback.' };
    }

    const email = (input.email?.trim() || user.email) ?? null;

    const row = {
      user_id: user.id,
      email,
      category: input.category,
      message,
      metadata: buildMetadata({ route: input.route, signedIn: true }),
    };

    const { error } = await supabase.from('feedback').insert(row);
    if (error) {
      console.warn('[feedback] insert failed', error.message);
      return {
        ok: false,
        error: 'Could not send feedback. Please try again.',
      };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[feedback] submit threw', e?.message);
    return { ok: false, error: 'Could not send feedback. Please try again.' };
  }
}
