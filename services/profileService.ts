/**
 * Profile service for Nearr.
 *
 * Profiles are auto-created by the `handle_new_user` trigger when a user
 * signs up. We just read/update them here.
 */

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { getDemoProfile, updateDemoProfile } from '@/services/demo';
import type { Profile, RadiusUnit } from '@/types';

/** Fetch the current user's profile. Returns null if signed-out or not yet created. */
export async function getProfile(): Promise<Profile | null> {
  if (isDemoMode()) return await getDemoProfile();
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    console.warn('[profileService] getUser failed', userErr.message);
    return null;
  }
  const userId = userRes.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[profileService] fetch failed', error.message);
    return null;
  }
  return (data as Profile) ?? null;
}

export type ProfilePatch = {
  default_radius_value?: number;
  default_radius_unit?: RadiusUnit;
  notifications_enabled?: boolean;
  nearby_notifications_enabled?: boolean;
  quiet_hours_enabled?: boolean;
  /** "HH:MM" or "HH:MM:SS" — Postgres `time` accepts both. */
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
};

/** Patch the current user's profile row. Throws on auth or DB errors. */
export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  if (isDemoMode()) return await updateDemoProfile(patch);
  console.log('[profileService] update', patch);
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(`Not signed in: ${userErr.message}`);
  const userId = userRes.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.warn('[profileService] update failed', error.message);
    throw new Error(error.message);
  }
  return data as Profile;
}
