# Nearr 1.5.58 client/backend contract

Release source `ca08c154347096fe5da0bf2739cf0b25c0b706b0`; EAS build `693249e5-f54c-4abd-b76d-cdb8bee9eb07`, iOS build 58, runtime 1.5.58, channel production, bundle `com.nearr.ios`, extension `com.nearr.ios.ShareExtension`.

The 1.5 app retains the current client contracts for auth, saved places, Queue, share-job creation/review/save, nearby reminders, push tokens, public-place sharing, settings, and account deletion. The material backend additions are:

1. `services/profileService.ts` **selects** nullable `profiles.first_name,last_name` on startup/profile recovery and upserts only non-empty structured Google/Apple names. These columns are absent in Production; current 1.5 profile reads will fail until added. Null provider names must not erase stored names. The existing auth trigger need not change because the client persists supplied names.
2. `lib/anonymousOnboarding.ts` calls `begin_onboarding_account_transfer_v2(uuid,text)` and `complete_onboarding_account_transfer_v2(text)` for cross-user anonymous-to-permanent conversion. The local scripted tutorial card is not a `saved_places` row, so an empty real-transfer set is valid. Same-user linking still calls `finalize_onboarding_identity_link`; interrupted transfers can call `resume_completed_onboarding_account_transfer`.
3. Share-result notification delivery may be immediate after a media finalize, but the payload type, `jobId`, title/body, tap route, and cron retry contract remain backward-compatible. The 1.5 foreground handler suppresses only a result already open for that same job.

Device-side photo snapshots (up to five), local onboarding fixtures, nearby-radius/category presentation, Watch post, and Share Extension state are primarily client contracts over existing Production data; they still need physical install/upgrade QA. The native extension is in the finished IPA, but physical handoff/old App Group state are not proven by static inspection.

The Development V2 migration at `20260928000001` is **not approved for Production as-is**: its duplicate-place branch deletes a source `saved_places` row and its transfer omits ownership-bearing `saved_place_sources` and other references. This must be redesigned and rehearsed before 1.5 backend parity can be claimed.
