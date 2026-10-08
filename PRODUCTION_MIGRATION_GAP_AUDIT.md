# Production/Development migration divergence — 2026-10-08

Read-only `supabase migration list --linked` against both projects: Production `rlqvxdwtetxsqxhqztkw` ends at `20260907000003`; Development `qnfxnmvxpjzfydgudtvs` has **15** later applied ledger versions. The old estimate of 14 was incorrect. The files below exist on the audited `release/nearr-1.5-ios` branch; commits identify their source. Development's ledger reflects all 15 as applied, but individual object definitions were only spot-checked (the two provider-name columns and two V2 RPCs exist). Ledger presence alone is not full schema verification.

| Version / file | Source commit | Purpose | Required for 1.5? / Production disposition |
|---|---|---|---|
| `20260908000001_development_history_marker.sql` | `8736e2a` | Inert Development history marker for collided qualification migration | No; never fake this history in Production. |
| `20260909000001_canonical_development_recognition_baseline.sql` | `8736e2a` | Recognition job/RPC baseline | No; recognition change excluded. |
| `20260909000002_curated_tutorial_fixtures_v1.sql` | `8bec855` | Server curated tutorial fixtures | No; 1.5 scripted fixture is install-local. |
| `20260910000001_token_monetization_v1.sql` | `bc94c39` | Token wallet/RevenueCat foundation | No; Development-only monetization. |
| `20260910000002_nearr_monetization_experiment_v2.sql` | `bc94c39` | Monetization experiment config | No. |
| `20260910000003_nearr_monetization_dev_revenuecat_binding.sql` | `bc94c39` | Dev RevenueCat identifiers | No; unsafe for Production. |
| `20260910000004_nearr_pro_event_column_qualification.sql` | `bc94c39` | RevenueCat RPC repair | No. |
| `20260910000005_fix_create_share_job_status_ambiguity.sql` | `bc94c39` | Token-aware share-job overload repair | No; not needed by current Production share path. |
| `20260910000006_onboarding_practice_entitlement.sql` | `bc94c39` | Dev practice entitlement | No; excluded. |
| `20260910000007_transfer_onboarding_practice_ownership.sql` | `bc94c39` | Dev practice ownership | No; excluded. |
| `20260910000008_onboarding_qa_non_monetized_runtime.sql` | `ae86911` | Dev QA fixture runtime | No; excluded. |
| `20260914000001_recognition_geography_state_consistency.sql` | `33c8007` | Recognition state/lead policy | No; output behavior could change. |
| `20260914000002_recognition_entity_role_latency_state.sql` | `9b0bda3` | Recognition geography/evidence fields | No; excluded. |
| `20260925000001_profile_provider_names.sql` | `6493f12` | Nullable names plus auth-trigger replacement | Columns yes; replace with narrow `20261008000001_nearr_15_provider_names.sql` **without** trigger replacement. |
| `20260928000001_onboarding_real_saved_place_transfer.sql` | `a8316a2` | V2 transfer grants/RPCs | Outcome yes; **not safe to copy** because duplicate branch deletes a saved row and child ownership/reference coverage is incomplete. A new Production migration remains blocked on design/rehearsal. |

No Development-only version will be marked applied in Production. No blanket `supabase db push` from the release/Development worktree is permitted. A future Production-only V2 migration must have a new timestamp after the current Production ledger and be proven against its actual schema. The nullable-name migration was rehearsed against a schema-only restore of Production `public` with auth stubs; see `PRODUCTION_PREDEPLOY_STATE.md`.

The schema restore exposed why a quick edit to the V2 SQL would not suffice. `saved_place_sources` enforces `user_id = saved_places.user_id` in a trigger; `saved_places` has a unique `(user_id,place_id)` constraint and an insert trigger that may queue AI-note media work; `saved_place_sources` insertion can update recognition source-note state. A duplicate-place transfer needs an explicit, non-deleting source/metadata merge policy, and a nonduplicate ownership move must keep child rows coherent. Neither is proven by the Development V2 migration or its current static tests.
