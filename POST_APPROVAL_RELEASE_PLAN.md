# Post-approval decision plan — do not execute in this task

Apple approval must leave 1.5.58 in **manual release** status. After founder physical QA of the exact processed build and legacy coexistence, the founder can choose a manual full release or an App Store phased release if available in the version record. Either way, keep the backward-compatible backend active for 1.4.55 users and watch auth/transfer/share/notification errors by client generation. Do not require an immediate update.

An optional later banner may say “Nearr 1.5 is available” with an Update action and Not now. It is not required for release safety. Implementing it for old runtime 1.4.55 would require a separately reviewed compatible OTA; **no Production OTA is published here**. A forced minimum-version gate is not recommended without a later security/compatibility justification.

Repository search found no existing remote minimum-version gate, recommended-version banner, or safe client-capability header on these backend requests. Diagnostics know the runtime for logging, and Settings has an App Store review-link helper whose ID is still null; neither is an update gate. Missing version/capability must continue down the legacy-safe path.

If QA fails after approval but before manual release, leave the version unreleased; fix backend or build through a separately reviewed candidate. Do not use destructive database rollback, silently replace the approved native artifact, or activate recognition/Jev/monetization/Railway changes as part of this release.
