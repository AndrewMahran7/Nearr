# iOS candidate verification

**No Store-distribution candidate has been built or submitted.** Production recognition, store transaction and legal/disclosure qualification remain incomplete; the production build guard has not been bypassed.

Fresh EAS readback on October 29 confirms the latest completed iOS build before this integration is internal Development 1.7.0 (72), ID 3d96cf71-c507-449e-af77-3bfd7fd57f38, source 4346840b69749b4ff54a7c9bd2e0abb0e67c8b12. It predates this paid implementation. The candidate uses build 73 for a separate internal Development build; any actual request and result are recorded separately when executed. No build completion is implied by a local version increment.

The Development environment check passed against Nearr-Dev (qnfxnmvxpjzfydgudtvs). Native localization generation passed ten locales and forty host/Share Extension resources. Expected host/extension IDs are com.nearr.ios and com.nearr.ios.ShareExtension, shared app group group.com.nearr.ios, runtime 1.7-onboarding-date-v1. Artifact inspection, if available, must independently verify these and version/build parity.

Windows cannot run macOS codesign verification or an iOS simulator. No physical iOS installation, VoiceOver/font-scale audit, public-build-55 upgrade, StoreKit sandbox matrix or final Store signing claim is recorded. Embedded profiles and CodeResources inspection are narrower than signature verification and runtime QA.
