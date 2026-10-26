import { useEffect, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { changeLocale, getLocalePreference, i18n, initializeLocale, refreshDeviceLocale } from '../lib/i18n';

export function LocaleProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void initializeLocale();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshDeviceLocale();
    });
    return () => subscription.remove();
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** Subscribe without remounting navigation, forms, selected places, or in-flight work. */
export function useLocale() {
  useTranslation(undefined, { i18n });
  return { locale: i18n.language, preference: getLocalePreference(), setLocale: changeLocale };
}
