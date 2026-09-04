import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'nearr.pendingPremiumRequestJobId.v1';

export async function setPendingPremiumRequestJobId(jobId: string): Promise<void> {
  await AsyncStorage.setItem(KEY, jobId);
}

export async function getPendingPremiumRequestJobId(): Promise<string | null> {
  const value = await AsyncStorage.getItem(KEY);
  return value && value.trim() ? value : null;
}

export async function clearPendingPremiumRequestJobId(jobId?: string): Promise<void> {
  if (jobId) {
    const current = await getPendingPremiumRequestJobId();
    if (current !== jobId) return;
  }
  await AsyncStorage.removeItem(KEY);
}
