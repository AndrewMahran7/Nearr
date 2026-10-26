# Translation quality and verification

Status: **model-authored drafts with automated structural checks; no native-speaker certification.** Do not market the app as fully localized or approve locale screenshots until the corresponding language and device reviews pass.

The nine non-English catalogs were authored using the collaborating models' language capabilities. Spanish/Portuguese and common/native strings were drafted by the localization agent; French/German/Italian long copy and count families by the legal/provider agent; Japanese/Korean/Simplified Chinese long copy and count families by the monetization agent. Sources are maintained in `locales/source/*.tsv` and `locales/drafts/*.json`, merged by `scripts/buildLocalizationCatalogs.cjs`. No user notes, place database or private source catalog was submitted to an external translation vendor. An early connectivity probe used only three generic phrases; it was not used to generate these catalogs.

| Check | Result | Limit |
|---|---|---|
| Ten bundled catalogs against 1,462 English entries | PASS; zero missing | Includes variants/retained keys; not whole-runtime completeness proof |
| Placeholder parity | PASS; zero mismatches | Does not establish grammatical correctness |
| Unicode replacement characters | PASS; none in active keys/values | Native font shaping still requires device evidence |
| English singular/plural and localized count interpolation | PASS for 0/1/2/1,250 | Native grammar review pending, especially compound count sentences |
| Locale detection/fallback | PASS | Unsupported locales intentionally fall back |
| Runtime switch and preserved component state | PASS with real React subscription | Not a navigation/device E2E capture |
| Preference persistence/relaunch/App Group adapter | PASS with real adapter and mocked OS/storage bridges | Signed host/extension integration still pending |
| Native target resource structure | PASS, 2 targets / 10 locales / 40 files | No Swift compilation/signing claim |
| WSL iOS Expo prebuild | PASS after recorded plugin fix | CocoaPods installation and Xcode build not performed |
| Native speaker review | NOT PERFORMED | All non-English text remains draft |
| Actual locale screenshots / physical iPhone | NOT PERFORMED | Blocks locale visual qualification |

Critical copy fixes include inclusive Spanish “a partir de 13 años,” distinct eligibility/AI/purchase permissions, terminal update/eligibility/allowance failures, purchase restore states, irreversible account deletion, whole-sentence multi-place feedback and localized accessibility labels. Source captions and destination names stay unchanged. The engine uses selected-locale number formatting; dynamic UI helpers read the current language rather than freezing labels at module initialization.

The first complete regression run was 121/143 passing with 22 failures, mostly source assertions expecting bare English and render harnesses lacking the translation module. The affected assertions were changed to require exact translated wrappers or the corresponding whole-sentence/count semantics. Harnesses use the real pure translation engine. Save, source provenance, retry, ownership and UI behavior checks were retained. The final rerun passed 143/143 scripts; see `validation/matrix-results.json` and its per-script logs.

Required reviewer pass: verify natural wording and age boundaries, payment and privacy distinctions, all 0/1/multiple count forms, original-source versus interface wording, German compound labels, Spanish regional consistency and CJK punctuation. Required native pass: narrow and large iPhones, maximum supported text size, light/dark, every onboarding/consent/auth state, Quick Check with multiple results, permission refusal, long place names, account deletion, Plus Store sheets, native extension loading/failure and local/remote notification titles/actions. Long-text source/render tests are useful screening; they do not establish native layout or glyph quality.

Architecture sources checked: [i18next configuration](https://www.i18next.com/overview/configuration-options), [react-i18next subscription hook](https://react.i18next.com/latest/usetranslation-hook), [Expo localization](https://docs.expo.dev/guides/localization/). Actual installed i18next 26 requires a formatter module; the implementation uses that supported API, not the removed interpolation.format option.
