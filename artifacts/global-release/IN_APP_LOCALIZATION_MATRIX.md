# In-app localization integration

Status: **implemented in the unified source; release qualification pending native language review and actual device captures.** These languages are not claimed to be shipped in the public 1.4 app or the older 1.5 binary.

The maintained runtime is i18next/react-i18next with bundled catalogs, Expo device-locale detection, an explicit Settings selector, AsyncStorage persistence, and an App Group preference shared with the native Share Extension. Every translated consumer subscribes to language changes; changing language does not remount navigation or discard selected places. Root integration synchronizes the effective language to an authenticated account preference for server notifications. No text is sent to a translation service at runtime.

| App locale | Store metadata locale | Device fallback | Catalog status | Native review / device captures |
|---|---|---|---|---|
| en-US | en-US | Other English and unsupported languages | Baseline | Pending |
| es-MX | es-MX | Spanish outside Spain | Model draft, parity checked | Pending |
| es-ES | es-ES | Spain | Model draft, regional vídeo spelling | Pending |
| pt-BR | pt-BR | Portuguese | Model draft, parity checked | Pending |
| fr | fr-FR | French, including fr-CA | Model draft, parity checked | Pending |
| de | de-DE | German | Model draft, parity checked | Pending |
| it | it | Italian | Model draft, parity checked | Pending |
| ja | ja | Japanese | Model draft, parity checked | Pending |
| ko | ko | Korean | Model draft, parity checked | Pending |
| zh-Hans | zh-Hans | Simplified Chinese | Model draft, parity checked | Pending |

Traditional Chinese is not represented as Simplified Chinese. zh-Hant/TW/HK/MO fall through to another preferred supported device locale, otherwise English. Arabic, Hindi, Indonesian, Turkish, pt-PT, fr-CA and Traditional Chinese do not have separate qualified catalogs. There is no RTL language in this first wave; a future RTL release must audit directional layouts and native relaunch behavior before enabling it.

| Surface | Implementation / evidence |
|---|---|
| Before account creation | Language selector, neutral age/region choices, eligibility notices, auth and permissions use the catalog |
| Onboarding | Tutorial labels, permission explanations, activation copy and account transfer errors translated; original illustrative post text/names preserved |
| Map, Saved, details, search | Controls, category labels, filters, empty states, reminders, notes editor, accessibility and saved-place feedback connected to runtime translation |
| Quick Check, multiple places, correction, Activity | Actual screen copy and finite presentation helpers translated; whole count templates and explicit plural variants preserve save/retry behavior |
| Settings and privacy rights | Language selector, processing permissions, account deletion confirmations, errors, Terms/Privacy navigation translated |
| Plus | Loading, allowance explanations, purchase/restore/cancel/pending messages translated; product price comes from the Store SDK |
| Share Extension | React text, age/AI/update restrictions and native loading/recovery strings share locale preference |
| Notifications | Local categories/reminders and server completion templates use the same catalogs; server helper is pure Deno-compatible TypeScript |
| Legal documents | Navigation and status copy translated. Unapproved global legal drafts remain explicitly labeled review material, not certified legal translations |

Evidence: [catalog audit](localization/catalog-audit.json), [explicit key occurrences](localization/key-usage.json), [original migration inventory](localization/literal-inventory.json), [native resource audit](localization/native-resource-audit.json), and [successful Linux iOS project generation](native-prebuild-linux-success.log). The catalog currently contains 1,462 English entries, with zero missing entries and zero interpolation mismatches in all ten locales. Entry counts include plural variants and retained static source keys; they are **not** a percentage of every possible runtime string.

Numbers use Intl formatting through the translation engine; current dates and primary browsing distances use the selected locale, with kilometers outside en-US. Existing explicit user reminder units retain their stored meaning. Native permission buttons, Apple purchase sheets, Maps, browser content and keyboard language follow system/provider settings and cannot be forced by the in-app selector. Original place names, personal notes, source posts and provider recognition descriptions are not automatically translated.

Run `node scripts/buildLocalizationCatalogs.cjs`, `node node_modules/ts-node/dist/bin.js -P scripts/tsconfig.json scripts/testLocalization.ts`, and `node scripts/testNativeLocalization.cjs`. Catalog tests cover parity, placeholder integrity, quantity formatting, plurals, fallback, original-content preservation, storage/relaunch, host-to-extension preference handoff, repeated initialization, and actual React subscription without remount. Native tests exercise the real xcode library, two targets, four variant groups, ten locales, 40 generated strings files, parser round-trip and idempotence.

The native binary must be rebuilt. An OTA cannot add the shared-locale bridge, native `.lproj` files or new native dependencies. Full walkthroughs in every language, large text/German expansion, CJK glyph rendering, OS dialogs, signed binary contents and physical Share Extension behavior remain release gates.
