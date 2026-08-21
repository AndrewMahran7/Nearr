import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Privacy-safe identity for one Onboarding V2 funnel. It is deliberately
 * independent from auth.users so drop-off events survive anonymous-user
 * cleanup without retaining an auth identifier.
 */
export const ONBOARDING_FUNNEL_ID_KEY = 'nearr:onboarding:v2:funnel-id';

let cachedFunnelId: string | null = null;

function createUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = (Math.random() * 16) | 0;
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function getActiveOnboardingFunnelId(): Promise<string | null> {
  if (cachedFunnelId) return cachedFunnelId;
  try {
    cachedFunnelId = await AsyncStorage.getItem(ONBOARDING_FUNNEL_ID_KEY);
  } catch {
    cachedFunnelId = null;
  }
  return cachedFunnelId;
}

export async function ensureOnboardingFunnelId(): Promise<string> {
  const existing = await getActiveOnboardingFunnelId();
  if (existing) return existing;
  const fresh = createUuid();
  cachedFunnelId = fresh;
  try {
    await AsyncStorage.setItem(ONBOARDING_FUNNEL_ID_KEY, fresh);
  } catch {
    // The in-memory identity still groups this process. The persisted state
    // adapter will retry storing it with the rest of onboarding progress.
  }
  return fresh;
}

export async function rotateOnboardingFunnelId(): Promise<string> {
  const fresh = createUuid();
  cachedFunnelId = fresh;
  await AsyncStorage.setItem(ONBOARDING_FUNNEL_ID_KEY, fresh);
  return fresh;
}

export async function restoreOnboardingFunnelId(id: string | null): Promise<void> {
  if (!id) return;
  cachedFunnelId = id;
  try {
    await AsyncStorage.setItem(ONBOARDING_FUNNEL_ID_KEY, id);
  } catch {
    // Best effort; never block onboarding on analytics storage.
  }
}

/** Test-only reset seam. */
export async function resetOnboardingFunnelIdForTests(): Promise<void> {
  cachedFunnelId = null;
  await AsyncStorage.removeItem(ONBOARDING_FUNNEL_ID_KEY);
}
