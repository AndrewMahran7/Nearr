# Apple and RevenueCat qualification

Evidence date: 2026-10-29 UTC. Status: **not qualified for live purchases**. No account configuration was changed.

## Known configuration

Historical readback in `../final-production/store/STORE_READBACK.md` identifies Nearr Dev project `7d727ef6`; active webhook `Nearr Dev Monetization v2` pointed to Development's legacy `revenuecat-webhook`. The default `nearr_monetization_v2` offering had three token packages and `$rc_monthly` mapped to `com.nearr.pro.monthly.v1`. The earlier `nearr_plus_v1` offering was absent. This is not a qualified route for the new unlimited contract.

The current Apple bundle ID is `com.nearr.ios`. **That is not the RevenueCat app configuration ID.** No fresh actual RevenueCat app ID, matching public SDK key, secret API permissions, new offering, exact product mapping, webhook destination/filter/authentication, or sandbox tester was verified on this pass because supported browser/native access failed. Do not invent an ID or treat an existing secret as approval. Public and private credentials must stay out of artifacts.

Before testing, read back the actual RC app ID and its Apple bundle mapping, the explicit offering and product IDs, the entitlement attached only to unlimited Plus, and separate Development/Sandbox versus Production webhook destinations. Configure authenticated delivery for purchase, cancellation, refund reversal and transfer events. Never let a sandbox event credit Production. Historical Pro/token obligations require reconciliation, not overwriting.

## Server verification contract

`lib/paidPurchaseVerification.ts` parses **already authenticated server webhooks**. It does not authenticate network delivery itself. The Edge caller must authenticate raw delivery and load the real app configuration and primary opaque `np_<uuid>` account identity from the database. Only exact Apple store/environment/app/product matches can reach the ledger. Aliases and an original identity are not grant owners. Quantities are fixed at 20/50/200; client quantities, SDK success and client receipts cannot authorize credit.

The pure transition contract preserves refund tombstones across delayed purchase events, permits only a newer explicit refund reversal to restore a revoked transaction, and rejects transaction reuse across owner/product/environment. The database must independently enforce global transaction uniqueness, ownership, idempotency and atomic ordering; the pure model alone provides no race guarantee. `scripts/testPaidPurchaseVerification.ts` passed **49 offline checks** and isolated strict TypeScript on 2026-10-29. These are not StoreKit transactions.

Official v1 Customer Info documents non-subscription records with an internal `id`; it does not establish that ID as StoreKit's transaction identifier or document consumable refund/ownership fields. Therefore `inspectPaidSubscriberPurchases` returns no creditable purchases and an explicit verification gap. Neither a product/timestamp join nor extra client-supplied fields close that gap. Empty v1 results must not erase a purchased balance. [RevenueCat v1 model](https://www.revenuecat.com/docs/api-v1/customer-info-model).

## Missed-delivery recovery is required before activation

Current parser authority is authenticated RevenueCat webhook delivery. A successful Apple payment followed by an unavailable Nearr sync must remain visibly pending, preserve its transaction reference privately, and allow checking status without another purchase. Once the ledger exists, reinstall/restore reads the same ledger without a second credit.

RevenueCat documents automatic webhook retries ending after approximately 80 minutes and dashboard Retry/event-detail resend. A durable server acknowledgement must follow durable receipt/processing, not simply an in-memory attempt. Sandbox must prove delayed delivery, duplicate delivery, recovery after retry exhaustion, and refund delivery after a prior grant. Do not assume purchases made before the correct integration existed will spontaneously replay. [Webhook delivery and retry](https://www.revenuecat.com/docs/integrations/webhooks).

Implemented local recovery candidate: `GET /v2/projects/{project_id}/purchases?store_purchase_identifier=<StoreKit transaction>` with `customer_information:purchases:read`. Its response includes customer, internal product, store identifier, environment, ownership, status and quantity. `lib/paidPurchaseRecovery.ts` resolves the internal product through `GET /products/{id}?expand=app`, requiring product/app read scopes. It verifies the approved Apple ID, consumable type, primary server owner, configured app/project and `com.nearr.ios` bundle. It rejects ambiguity, pagination, unsupported quantity or ownership, foreign configuration and malformed states. [RevenueCat v2 purchase lookup](https://www.revenuecat.com/docs/api-v2/purchase), [v2 products](https://www.revenuecat.com/docs/api-v2/product).

The adapter makes at most two GETs to the fixed RevenueCat origin, refuses redirects, limits each response to 256 KiB and the entire operation to 15 seconds. It emits a recovery snapshot with explicit provenance, never a fabricated webhook. A fresh refunded snapshot conservatively revokes spendable funds unless a newer real callback occurred after the read began; an owned snapshot cannot clear a refund tombstone. Callback watermarks and recovery observations stay separate. A delayed reversal at or before the latest revoked-recovery observation cannot revive funds. SQL must enforce these rules atomically, including held and consumed amounts. `scripts/testPaidPurchaseRecovery.ts` covers these decisions and an actual 15-second hanging-transport deadline; see `tests/purchase-verification-receipt.json` for the final passing count and exact source hashes.

No live v2 permission, mapping, response, historical resend or recovery transaction has been verified here. The adapter is implemented and locally tested; **live recovery remains unqualified**. Before sales, prove the integrated reconciliation route or authenticated historical resend for missed events, plus pending UX that does not encourage another charge.
