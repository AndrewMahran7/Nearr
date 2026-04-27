/**
 * Demo profile service. AsyncStorage-backed; survives reload so radius /
 * notification preference edits stick during a UX test session.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_PROFILE } from '@/lib/demoData';
import type { Profile } from '@/types';
import type { ProfilePatch } from '@/services/profileService';

const STORAGE_KEY = 'nearr.demo.profile';

let cache: Profile | null = null;

async function load(): Promise<Profile> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as Profile;
      return cache;
    }
  } catch (e) {
    console.warn('[demo:profile] load failed', e);
  }
  cache = { ...DEMO_PROFILE };
  await persist();
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('[demo:profile] persist failed', e);
  }
}

export async function getDemoProfile(): Promise<Profile | null> {
  return await load();
}

export async function updateDemoProfile(patch: ProfilePatch): Promise<Profile> {
  const current = await load();
  const next: Profile = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  cache = next;
  await persist();
  console.log('[demo:profile] updated', patch);
  return next;
}

export async function resetDemoProfile(): Promise<void> {
  cache = { ...DEMO_PROFILE };
  await persist();
  console.log('[demo:profile] reset');
}
