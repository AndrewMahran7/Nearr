# Nearr Plus willingness-to-pay experiment

Status: implementation prepared, sales and allowance enforcement disabled. No Apple product, RevenueCat entitlement, price, paid conversion or revenue has been observed.

## Offer selected

| Plan | Candidate benefit |
|---|---|
| Free | 3 successful video finds per UTC calendar month; all existing saved places, map, notes, privacy and account controls remain available. |
| Nearr Plus | One monthly auto-renewable subscription, candidate US price **$1.99/month**, 10 successful video finds per paid billing period including free use already consumed in that month. No annual plan, trial or “unlimited” claim. |

A video counts once after at least one owned place is actually saved or confirmed already saved, even if it contains multiple places. Failed/cancelled searches release their reservation. Quick Check holds one reservation for up to seven days. Unused finds do not roll over. Store-localized price text is read from StoreKit/RevenueCat; metadata must never hard-code the US price for other storefronts.

The paywall appears after product value is available, never as a requirement to retrieve prior saves. A paid subscription cannot bypass age, market, legal, AI-sharing or provider gates. Minor purchasing remains unavailable in this candidate; Apple's Ask to Buy or `canMakePayments` does not replace Nearr's legal/provider qualification.

## Economics

Apple documents 70% proceeds during the first subscription year and 85% afterward, while Small Business Program participants receive 85% each cycle, all before applicable tax effects. At $1.99, gross proceeds before tax are therefore approximately $1.39 at 70% or $1.69 at 85%. RevenueCat currently advertises no charge through $2,500 monthly tracked revenue and 1% thereafter; account enrollment and current terms still require verification. Sources: [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), [Apple pricing](https://developer.apple.com/help/app-store-connect/reference/pricing-and-availability/in-app-purchase-and-subscriptions-pricing-and-availability/), and [RevenueCat pricing](https://www.revenuecat.com/pricing).

No current full-path recognition cost exists because the permitted model is unqualified and no live benchmark was run. The maximum sustainable incremental cost per paid find is `net monthly proceeds / expected paid finds`, before support and infrastructure. At the hard allowance of 10, this is about $0.139 at 70% or $0.169 at 85% before tax, RevenueCat charges and fixed costs. Activation requires measured acquisition + transcription + model + Places + retry + note + infrastructure cost to fit with margin. A $0.99 unlimited offer is rejected as unsupported by evidence.

## Measurement

The code defines coarse events for offer seen, product displayed, purchase initiated/cancelled and restore completed, but optional analytics is deliberately disabled because separate consent and disclosure are not qualified. Subscription lifecycle state comes from server-verified RevenueCat data rather than a client event. Report conversions only after real Store transactions exist; do not treat test fixtures as users or revenue.

## Activation gate

Create exactly one App Store monthly product `nearr_plus_monthly_v1`, RevenueCat entitlement `nearr_plus`, offering `nearr_plus_v1`, and verify localized pricing. Configure sandbox IDs/secrets, webhook authentication and transfer policy. Pass every case in [RevenueCat QA](REVENUECAT_IAP_QA.md), approve disclosures, measure provider economics, and record qualification evidence before enabling `catalog_verified`, `release_qualified`, `sales_enabled` or `enforce_allowance`.
