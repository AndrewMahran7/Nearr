# Pseudonymous anomaly timeline

`USER_A` = anonymous source-link owner; `USER_B` = established permanent saved-place owner; `PLACE_X` = the one saved-place row; `SOURCE_Y` = the Instagram association row. Exact internal UUIDs are **not committed**. A DPAPI-encrypted ID map (`ownership-anomaly-ids.dpapi`) is kept in the access-restricted local backup directory described in `PRODUCTION_BACKUP_AND_RESTORE_REPORT.md`, outside Git. No email/name, URL, place name, location, or content identifier appears here.

| Time (UTC, 2026) | Evidence-backed event |
|---|---|
| Apr 27 | `USER_B` auth account created; it predated onboarding. |
| Sep 5, before 06:56:53 | `USER_A` anonymous auth account created (date known, exact time not recorded in this report). |
| Sep 5 06:56:53 | Onboarding session created, later recording `USER_A` as anonymous and `USER_B` as permanent identity. |
| Sep 5 06:59:12 | `PLACE_X` and `SOURCE_Y` created/attached with the same timestamp under `USER_A`; `SOURCE_Y` remains the sole child of that save. |
| Sep 5 06:59:14 | Transfer grant created for `USER_A` → `USER_B`. |
| Sep 5 06:59:28 | Grant completed; session became `permanent_account` and now points to `PLACE_X` owned by `USER_B`. Grant result says destination was established and points to the same saved-place ID. |
| Sep 5 06:59:28 (inferred) | Live v1 `complete_onboarding_account_transfer(text)` took its **unique-place branch**: it updates `saved_places.user_id` to destination but never mentions `saved_place_sources`. The row ID survived; a duplicate-place branch would have deleted the source save and cascaded the child. The live function MD5 is `5488e1042ca24f20d8a5d5db910fd40c`, and code inspection confirmed both statements. The grant timestamps and surviving child make this cause high confidence, though a historical SQL invocation log was not available to prove the exact statement execution. |
| Sep 9 21:13:40 | A `nearby` notification event was recorded for `USER_B` and `PLACE_X`; the save's `updated_at` matches. The source-link `updated_at` still equals its Sep 5 creation time. |
| Oct 8 | Read-only Production and the isolated backup restore each show exactly one source/save owner mismatch. |

Other same-content links belong to four other users; they are distinct user-owned associations, not duplicates to delete. No share job, result, media task, rejection, or public share points to this particular save/source row. These are snapshot observations, not a guarantee that no new references can arise later.
