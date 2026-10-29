# Durable host video admission — 29 October 2026

The 1.7 host `/share` route now sends every validated incoming URL to `ShareJobHandoff`, independently of the former async rollout flag. Pasting a link and submitting by button or keyboard uses the same handoff. The paste form retains the existing Fieldnotes components and translated copy. The route never mounts `LegacyShareScreen`; its historical synchronous helpers are not a fallback for admission errors.

The actual handoff still owns the persisted AI consent prompt, onboarding preparation and `hostShareSubmit` durable request. No local metadata parsing, recognition, Places lookup or save occurs in the new entry path. Quota/verification restriction UI is owned by the parent change: its CTA opens `/plus`; Retry preserves the original submission ID and returns through server admission. Consent/provider restrictions offer no payment bypass or network retry.

`scripts/testPaidHostShareIngress.ts` executes the real ShareScreen, ShareJobHandoff, AiSharePermissionPrompt, hostShareSubmit and createShareJob. Only native UI, authenticated session and network boundaries are fixtures. All network calls are intercepted locally; there are no live accounts, providers, purchases or deployments. Six groups passed:

1. Pasted button and keyboard submission: persisted consent precedes onboarding preparation, which precedes durable create-share-job. Legacy parse/extract/provider/Places/save operations are forbidden sentinels.
2. Incoming route URL works with the mocked legacy async flag false; incoming `sid` and trace order are preserved. A new URL needs permission again; cancellation creates no new job.
3. Invalid paste and ineligible consent cannot prepare or submit work.
4. Quota, consent and provider admission failures never start synchronous fallback.
5. Exhausted and unverified purchase access open `/plus` without submitting, then Retry uses the identical submission ID and URL. A fresh server consent denial cannot become queue acceptance.
6. Consent/provider restrictions expose neither Retry nor the purchase CTA.

Machine-readable receipt: `client/host-ingress-tests.json`. The existing map queue entry test passed after replacing its obsolete host flag assertion with a no-legacy-route assertion. The historical synchronous consent-function regression also passed, but it does not substitute for this new active-route test. Current native screenshots and real StoreKit qualification remain outstanding as stated in `PAYWALL_VISUAL_QA.md`.
