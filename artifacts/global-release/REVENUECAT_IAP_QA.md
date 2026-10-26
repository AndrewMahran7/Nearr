# RevenueCat and Apple IAP QA

Status: server/client contracts pass offline and disposable-database tests; Store catalog and sandbox/device proof are absent. All sales switches are false.

## Implemented controls

- The native SDK only displays the one monthly package and opens StoreKit. Its `CustomerInfo` never grants access.
- Authenticated `plus-api` derives the Supabase owner, returns an opaque `np_<uuid>` RevenueCat ID only for a qualified account, and re-reads the subscriber from RevenueCat before applying a snapshot.
- Snapshots require the exact entitlement, product, Apple store, sandbox/production environment, purchased ownership, coherent billing dates, fresh verification and stable transaction period key.
- The webhook requires a constant-time bearer-secret match, bounded/validated event and identities, exact RevenueCat app/environment, then re-reads each subscriber. Database application atomically deduplicates the event hash and all transfer-side snapshots.
- Refund revokes immediately; cancellation retains access to paid expiry; verified billing grace uses its bound; expiry/free/malformed/foreign/stale data fail closed. Server authorization expires after 15 minutes and requires refresh for new recognition.
- Advisory locks and one ledger per job/period prevent concurrent overspend, retry duplication and allowance multiplication on transfer. Only an owned actual saved result consumes a find.

Local evidence: `test:global-monetization` passed 21 policy/source cases. `test:global-monetization-db` passed 28 PostgreSQL cases against the actual five global migrations. Deno checks pass for `plus-api` and `revenuecat-plus-webhook`. These tests use synthetic Store responses and do not prove Apple or RevenueCat configuration.

## Required sandbox matrix

| Case | Expected evidence |
|---|---|
| Product fetch/localized price | Exactly one monthly package, exact IDs, positive Store price string in each launch storefront. |
| Purchase success | Apple sheet completes; SDK alone grants nothing; server refresh records active entitlement and correct period/allowance. |
| Cancel/pending/error | Clear message, no entitlement, no lost saves, safe retry/restore. |
| Restore/reinstall/multiple devices | User-initiated restore, same Nearr account receives one entitlement and one allowance. |
| Account switch/transfer | Old owner loses access and new owner receives it atomically under the chosen RevenueCat restore behavior; no email or Supabase UUID is exposed to RevenueCat. |
| Renewal/cancellation/grace/expiry/refund | State and access bound match Store/RevenueCat; refund revokes; historical saves remain. |
| Webhook replay/collision/outage | Same ID+hash is idempotent, collision rejected, partial transfer rolls back, retry succeeds after outage. |
| Free/paid accounting | 3 free / 10 paid total, multi-place counts once, failure releases, Quick Check reserves, 7-day expiry cannot redispatch, concurrent requests cannot exceed limit. |
| Offline | Saved data remains usable; no stale client cache authorizes new paid recognition. |
| Youth controls | Purchase remains unavailable for non-adult policy rows; Store restrictions are respected, never bypassed. |

RevenueCat documents that restore must be user initiated and restore behavior can transfer a receipt between identified users. Its SDK cache can outlive current server state, which is why Nearr uses server verification for new recognition. References: [restore purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases), [restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior), [webhooks](https://www.revenuecat.com/docs/integrations/webhooks), and [Apple App Review payments rules](https://developer.apple.com/app-store/review/guidelines/).

## Current blockers

App Store Connect was not authenticated for this work; the product does not exist in verified evidence. RevenueCat has no verified Nearr Plus catalog/app ID/webhook configuration or dedicated server secret in the dossier. No sandbox transaction, refund, transfer, Ask to Buy behavior, localized price, signed StoreKit binary or reviewer flow has passed. Keep Plus hidden and unenforced until all are recorded.
