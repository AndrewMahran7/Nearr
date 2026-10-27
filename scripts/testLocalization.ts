import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { i18n, t } from '../lib/i18nEngine';
import { LOCALE_STORAGE_KEY, resolveLocale, SUPPORTED_LOCALES } from '../lib/i18nCore';
import { translateNotification } from '../lib/notificationLocalization';

const root = process.cwd();
const preAuth = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
for (const marker of ['INTERESTS.map', 'PAIN_POINTS.slice', 'DESIRED_VALUES.map']) {
  const line = preAuth.split('\n').find(line => line.includes(marker));
  assert.ok(line, `${marker} is still rendered`);
  assert.ok(line.includes('accessibilityLabel={t(item.label)}'), `${marker} accessibility follows selected locale`);
  assert.ok(line.includes('>{t(item.label)}</Text>'), `${marker} visible choices follow selected locale`);
}
const choiceKeys = [...preAuth.slice(preAuth.indexOf('const INTERESTS:'), preAuth.indexOf('const PLATFORM_LABELS:')).matchAll(/label: ('([^']*)'|"([^"]*)")/g)].map(match => match[2] ?? match[3]);
assert.equal(choiceKeys.length, 16, 'all interest, pain-point and desired-value choices are covered');
choiceKeys.push('Outdoor spots', 'Food spots', 'Travel places', 'Great places', 'Outdoor places', 'Places you love');
for (const locale of SUPPORTED_LOCALES) {
  const catalog = JSON.parse(readFileSync(join(root, 'locales', `${locale}.json`), 'utf8'));
  for (const key of choiceKeys) assert.ok(catalog[key], `${locale} translates ${key}`);
}
const en: Record<string,string> = JSON.parse(readFileSync(join(root,'locales/en-US.json'),'utf8'));
const settingsSource = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
assert.ok(
  settingsSource.includes("import { LanguageSelector }") && settingsSource.includes('<LanguageSelector />'),
  'authenticated users can change language from Settings after onboarding',
);
const feedbackSource = readFileSync(join(root, 'app/feedback.tsx'), 'utf8');
assert.ok(
  feedbackSource.includes(`t("Thanks — I'll take a look.")`) &&
    !feedbackSource.includes('â€”'),
  'feedback success copy uses the canonical localized em-dash key',
);
const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match=>match[1]).sort();
const settingsDescriptionKeys = [
  'Let Nearr send reminders and updates.',
  "Remind me when I'm near a place I saved.",
  'Pause reminders during a daily window.',
];
const reports = SUPPORTED_LOCALES.map(locale => {
  const catalog: Record<string,string> = JSON.parse(readFileSync(join(root,'locales',`${locale}.json`),'utf8'));
  const missing = Object.keys(en).filter(key=>!catalog[key]);
  const interpolation = Object.keys(en).filter(key=>catalog[key] && JSON.stringify(placeholders(en[key]))!==JSON.stringify(placeholders(catalog[key])));
  const replacementCharacters = Object.entries(catalog).filter(([key,value]) => Object.hasOwn(en,key) && /\uFFFD/.test(key+value)).map(([key])=>key);
  const suspiciousSettingsQuestionMarks = locale === 'en-US'
    ? []
    : settingsDescriptionKeys.filter(key => /\?/.test(catalog[key] ?? ''));
  return {locale,keys:Object.keys(en).length,missing,interpolation,replacementCharacters,suspiciousSettingsQuestionMarks,review:'model draft; native review outstanding'};
});
mkdirSync(join(root,'artifacts/global-release/localization'),{recursive:true});
writeFileSync(join(root,'artifacts/global-release/localization/catalog-audit.json'),JSON.stringify(reports,null,2)+'\n');
for(const report of reports) {
  assert.deepEqual(report.missing,[],`${report.locale} missing keys`);
  assert.deepEqual(report.interpolation,[],`${report.locale} interpolation mismatch`);
  assert.deepEqual(report.replacementCharacters,[],`${report.locale} corrupt characters`);
  assert.deepEqual(report.suspiciousSettingsQuestionMarks,[],`${report.locale} corrupt Settings descriptions`);
}
for(const [tags, expected] of [
  [[], 'en-US'], [['ar-SA'],'en-US'], [['fr-CA'],'fr'], [['es-ES'],'es-ES'], [['es-AR'],'es-MX'],
  [['pt-PT'],'pt-BR'], [['zh-Hant'],'en-US'], [['zh-TW','ja-JP'],'ja'], [['zh-CN'],'zh-Hans'], [['de_DE'],'de'],
] as const) assert.equal(resolveLocale(tags),expected);

for(const locale of SUPPORTED_LOCALES) {
  awaitLocale: for(const count of [0,1,2,1250]) {
    // init is synchronous; changeLanguage synchronously selects bundled resources.
    void i18n.changeLanguage(locale);
    const value=t('I found {{count}} places in this post. Choose which to save.',{count});
    assert.ok(!value.includes('{{'),'plural templates interpolate completely');
    assert.ok(value.includes(new Intl.NumberFormat(locale).format(count)),'quantities use selected locale');
    assert.equal(t('Unknown future interface key'),'Unknown future interface key','English key fallback');
    assert.equal(t('{{name}} is saved',{name:'Café 東京 <Park>'}).includes('Café 東京 <Park>'),true,'proper names remain unchanged');
    const notification=translateNotification(locale,'Nearr currently supports videos up to {{value0}}.',{value0:'3'});
    assert.ok(!notification.includes('{{'));
  }
}
void i18n.changeLanguage('en-US');
assert.equal(t('I found {{count}} places in this post. Choose which to save.',{count:1}),'I found 1 place in this post. Choose which to save.');
assert.equal(t('I found {{count}} places in this post. Choose which to save.',{count:2}),'I found 2 places in this post. Choose which to save.');

async function persistence() {
  let shared: string | null = null;
  const stored=new Map<string,string>();
  let device=['fr-CA'];
  let changes=0;
  const countChange=()=>{changes++;}; i18n.on('languageChanged',countChange);
  // Execute the real native adapter with deterministic storage/device bridges.
  function loadAdapter() {
    const output=ts.transpileModule(readFileSync(join(root,'lib/i18n.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    const module={exports:{} as any};
    const localRequire=(name:string) => {
      if(name==='expo-localization') return {getLocales:()=>device.map(languageTag=>({languageTag}))};
      if(name==='@react-native-async-storage/async-storage') return {getItem:async(key:string)=>stored.get(key)??null,setItem:async(key:string,value:string)=>{stored.set(key,value);}};
      if(name==='../modules/nearr-shared-auth') return {getPreferredLocale:()=>shared,setPreferredLocale:(value:string)=>{shared=value;return true;}};
      if(name==='./i18nEngine') return {i18n,t};
      if(name==='./i18nCore') return require('../lib/i18nCore');
      throw new Error(`Unexpected native dependency: ${name}`);
    };
    new Function('require','module','exports',output)(localRequire,module,module.exports);
    return module.exports;
  }
  const adapter=loadAdapter();await adapter.initializeLocale();assert.equal(i18n.language,'fr');
  assert.deepEqual(adapter.localePreferenceState(), { ready: true, confirmed: false }, 'device default is preselected, not a persisted user choice');
  let preferenceNotifications = 0;
  const unsubscribe = adapter.subscribeLocalePreference(() => { preferenceNotifications++; });
  await adapter.changeLocale('fr');
  assert.equal(preferenceNotifications, 1, 'confirming an unchanged device language still updates the screen subscription');
  assert.equal(adapter.localePreferenceState().confirmed, true);
  unsubscribe();
  await adapter.changeLocale('ja');assert.equal(stored.get(LOCALE_STORAGE_KEY),'ja');assert.equal(shared,'ja');
  device=['de-DE'];const relaunched=loadAdapter();await relaunched.initializeLocale();assert.equal(i18n.language,'ja','explicit preference survives relaunch and device change');
  assert.equal(relaunched.localePreferenceState().confirmed, true, 'relaunch skips redundant language prompt');
  const previous=changes;await relaunched.initializeLocale();assert.equal(changes,previous,'notification initialization does not recursively emit language changes');
  await relaunched.changeLocale('system');assert.equal(i18n.language,'de');
  device=['es-ES'];relaunched.refreshDeviceLocale();assert.equal(i18n.language,'es-ES');
  stored.set(LOCALE_STORAGE_KEY,'fr');shared='ko';const extension=loadAdapter();await extension.initializeLocale();assert.equal(i18n.language,'ko','App Group bridges host choice to separate extension storage');
  await assert.rejects(extension.changeLocale('invalid'));
  i18n.off('languageChanged',countChange);await i18n.changeLanguage('en-US');
}
persistence().then(()=>console.log(`PASS localization: ${SUPPORTED_LOCALES.length} locales, catalog parity, placeholders, quantities, plurals, fallbacks, user content, persisted preferences, relaunch, native bridge, no event loop`)).catch(error=>{console.error(error);process.exitCode=1;});
