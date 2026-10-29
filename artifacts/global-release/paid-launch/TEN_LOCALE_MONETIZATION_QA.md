# Ten-locale paid client QA — 29 October 2026

All ten bundled locales have the new paid copy and pass real component rendering in 11 states each. Translations are model authored; **native-speaker review and native visual checks remain outstanding**.

| Locale | New catalog + placeholder checks | Screen renders | Pixel/font-scale review |
| --- | --- | --- | --- |
| en-US | Pass | 11/11 | Not completed |
| es-MX | Pass | 11/11 | Not completed |
| es-ES | Pass | 11/11 | Not completed |
| pt-BR | Pass | 11/11 | Not completed |
| fr | Pass | 11/11 | Not completed |
| de | Pass | 11/11 | Not completed |
| it | Pass | 11/11 | Not completed |
| ja | Pass | 11/11 | Not completed |
| ko | Pass | 11/11 | Not completed |
| zh-Hans | Pass | 11/11 | Not completed |

States: free, active Plus, cancelled renewal, billing grace, expired, revoked, purchase pending, age/country restricted, unavailable catalog, offline and loading. Assertions exercise the actual Plus screen and PaidFindsBalance component: pending disables payments, restricted/unavailable/offline/loading expose no buy action, active/cancelled/grace retain verified unlimited access, purchased token balance remains separate, restriction copy renders, no unresolved interpolation and no truncated Text props.

`locales/paidMonetization.ts` supplies the new copy through the normal i18n resources. Placeholder sets must match the English keys in every locale. Store `priceString` is preserved exactly; subscription frequency text is localized around it. Dates use Intl with the current locale and UTC. Existing i18n numeric formatting handles count values. Labels use “remaining of total” and “purchased tokens: count” rather than incorrectly joining singular/plural fragments. Packs are fixed 20/50/200 quantities.

Evidence: `client/runtime-tests.json`, representative JSON component trees in `client/component-trees/`, and `scripts/testPaidFindsClientRuntime.ts`. The preexisting localization suite also passed catalog parity, placeholders, quantities/plurals/fallbacks, user-content preservation, persisted preferences/relaunch and native-language bridge contracts. None of these checks substitutes for human translation review or screenshot inspection.

There are no current native paywall screenshot passes to report. The bounded emulator attempt and exact bundler/approval limits are documented in `PAYWALL_VISUAL_QA.md`; its loading-screen capture must not be used as UI or App Store qualification.
