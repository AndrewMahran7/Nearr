import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPreferredLocale, setPreferredLocale } from '../modules/nearr-shared-auth';
import { i18n, t } from './i18nEngine';
import { isLocalePreference, LOCALE_STORAGE_KEY, resolveLocale, type AppLocale, type LocalePreference } from './i18nCore';

export { i18n, t };

export function deviceLocale(): AppLocale {
  try {
    return resolveLocale(getLocales().map(locale => locale.languageTag));
  } catch {
    return resolveLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  }
}

const sharedPreference = getPreferredLocale();
let preference: LocalePreference = isLocalePreference(sharedPreference) ? sharedPreference : 'system';
let ready = false;
let confirmed = isLocalePreference(sharedPreference);
let revision = 0;
const listeners = new Set<() => void>();
export const subscribeLocalePreference = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const localePreferenceSnapshot = () => `${ready}:${confirmed}:${preference}`;
export const localePreferenceState = () => ({ ready, confirmed });
const notifyPreference = () => { listeners.forEach(listener => listener()); };
void i18n.changeLanguage(preference === 'system' ? deviceLocale() : preference);

export function getLocalePreference(): LocalePreference { return preference; }

export async function initializeLocale(): Promise<void> {
  const atRead = revision;
  const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY).catch(() => null);
  if (atRead !== revision) return;
  const shared = getPreferredLocale();
  const value: LocalePreference = isLocalePreference(shared) ? shared : isLocalePreference(stored) ? stored : 'system';
  preference = value;
  confirmed = isLocalePreference(shared) || isLocalePreference(stored);
  const language = value === 'system' ? deviceLocale() : value;
  if (i18n.language !== language) await i18n.changeLanguage(language);
  ready = true;
  notifyPreference();
}

export async function changeLocale(value: LocalePreference): Promise<void> {
  if (!isLocalePreference(value)) throw new Error('Unsupported locale');
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, value);
  revision += 1;
  setPreferredLocale(value);
  preference = value;
  ready = true;
  confirmed = true;
  const language = value === 'system' ? deviceLocale() : value;
  if (i18n.language !== language) await i18n.changeLanguage(language);
  notifyPreference();
}

export function refreshDeviceLocale(): void {
  const language = deviceLocale();
  if (preference === 'system' && language !== i18n.language) void i18n.changeLanguage(language);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, options).format(value);
}
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.language, options).format(value);
}
export function formatDistance(meters: number): string {
  const imperial = i18n.language === 'en-US';
  const value = imperial ? meters / 1609.344 : meters / 1000;
  return new Intl.NumberFormat(i18n.language, { style: 'unit', unit: imperial ? 'mile' : 'kilometer', maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
}
