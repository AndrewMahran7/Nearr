# Fieldnotes integration and release evidence

Prepared 20 October 2026 (US Pacific). This is a source-integration and qualification handoff. The unified candidate is not a verified Production release, a replay of a founder recording, or a newly accepted physical-device build.

## Preserved source lineage

| Checkpoint | Exact source | Evidence |
| --- | --- | --- |
| Latest supplied Fieldnotes source | `99db449b26131a0c02d8642332832a74bd1440ec` | `Clean physical QA source formatting`; preserved as the integration merge's first parent. |
| Fieldnotes + existing age-aware Development baseline | `08b296113ce4a75638e49da9a0c76ed57b39a62f` | Merge parents are Fieldnotes `99db449…` and Development baseline `3eea578d30ce1cd4a913320cc33301de03d96194`. |
| Corrected privacy baseline | `78502d13a64fdf7090ceb9b33e7eb4bdba55f280` | `Preserve corrected privacy notices and permission prompts in Fieldnotes`, directly following the merge. |
| New global contracts | `2c54ff1` and `ad6f111` | Additive eligibility/consent/Plus/language database contracts and ineligible-queue claim filtering. Their presence in Git is not proof of a remote deploy. |

The preserved dirty privacy worktree was inspected read-only. Its older draft content, privacy release gate, AI-permission work and unresolved disclosure evidence were reconciled into the new candidate rather than discarded or represented as new approvals. The user's verified operator/contact facts are retained. No unrelated worktree cleanup or destructive reset was performed by this review.

## What the inherited October 18 evidence establishes

Read sources: `C:/Users/andre/Desktop/Nearr/.tmp/fieldnotes-oct18-detail-review/OCT18_DEVELOPMENT_RELEASE_HANDOFF.md`, [October 18 comparison](../fieldnotes-oct18/OCT18_COMPARISON.md), [native-evidence note](../fieldnotes-oct18/README.md), and [review/extension implementation notes](../fieldnotes-implementation/REVIEW_AND_EXTENSION_PHASE.md).

That earlier handoff describes a Development frontend OTA on runtime `1.6.59`, group `3cc30077-3ff3-46d8-9d74-e923ee1592a0`, source `aa96cdbdc558ba48980fe9cca3d418773f3c7eb5`. This is historical evidence, not the current candidate's update group or a fresh publication performed here. Later Fieldnotes fixes are represented by the source ancestry above.

The inherited comparison records source/tests for 90–95% expanded detail height; a fixed opaque name/Close/More header; reminder-switch space; actual marker canvas and camera clearances; no hidden-map correction while expanded; authoritative Quick Check completion/reconciliation; honest Phase 2 and missing-media fallbacks; local saved-image reuse; and status-bar ownership. Those tests and historical notes are useful integration contracts. Their own capture notes explicitly state the native recording/device surface was unavailable and founder physical review remained required. No mock or HTML image is upgraded to native evidence here.

## What was integrated into that frontend

- The existing Fieldnotes map, saved-place detail, Activity, Quick Check, source-gallery, onboarding and settings structures remain the starting UI. Locale subscriptions and translated complete messages/count forms were added to those real surfaces rather than a separate demonstration screen. Names, notes, addresses, URLs and source content remain user/source data.
- The localized age/country declaration surrounds new onboarding. Server eligibility, a distinct current Terms choice and AI-sharing permission precede new recognition. Existing permanent accounts retain a route to saved-data and account controls. Host and extension permission screens bind writes to the current identity and reject stale asynchronous results. See [age/consent implementation](AGE_ELIGIBILITY_AND_CONSENT.md).
- The candidate introduces Nearr Plus UI, verified entitlements and restore/manage paths with qualification off. Paid recognition is not used to gate previously saved places or privacy requests. Product configuration and native purchase proof remain separately incomplete.
- The runtime legal viewer keeps approved snapshot behavior and separates a clearly unapproved English Development review draft. The current null approved privacy snapshot creates no presentation receipt. Source review drafts do not constitute legal publication or consent.

The current app version is the root-selected `1.7.0` internal candidate with app-version runtime policy. Native changes include locale resources/bridge behavior and the RevenueCat SDK; the old `1.6.59` OTA alone cannot qualify or deliver all of these native changes. Root's final build record, not this source note, is authoritative for any generated binary number, EAS build ID, signing result and distribution status.

## Validation and its limits

Focused reruns passed the actual component review harness (24 renders across light/dark, width/text configurations and photo counts), Phase 2 grouped UI contracts, candidate-confirmation V2 and multi-place redesign behavior. Localization, onboarding, auth, privacy and permission regression suites are documented in their own validation records. Source/host-mock rendering cannot establish native geometry or VoiceOver behavior.

`scripts/testRecognitionConsentBoundary.ts` executes the **complete actual host `runSaveFlow` function**, extracted with the TypeScript parser and transpiled with explicit mocked service/state boundaries. It passes fresh-server-authorization-before-source-parsing, pending authorization, missing/malformed/denied decisions, changed-owner and signed-out states, and null/throwing backend responses. The latter never invoke client AI, Places, save or the old manual fallback. No source content or credentials reach a live service in that test.

The new [Linux iOS prebuild success log](native-prebuild-linux-success.log) records exit 0 for Expo `prebuild --platform ios --no-install`. Native project generation succeeded with 20 host/extension `InfoPlist.strings` and 20 host/extension `Localizable.strings` files across the ten locales. `--no-install` skips CocoaPods. This proves neither Swift/Objective-C compilation, Xcode signing, a runnable IPA, simulator execution, Share Extension embedding nor physical iPhone appearance. The final repository matrix passed 143/143 scripts; see the root QA report for its scope.

Catalog parity and placeholder checks establish that extracted keys have translations. They do not prove every computed runtime message is extracted or that translations are native-reviewed. The final literal migration scan found zero remaining automatically migratable literals, and the repository matrix passed after source contracts were updated to require translation calls. No native-language certification or physical-device localization acceptance is claimed.

## Remaining physical review

Use the final candidate binary and record its version, runtime, build/source identity, account state, locale and device/text settings. Recheck compact pins at screen edges; expanded detail/header scrolling and last-row clearance; reminder wrapping/switches; Quick Check success, double-tap, stale response and dismissal; map dock restoration; exact source/fallback imagery; gallery persistence; light/dark status-bar continuity; and relaunch. Repeat material consent, restriction, subscription and restoration screens with long French/German text and Japanese/Korean/Simplified Chinese. Review actual iOS host-extension safe areas, gestures, VoiceOver, largest Dynamic Type and appearance continuity.

Until those results exist, the source integration and tests can be described as passed within their recorded scope. The final native layout, physical-device experience, Store availability and Production release remain unverified. No founder recording was replayed or newly certified by this work.
