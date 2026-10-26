# Production rollout and rollback

Production remains unchanged. This plan cannot start until provider/legal, payment, native/device, compatibility and restore gates are evidenced.

## Qualified order

1. Freeze the final source SHA and attach all automated/live evidence. Confirm every intended market, provider, legal snapshot, App Privacy answer and IAP product.
2. Capture a fresh Production database backup and prove restore in isolation. Record row counts and ownership hashes for users, saved places, sources, jobs, eligibility, permissions, entitlements and webhook ledgers.
3. Deploy additive migrations with all qualification, sales and allowance switches false. Recheck old clients, saved data, export/deletion and queue integrity.
4. Deploy compatible Edge functions and worker from the same commit. Verify environment/project/service IDs, source fingerprint, health/readiness and that provider dispatch remains closed.
5. Run blocked/ineligible/withdrawn/legacy tests, then a bounded qualified adult canary only after provider and legal approval. Reconcile provider request IDs, place ownership, latency, failures and cost.
6. Configure and prove Apple sandbox and RevenueCat. Keep sales false until the exact signed binary passes purchase, restore, transfer, expiry/refund and saved-data checks.
7. Roll out regional/legal/recognition/purchase switches independently, starting with explicitly approved markets. Monitor queue age, authorization denials, provider calls/errors, false saves, webhook failures, entitlement freshness, allowance discrepancies and support reports.
8. Submit the signed native build with manual release. Public release remains a founder action after Apple approval.

## Containment and rollback

First disable the affected qualification switch: recognition route, market, purchases, sales or allowance enforcement. Stop worker dispatch if recognition integrity is uncertain. Preserve queues, ownership and saved data. A queued/retried job must reauthorize before work.

If source rollback is needed, deploy only a known compatible build that retains eligibility, consent, ownership and provider restrictions. Never restore Gemini/ungated dispatch or the legacy adult predicate. Retain additive tables and event ledgers. Reverse migrations, destructive queue cleanup or database restore require a separate impact review; reconcile post-backup writes and purchase webhooks before any restore to prevent duplicate work or erased entitlements.

Recovery is complete only after old/new client behavior, owned historical content, privacy/deletion routes, webhook replay/restore and blocked ingress are rechecked. No production rehearsal, restore-time objective or observed monitoring threshold is claimed yet.
