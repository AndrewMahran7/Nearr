# Final migration rehearsal — 2026-10-09 UTC

Status: **PASS on the fresh restored Production clone; NOT deployed.** Source database `nearr_release_restore_20261009`, migrated clone `nearr_release_migrated_20261009` on isolated PostgreSQL 18. Applied only the six files below, in order, one at a time. Mismatch count remained zero after each.

| Migration | Purpose / affected objects | Old-client impact / 1.5 dependency | Recovery |
|---|---|---|---|
| `20261008000001_nearr_15_provider_names.sql` | Nullable `profiles.first_name,last_name` | Additive; old selectors unchanged / provider name write | Restore backup or forward-repair columns |
| `20261009000001_saved_place_source_owner_invariant.sql` | Composite key/FK on `saved_places`, `saved_place_sources`, cascading parent owner | Makes V1 moves coherent / V2 prerequisite | Restore or carefully forward-repair constraint |
| `20261009000002_safe_onboarding_account_transfer_v2.sql` | V2 begin/complete/cleanup RPCs | Additive V2 signatures / required by 1.5 | Restore or replace RPCs with qualified version |
| `20261009000003_legacy_transfer_source_preservation.sql` | Replaces legacy V1 complete RPC | Preserves old signature and source graph / compatibility | Restore or forward-replace V1 RPC |
| `20261009000004_converted_source_write_guard.sql` | Source owner trigger/function | Rejects stale converted-anonymous writes / source preservation | Restore or forward-replace trigger/function |
| `20261009000005_converted_anonymous_save_write_guard.sql` | Saved-place insert trigger/function | Rejects stale converted-anonymous saves / no hidden post-transfer saves | Restore or forward-replace trigger/function |

The rejected Development V2 candidate remains outside deployable migrations. No monetization, Jev, recognition, Railway, or unrelated schema was promoted. No blanket `supabase db push` was used.

All seven restored-database SQL suites passed: owner invariant, V2 core, V2 security/RLS, V2 failure injection, V1 transfer safety, source-attachment client contracts, and dual-client database contracts. The separate 120-pair release concurrency gate passed (20 per six required race classes), zero mismatches and deadlocks. Row counts and hashes remained: saves 627 / `4bfa724ce637ac7b1b13f9ed5d1f8247`; sources 545 / `f7cf15619f14760f6ce7af18d733144d`; auth users 105 / `e90cadd351ac6aa04484845fb8d3ff29`. All 105 preexisting profile fields hashed unchanged after excluding the two new null name columns; neither new column was backfilled.

This proves migration behavior on the captured data, not a live old/new client smoke test or safe authorization to deploy while notification remains red.
