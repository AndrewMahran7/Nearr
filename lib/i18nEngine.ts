import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from '../locales';

/** Pure bundled translation engine. Presentation helpers remain testable without native modules. */
export const i18n = i18next.createInstance();
const localeFormatter = {
  type: 'formatter' as const,
  init() {},
  add() {},
  addCached() {},
  format(value: unknown, _format: string | undefined, language: string | undefined) {
    return typeof value === 'number' ? new Intl.NumberFormat(language).format(value) : String(value);
  },
};
void i18n.use(localeFormatter).use(initReactI18next).init({
  resources,
  lng: 'en-US',
  fallbackLng: 'en-US',
  supportedLngs: Object.keys(resources),
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false, alwaysFormat: true },
  returnNull: false,
  react: { useSuspense: false },
});

/** Interface copy only; never destination names, personal notes, or provider result text. */
export function t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, { defaultValue: key, ...options }));
}
