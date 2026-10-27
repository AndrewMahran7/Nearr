# Ten test fixes

The approved contracts are the localized 1.7 onboarding, shared Fieldnotes visibility owner, and `MONETIZATION_EXPERIMENT.md` plus `lib/premiumRequests.ts` (Premium initiation is unconditionally suspended on this product surface). The retired token store was removed in `ae86911`; restoring it would contradict this candidate.

All original npm entrypoints remain in the exact matrix; several gained additional regression coverage. No test is skipped. Source assertions now require the translated JSX and exact interpolation bindings, not loose matching of arbitrary visible words. The rendering harnesses use the real bundled translation engine instead of returning undefined for translation imports. Shared map visibility and pointer events replace obsolete duplicated inline checks. Legacy wallet, reservation, purchase replay, ownership, service-role and settlement assertions remain enforced even though the sales UI is suspended.

The three monetization suites distinguish preserved legacy accounting infrastructure from the current Plus product. Obsolete token-offer assertions become negative assertions against accidental storefront reintroduction and positive checks for qualified Plus offers, server-localized price, disabled/unavailable messaging, verified outcomes, and saved-place access. No live purchase or provider success is inferred from these tests.

Evidence: `baseline/results.json` (ten failures before edits), `ten/results.json` (ten passing after fixes), `full/results.json` (complete original matrix). Local logs are retained alongside these receipts.
