# Nearr 1.7 Development onboarding integration

## Source and boundaries

Verified local and remote unified baseline: `6e4096a34bb4a09b66227474659d753670d3764f` on `integration/nearr-global-fieldnotes-monetization` (the supplied `001eea5` was outdated).

Verified feature reference: `64484e0d56dc52a1987369afaa709f20832d9bd7` on `feat/nearr-17-onboarding-birthday-language`.

Integration branch: `codex/nearr-17-onboarding-ios-integration`, worktree `C:\Users\andre\.codex\worktrees\nearr-onboarding-ios-integration\Nearr`.

The three approved feature commits were cherry-picked onto the verified unified baseline as `07ee936`, `eb855ca`, `5c83851`. The resulting tree was identical to feature HEAD. No feature was reimplemented. The primary dirty checkout and both original reference worktrees were preserved; neither original branch was moved. No merge to main.

Native reconciliation: `fcf2c78`. Android regression exposed inherited untranslated dynamic tutorial/account copy; presentation-only fixes are `0a937ab`, `5539bc3`, `4346840`. The final application/native-build source is `4346840b69749b4ff54a7c9bd2e0abb0e67c8b12`. Later commits contain qualification tools and evidence only; the final pushed qualification HEAD is reported in the final chat handoff. `DELIVERY_RECEIPT.json` records the immutable source/build/update checkpoints.

## Integrated behavior

Language → birthday/residence → welcome and offline practice → account/consent. The old combined form is not restored. Ten bundled locales and a persisted explicit language choice remain. Dynamic interest choices, personalized labels, account entry-intent copy, and tutorial sentences now use translations, with catalog/source assertions added. Source videos, place names, and source captions are not translated user/content data. New translations require native-speaker review.

Birthday remains transient React state. Only an age band and residence country are persisted/submitted; no DOB is added to analytics, storage, routes, or RPCs. This is self-declaration, not independent age verification. Local assessment never authorizes backend recognition; existing server-authoritative age, regional eligibility and AI-consent gates remain.

Permanent-session restore, existing eligible-account bypass, missing/restricted eligibility, owned anonymous declarations, account switching and transfer were exercised by automated contracts. Real Google/Apple authentication, account switching and reinstall on a physical iPhone remain founder QA—not claimed as executed.

## Safety

No Supabase migration/reset, Edge/Railway deployment, provider activation, payment/storefront activation, legal publication, Production OTA, App Store submission, or main merge. Existing Plus infrastructure stays present with storefront suspension. Development EAS native builds are the only native distribution created. The infrastructure safety skill informed lane verification; it did not cause any backend configuration changes.

## Evidence

- `ONBOARDING_NATIVE_RUNTIME_RECONCILIATION.md`
- `ONBOARDING_INTEGRATION_TEST_RESULTS.md`
- `ONBOARDING_ANDROID_REGRESSION_QA.md`
- `ONBOARDING_IOS_BUILD_VERIFICATION.md`
- `ONBOARDING_FOUNDER_IPHONE_CHECKLIST.md`

Important: expanded legacy suites have known baseline failures. This is a Development physical-QA candidate, not an all-green Production release certification.
