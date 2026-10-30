# Ten-locale IAP metadata and review readiness

Text and official references checked 2026-10-29 at 22:41 UTC against source `49f559d488f133a744c7cd21809cc65c15cf9b8d`. Apple draft entry and reopen verification completed by 23:13 UTC; the [Apple catalog readback](APPLE_CATALOG_READBACK.md) records all four saved products, prices, availability, forty product localizations and ten group names. This reviewer has not changed RevenueCat.

The [exact metadata JSON](iap-metadata-candidates.json) is saved in Apple drafts for all ten locales and four products, plus one group label per locale. Localized copy is unchanged from the original candidate; progress metadata now records saved/reopened status. Current source SHA-256 is `6b3431b38221d3ecb4403d8e512ba70a69c5a89417d0f22dd3cd46a3a37d6691`. `readyToUpload: false` means the entire product package is not certified for review or release: genuine iOS screenshots and sandbox evidence are still pending. `appStoreReadbackVerified: true` applies to the metadata entry only. No product is represented as approved, submitted or sandbox-verified.

## Exact product and localization coverage

| Product | Identifier | Type and configured benefit | Actual saved US price |
| --- | --- | --- | --- |
| Nearr Plus | `com.nearr.plus.unlimited.monthly.v1` | Auto-renewable, one month, unlimited successful finds during active verified access; no trial/annual plan | $1.99/month |
| Starter | `com.nearr.tokens.20.v2` | Consumable, 20 successful finds, no time expiry | $1.19 |
| Explorer | `com.nearr.tokens.50.v2` | Consumable, 50 successful finds, no time expiry | $2.49 |
| Adventurer | `com.nearr.tokens.200.v2` | Consumable, 200 successful finds, no time expiry | $5.00 |

The subscription display name and group display name are `Nearr Plus` in every locale. Group `22527278` has reference name `Nearr Plus` and subscription `6828623567`. All ten group localizations were saved and reopened with App Name `Nearr`. Legacy Pro obligations were not migrated; all three legacy v1 token drafts remain untouched.

| ASC locale | Plus description | Pack display names: 20 / 50 / 200 | Longest description |
| --- | --- | --- | ---: |
| en-US | Unlimited successful finds, billed monthly. | Starter 20 / Explorer 50 / Adventurer 200 | 43 |
| es-MX | Búsquedas exitosas ilimitadas cada mes. | Inicial 20 / Explorador 50 / Aventurero 200 | 39 |
| es-ES | Búsquedas exitosas ilimitadas cada mes. | Inicial 20 / Explorador 50 / Aventurero 200 | 39 |
| pt-BR | Buscas bem-sucedidas ilimitadas por mês. | Inicial 20 / Explorador 50 / Aventureiro 200 | 40 |
| fr-FR | Recherches réussies illimitées, au mois. | Découverte 20 / Explorateur 50 / Aventurier 200 | 41 |
| de-DE | Unbegrenzte erfolgreiche Suchen. Monatsabo. | Starter 20 / Entdecker 50 / Abenteurer 200 | 43 |
| it | Ricerche riuscite illimitate. Piano mensile. | Base 20 / Esploratore 50 / Avventuriero 200 | 44 |
| ja | 成功した場所検索は無制限。月額プラン。 | スターター 20 / エクスプローラー 50 / アドベンチャー 200 | 20 |
| ko | 성공한 장소 찾기 무제한. 월간 구독. | 스타터 20 / 탐험가 50 / 모험가 200 | 24 |
| zh-Hans | 成功地点查找次数不限，按月订阅。 | 入门 20 / 探索 50 / 冒险 200 | 17 |

Each pack's exact localized description is in the JSON and explicitly retains its quantity and non-expiry. The copy describes the intended paid benefit, not a guarantee that every recognition attempt succeeds. It contains no accuracy percentage, live availability assertion or embedded currency/price. Saving draft metadata is separate from publishing these benefits: the app must deliver them before sale or review submission. No native-speaker or on-device text qualification is claimed.

## Validation and field constraints

Fresh executable validation passed all **90 localized fields**: exact locale/product coverage, Unicode code-point lengths, valid UTF-8 round trip, NFC, no control characters/markup, no embedded prices, and exact pack quantities. Maximum name length is 16; maximum description length is 44. Product reference names and IDs pass their bounds. The [current validation receipt](payment-qualification/iap-metadata-current-validation.json) matches the updated source hash and checks unchanged localized text against source `49f559d`; the older receipt is historical.

Apple specifies product display names of 2–30 characters, descriptions up to 45, reference names up to 64 and product IDs up to 100. Saved product IDs cannot be edited or reused, even after deleting a product. Review notes allow 4,000 characters. Its review screenshot must show the offered item/service and use a supported app screenshot size; the optional promotional image is a different 1024×1024 asset. [Apple IAP information](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information).

The subscription reference confirms one-month duration and localized subscription/group names. It does not state a numeric maximum for the group display name; this report does not invent one. The ten-character ASCII group/subscription brand avoids the reference's prohibited formatting characters. One subscriber can hold one product per subscription group, making actual legacy group placement consequential. [Apple subscription information](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information).

## Price and eventual App Review preparation

The expanded live Apple picker was inspected using **See Additional Prices**: exact $1.20/$2.50 were absent, closest $1.19/$2.49 were present, and exact $5.00 was present. Those supported choices are now saved and reopened. All four persisted 175-storefront CSVs and their validation are linked in the Apple readback report. Apple permits automatic foreign price equalization or manually selected storefront prices. Product metadata can take up to one hour to reach sandbox. Account Holder acceptance of applicable agreements is separate from field entry; the coordinator observed Paid Apps Active and an updated Developer Program agreement still requiring founder action. [Apple IAP pricing](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase).

The first product of each IAP type must accompany a new app version. A new subscription must be submitted with its group, and a new group with at least one subscription. Add the intended app, group, subscription and three packs to the same draft submission before submitting. Actual prior approvals determine whether the first-type rule applies to Nearr. Submission requires Account Holder, Admin or App Manager permission. This scoped task prepares those items and does not independently authorize the app's submission. [Apple submission instructions](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/).

Saved and reopened: distinct compatible product IDs/types, all localized fields, prices/storefront matrices, truthful draft review notes and Prepare for Submission statuses. Still pending: genuine review screenshots for every item, eventual reviewer access instructions, sandbox tester credentials and actual iOS purchase/refund evidence. Screenshots must depict the implemented purchase UI and real catalog state. A loading frame, synthetic balance or App Store Connect screenshot is not iOS product-review evidence.

## RevenueCat sandbox requirements

RevenueCat's current webhook documentation offers HTTPS destinations, app/environment filters and an Authorization header. Nearr-Dev must receive the selected app's **SANDBOX** events; the server must independently reject foreign environments. RevenueCat customers can contain both sandbox and Production transactions, so a project or customer name does not establish isolation. The documentation identifies webhook access as a Pro integration; inspect the actual account entitlement before describing a limitation or proposing any paid change. It also documents optional HMAC signing; the existing shared-header authentication must not be described as HMAC. [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks).

A dashboard TEST delivery proves endpoint delivery only. Real sandbox purchase events, authenticated processing, exact owner/product/quantity, durable receipts and ledger changes must be matched. Duplicate delivery is expected; the documented retry window ends after about 80 minutes, and dashboard resend exists. Missed delivery must reconcile without another payment. Subscription event refresh does not by itself verify consumable grants. No transaction, webhook delivery, plan entitlement or recovery success was exercised by this metadata review. [RevenueCat webhook testing and retries](https://www.revenuecat.com/docs/integrations/webhooks).

The authorized Apple text-entry workflow is complete. Public sale, App Review readiness, real sandbox qualification and native text review remain separate evidence states.
