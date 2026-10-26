// Pure Edge/Node-compatible adapter over the same generated, model-drafted app catalogs.
// No React, Expo, native module, network request, user text translation, or mutable locale.
import { notificationCatalog } from '../locales/notificationCatalog.ts';
import { resolveLocale } from './i18nCore.ts';

export function translateNotification(
  locale: string | null | undefined,
  key: string,
  values: Record<string, unknown> = {},
): string {
  const language = resolveLocale(locale ? [locale] : []);
  const catalogs = notificationCatalog as Record<string, Record<string, string>>;
  const plural = typeof values.count === 'number' ? `${key}_${new Intl.PluralRules(language).select(values.count)}` : key;
  const template = catalogs[language]?.[plural] ?? catalogs[language]?.[key] ?? catalogs['en-US']?.[plural] ?? catalogs['en-US']?.[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (typeof value === 'number') return new Intl.NumberFormat(language).format(value);
    return typeof value === 'string' ? value : placeholder;
  });
}
