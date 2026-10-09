# Proposed narrow ownership repair — **DO NOT EXECUTE in this task**

Classification: **REPAIR REQUIRED**. The repair target is exactly `SOURCE_Y`, the one `saved_place_sources` row attached to `PLACE_X` whose child `user_id=USER_A` but parent `saved_places.user_id=USER_B`. Exact row/user/place/grant/session UUIDs are stored in `C:\Users\andre\AppData\Local\NearrBackups\2026-10-08-nearr-15-predeploy\ownership-anomaly-ids.dpapi`, encrypted with Windows DPAPI under the current account and not committed. The reviewer must recover/verify them securely; never paste them into a PR, log, or shell history.

## Before → after graph

- Before: `USER_B → PLACE_X`, `USER_A → SOURCE_Y → PLACE_X`; one completed grant `USER_A → USER_B`. The parent and child IDs, source identity, legacy mirror, notification event, and four other users' independent links remain as observed.
- After: `USER_B → PLACE_X → SOURCE_Y`; only `SOURCE_Y.user_id` changes from `USER_A` to `USER_B` (plus the existing updated-at trigger's timestamp). Preserve the parent/save ID, source-link ID, URLs/identity/AI note, grant, notification, global video row, and all four other user associations. **No row deletion, clone, parent move, or auth change.**

## Preconditions to reverify immediately before a separately authorized repair

1. Fresh restorable backup and exact Production project/ledger/function hashes; confirmed maintenance owner and no competing account-transfer operation. The previous local archive is a snapshot, not a current pre-repair backup.
2. Exactly one current mismatch, and its IDs/owners/place/identity still match the secured evidence. `USER_A` remains the anonymous source identity, `USER_B` the destination; the completed grant and session bind the pair and point to `PLACE_X`.
3. `PLACE_X` has no other child link with the same identity; `SOURCE_Y` is still its sole child. No new public-share `source_id`, job/result/media-task/rejection dependency has appeared without review. Existing `USER_B` notification ownership remains coherent.
4. Reviewer verifies user-facing behavior and approves this exact scope. Do not run a blanket `UPDATE ... WHERE user_id<>...`.

## Reviewed SQL transaction template (future authorized window only)

Load the six exact UUID parameters from the secured evidence through a protected session. This template is **not runnable without them** and is intentionally not executed here. Disable SQL echo/logging of bind values. `:source_link_id`, `:saved_place_id`, `:user_a`, `:user_b`, `:transfer_grant_id`, and `:onboarding_session_id` are psql bind variables, not literals in Git.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
-- Lock parent first, then child; inspect the matched row count before proceeding.
SELECT id FROM public.saved_places
 WHERE id = :'saved_place_id' AND user_id = :'user_b' FOR UPDATE;
SELECT id FROM public.saved_place_sources
 WHERE id = :'source_link_id' AND saved_place_id = :'saved_place_id'
   AND user_id = :'user_a' FOR UPDATE;
-- Require the completed grant/session binding, exactly one mismatch, and no
-- newly discovered dependent row. A reviewer must abort on any discrepancy.
SELECT count(*) FROM public.onboarding_account_transfer_grants g
 JOIN public.onboarding_v2_sessions s ON s.id = g.onboarding_session_id
 WHERE g.id = :'transfer_grant_id'
   AND s.id = :'onboarding_session_id'
   AND g.status = 'completed'
   AND g.source_user_id = :'user_a'
   AND g.destination_user_id = :'user_b'
   AND s.tutorial_saved_place_id = :'saved_place_id';

UPDATE public.saved_place_sources
   SET user_id = :'user_b'
 WHERE id = :'source_link_id'
   AND saved_place_id = :'saved_place_id'
   AND user_id = :'user_a';
-- REQUIRE UPDATE 1. The existing owner trigger must accept the new owner.
SELECT count(*) FROM public.saved_place_sources src
 JOIN public.saved_places sp ON sp.id = src.saved_place_id
 WHERE src.user_id <> sp.user_id;
-- REQUIRE 0, then rerun two-user RLS checks and confirm the source identity,
-- row ID, parent ID, unrelated-user link count, and notification state.
-- COMMIT only after every assertion is reviewed; otherwise ROLLBACK.
```

The above is a review outline, **not** an unattended migration: count results must be asserted by a guarded executor before `COMMIT`, and the secured IDs must never appear in committed SQL. A Production execution plan should encode those assertions as exceptions in the same transaction, verify no concurrent drift, and capture a redacted audit result.

## Isolated proof and recovery

`scripts/testOwnershipRepairDryRun.sql` on the isolated Production restore updated exactly one child, left one relationship row and the four unrelated-user source links intact, yielded zero mismatches, and made USER_B see parent+child while USER_A saw neither. A repeated `WHERE user_id=USER_A` update matched zero rows. The transaction then rolled back and the original mismatch count returned to one. This proves the narrow row correction against the restored schema, not live deployment or all future concurrent states.

Before commit, any failed assertion means `ROLLBACK`. After a mistaken commit, do **not** blindly set child owner back to `USER_A`: the owner trigger would reject it while `USER_B` owns the parent, and moving the parent could harm user data. Freeze further transfers, inspect the secured pre-image/current graph and backup, then use a separately reviewed forward correction. Restoration of an entire database is an incident-level last resort, not a routine row rollback.
