import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDeclaration, type EligibilityDeclaration } from './globalEligibility';

export const LOCAL_ELIGIBILITY_KEY = 'nearr.globalEligibility.v1';
const OWNER_KEY = 'nearr.globalEligibility.owner.v1';
export async function readLocalDeclaration(): Promise<EligibilityDeclaration | null> {
  const raw = await AsyncStorage.getItem(LOCAL_ELIGIBILITY_KEY);
  try { const value: unknown = raw ? JSON.parse(raw) : null; return isDeclaration(value) ? { ageBand: value.ageBand, countryCode: value.countryCode } : null; }
  catch { return null; }
}
/** Call only at the creation of the anonymous identity for this local journey. */
export async function bindLocalDeclarationToNewAnonymous(userId: string): Promise<void> {
  if (await AsyncStorage.getItem(OWNER_KEY)) return;
  if (await readLocalDeclaration()) await AsyncStorage.setItem(OWNER_KEY, userId);
}
export async function readOwnedLocalDeclaration(userId: string): Promise<EligibilityDeclaration | null> {
  return await AsyncStorage.getItem(OWNER_KEY) === userId ? readLocalDeclaration() : null;
}
