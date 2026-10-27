# Development handoff

Product source `4c424d9`; branch `fix/nearr-17-full-regression-android-qa`, descendant of verified integration c3317f0. No main merge. Final push/update receipts are added after successful delivery.

Android requires the new Development binary/runtime `1.7-onboarding-date-android-v2` for the native AV fix. An OTA cannot install that native change. Local debug x86_64 APK is provided with build/installed hash evidence. iOS JS changes remain compatible with existing Development build 3d96cf71-c507-449e-af77-3bfd7fd57f38, version 1.7.0/build 72/runtime `1.7-onboarding-date-v1`; physical iPhone QA is deferred, not passed.

Only the guarded Development update wrapper is authorized: explicit channel development and environment development, with environment validation before publication. Served manifests must match platform runtime and Nearr-Dev backend. No Production publication, infrastructure mutation, payments or recognition enablement.

Acceptance boundary: automated matrix green and extensive real Android flows verified. Runtime evidence retains a notification-broadcast ANR under host resource pressure, not reproduced in isolated configuration tests. Do not promote this evidence to public-release qualification without the remaining platform/release checks. Recognition provider/legal/consent qualification remains disabled; this task neither supplies an agreement nor overrides that decision. Sales remain disabled; no sandbox/live purchase success claimed.
