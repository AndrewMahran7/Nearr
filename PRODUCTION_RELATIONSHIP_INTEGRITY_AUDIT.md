# Relationship integrity audit (read-only Production snapshot)

Queries were aggregate/count-only against Production on 2026-10-08; the exact anomalous IDs are stored encrypted outside Git. FK-backed absence of orphans is a snapshot result, not an assumption about future writes.

| Check | Count | Classification |
|---|---:|---|
| `saved_place_sources.user_id <> saved_places.user_id` | 1 | **CONFIRMED_INVARIANT_VIOLATION**; completed v1 transfer artifact. |
| Save without auth user; source link without saved place; source link without auth user | 0 each | No orphan found. |
| Duplicate `(user_id,place_id)` saves; duplicate `(saved_place_id,identity_key)` links | 0 each | Unique constraints hold. |
| Job, result, media-task, notification, public-share-save, recognition-rejection, or onboarding-tutorial reference with a different saved-place owner | 0 each in the checked joins | No analogous owner mismatch found. Nullable references not counted as violations. |
| Canonical place saved by more than one user | 40 place identities | **EXPECTED_SHARED_RELATIONSHIP**; each user has an independent saved-place row. |
| Source `identity_key` attached under more than one user | 14 identities | **EXPECTED_SHARED_RELATIONSHIP** at the content level; distinct user-owned association rows. Do not dedupe across users. |
| Other users' links to `SOURCE_Y` identity | 4 | **EXPECTED_SHARED_RELATIONSHIP**. |

The only confirmed owner mismatch in these checks is `SOURCE_Y`. The audit does not claim every possible semantic inconsistency in all Production tables is absent. Parent/child owner equality is not a foreign-key constraint today; its INSERT/UPDATE child trigger can be bypassed by changing the parent owner. A periodic count query should remain a release gate until a deferred database-level invariant or equivalent proven mechanism closes that gap.
