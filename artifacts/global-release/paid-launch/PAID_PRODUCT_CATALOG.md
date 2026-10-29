# Paid product catalog qualification

Reviewed 2026-10-29 UTC. Branch: `release/nearr-1.7-paid-launch-final`. This is a proposed configuration and evidence inventory; no Apple product or RevenueCat setting was changed by this review.

## Required catalog and proposed identifiers

| Product | Type / benefit | Store product ID | Requested USD | Proposed USD pending live price-point check |
| --- | --- | --- | ---: | ---: |
| Nearr Plus | One-month auto-renewing subscription; unlimited successful finds while verified access is active; no trial or annual plan | `com.nearr.plus.unlimited.monthly.v1` (new, existence unverified) | 1.99 | 1.99 |
| Starter | Consumable; 20 purchased finds, no expiry | `com.nearr.tokens.20.v2` (existing repository mapping) | 1.20 | 1.19 if 1.20 unavailable |
| Explorer | Consumable; 50 purchased finds, no expiry | `com.nearr.tokens.50.v2` (existing repository mapping) | 2.50 | 2.49 if 2.50 unavailable |
| Adventurer | Consumable; 200 purchased finds, no expiry | `com.nearr.tokens.200.v2` (existing repository mapping) | 5.00 | 5.00 |

The 1.19/2.49 alternatives are **planning inferences from Apple's published USD grid**, each one cent below the request. They have not been read from this app's price picker. Apple publishes ten-cent steps beginning at 0.29 and additional ending conventions, including whole-dollar amounts. Confirm exact available choices before saving. All displayed checkout prices must come from StoreKit's localized price, not these USD planning figures. [Apple pricing overview](https://developer.apple.com/in-app-purchase/), [setting an IAP price](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase).

Repository proof: `supabase/migrations/20260910000002_nearr_monetization_experiment_v2.sql` maps the three v2 IDs to quantities 20/50/200, package keys `tokens_20_v2`, `tokens_50_v2`, `tokens_200_v2`, and historical experiment display cents 120/250/500. Those are not evidence of Apple product type, current price, approval status, availability, or receipt behavior.

Do not repurpose `nearr_plus_monthly_v1` (the prior capped Plus proposal), `com.nearr.pro.monthly.v1` (legacy Pro), or v1 token identifiers. Retain their receipts and obligations. Reuse a v2 pack only after its actual Apple type and existing advertised quantity are confirmed compatible; otherwise propose a fresh ID before any mutation. Existing subscribers must not acquire a second simultaneous charge accidentally; inspect the actual legacy subscription group and active obligations before choosing the new subscription's group.

## Account evidence and boundary

Historical live readback from 2026-10-27/28 in `../final-production/store/STORE_READBACK.md` recorded ASC app `6764170112`, Paid Apps Agreement **Active — New Agreement Available**, bank/tax/DSA active, and RevenueCat Nearr Dev project `7d727ef6`. It did not establish Small Business enrollment or the new unlimited product. The previous default offering contained legacy Pro and three token packs. These facts are historical, not a current qualification.

On 2026-10-29 the existing ASC and RevenueCat tabs were inventoried. Two supported browser attachment attempts failed with `Emulation.setFocusEmulationEnabled` timeout. A bounded native fallback could not obtain usable geometry/accessibility state. No product details, current agreement, price picker, sandbox tester, app ID mapping, or purchase history could be freshly read. No terms were accepted. No remote write occurred.

## Concrete mutation plan awaiting live verification

1. Read the app's subscription groups, every candidate product's type/quantity/status/territories/prices, existing Pro obligations, the Paid Apps Agreement, and RevenueCat app identity. Record current values without exposing keys or tester credentials.
2. Propose creating the distinct monthly unlimited ID at 1.99, using a compatible reviewed subscription-group transition. Propose the three compatible consumables at exact supported prices. Report any differences from the requested amounts.
3. Propose a new explicit offering `nearr_paid_v1` with `$rc_monthly` plus the three token package keys. Attach only unlimited Plus to the reviewed Plus entitlement; consumables grant quantities through the server purchase ledger, not permanent Plus access. Keep legacy offerings intact. Names here remain proposals, not remotely created objects.
4. Catalog saves create persistent product identifiers and pricing/availability records; a default-offering switch could affect old clients. Therefore do not switch the default merely to test the new explicit offering. Read back saved configuration before sandbox testing.
5. Keep Production sales and recognition activation closed until real sandbox transactions, recovery/refund behavior, eligibility, provider qualification and the release gates pass. Catalog creation alone is not permission to sell.

No ten-locale App Store metadata was re-saved by this review.

Local purchase metadata is prepared in `iap-metadata-candidates.json`, with `iap-metadata-validation.json` recording 10 locales and 90 localized fields, valid UTF-8/NFC and product display-name/description lengths. It is not uploaded or native-speaker reviewed. The group label is a proposal pending the legacy subscription-group review; the official reference's unstated numeric group-name limit is not invented.
