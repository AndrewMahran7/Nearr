/** Pure locale policy, shared by runtime and localization qualification tests. */
export const SUPPORTED_LOCALES = ['en-US', 'es-MX', 'es-ES', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = AppLocale | 'system';
export const LOCALE_STORAGE_KEY = 'nearr.locale.v1';
export const LOCALE_NAMES: Record<AppLocale, string> = {
  'en-US': 'English',
  'es-MX': 'Español (México)',
  'es-ES': 'Español (España)',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  'zh-Hans': '简体中文',
};

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function resolveLocale(tags: readonly string[]): AppLocale {
  for (const tag of tags) {
    const normalized = tag.replace(/_/g, '-').toLowerCase();
    const exact = SUPPORTED_LOCALES.find(locale => locale.toLowerCase() === normalized);
    if (exact) return exact;
    const language = normalized.split('-')[0];
    if (language === 'en') return 'en-US';
    if (language === 'es') return /(?:^|-)es(?:-|$)/.test(normalized.slice(3)) ? 'es-ES' : 'es-MX';
    if (language === 'pt') return 'pt-BR';
    if (language === 'zh') {
      if (/(?:hant|tw|hk|mo)/.test(normalized)) continue;
      return 'zh-Hans';
    }
    if (['fr', 'de', 'it', 'ja', 'ko'].includes(language)) return language as AppLocale;
  }
  return 'en-US';
}
