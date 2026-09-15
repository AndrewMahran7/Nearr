# Development migration reconciliation

Date: 2026-09-15
Target: Nearr-Dev (`qnfxnmvxpjzfydgudtvs`) only

## Root cause

Versions `20260910000001` through `20260910000005` were deployed from a parallel Development-only monetization lineage. Versions `000006` and `000007` followed from the Development onboarding-practice lineage that inherited that database state. The later Priority-1 recognition lineage started from a different Git ancestry and never merged those branches. No Git commit deleted the seven files; the Dev database advanced while the subsequently selected source lineage did not contain their commits.

The remote registry therefore remained correct while `supabase/migrations/` in commit `497e4f49162ce45a40f351eb6e2f18b9b51a96fa` was incomplete. The database guard correctly treated those remote-only versions as unknown and stopped before `20260914000002`.

Versions `000001`-`000005` are monetization/RevenueCat schema and RPC work. Versions `000006`-`000007` are bounded onboarding-practice entitlement and ownership-transfer work, not a general token grant. All are canonical applied Development migrations.

## Registry evidence

`supabase_migrations.schema_migrations` has only `version`, `statements`, and `name`; it has no applied-timestamp column. The CLI's displayed UTC values (`00:00:01` through `00:00:07`) are derived from the version numbers, not independently recorded application times. The registry does retain the exact executed statement arrays.

| Version | Remote name | Statements | Normalized registry MD5 |
| --- | --- | ---: | --- |
| 20260910000001 | token_monetization_v1 | 56 | b4e870db18311dc15af66a972318d0f8 |
| 20260910000002 | nearr_monetization_experiment_v2 | 61 | 17b0f1aeb724957109421a48766ecab8 |
| 20260910000003 | nearr_monetization_dev_revenuecat_binding | 1 | c92f1e3d8e31381df9afd229044d28fb |
| 20260910000004 | nearr_pro_event_column_qualification | 3 | d6fec1ed75942172248b1a55475cbb8b |
| 20260910000005 | fix_create_share_job_status_ambiguity | 7 | 580d9a08a59dde0ff6f56e47997d1d0e |
| 20260910000006 | onboarding_practice_entitlement | 30 | a25daa32d6fb1d754e76161d6b71ffc3 |
| 20260910000007 | transfer_onboarding_practice_ownership | 3 | b3c64d3bb10c2a321837d3a49000d9c5 |

## Provenance and action

| Version | Remote | Canonical source | Source file | Dev verification | Action |
| --- | --- | --- | --- | --- | --- |
| 20260910000001 | applied | `feat/nearr-monetization-experiment-v2` / `42214ce467ff1ae5d64c69603d7818c153c9654b` | `supabase/migrations/20260910000001_token_monetization_v1.sql` | exact 56-statement fingerprint plus V1 tables/RLS/columns/indexes/policy/functions/triggers/grants | restore exact blob; no replay |
| 20260910000002 | applied | `feat/nearr-monetization-experiment-v2` / `2159f11be2d4b2b794c5877893dcb164ef53ad15` | `supabase/migrations/20260910000002_nearr_monetization_experiment_v2.sql` | exact 61-statement fingerprint plus V2 tables/RLS/policies/contracts/functions/trigger | restore deployed post-alignment blob; no replay |
| 20260910000003 | applied | `feat/nearr-monetization-experiment-v2` / `bdc7bb19c2caa2c190a19a369b16c985271f6806` | `supabase/migrations/20260910000003_nearr_monetization_dev_revenuecat_binding.sql` | exact statement and public catalog binding preserved | restore exact blob; no replay |
| 20260910000004 | applied | `feat/nearr-monetization-experiment-v2` / `bdc7bb19c2caa2c190a19a369b16c985271f6806` | `supabase/migrations/20260910000004_nearr_pro_event_column_qualification.sql` | exact statements; qualified 16-argument service-role RPC | restore exact blob; no replay |
| 20260910000005 | applied | `fix/dev-monetization-rpc-status` / `75adec8afc527e2bc48d9115527ac032e6ab42f8` | `supabase/migrations/20260910000005_fix_create_share_job_status_ambiguity.sql` | exact statements; zero-default nine-argument service-role RPC and aliases | restore exact blob; no replay |
| 20260910000006 | applied | `fix/onboarding-v2-hands-on-activation` / `12afff69f8fbcc538ba17ae3942190ff80813683` | `supabase/migrations/20260910000006_onboarding_practice_entitlement.sql` | exact statements; practice tables/RLS/indexes/functions/triggers/billing superset | restore exact blob; no replay |
| 20260910000007 | applied | `fix/onboarding-v2-hands-on-activation` / `d30f0214a0be639b50d08f807a712a22b2c2c02a` | `supabase/migrations/20260910000007_transfer_onboarding_practice_ownership.sql` | exact statements and ownership-transfer function body/comment | restore exact blob; no replay |

`20260910000002` is the only file changed after introduction: `42214ce` introduced blob `0dc2eb1a...`; merge `2159f11` aligned it to blob `9d399927...`. The remote statement array matches the latter exactly, proving it is the deployed canonical content. No other final-name file has a later content edit.

## Structural proof and reconciliation result

`scripts/verifyDevelopmentMigrationReconciliation.sql` is a bounded, read-only `information_schema`/`pg_catalog` proof. It returned 14/14 passing checks and reads no user rows, balances, purchase events, or secrets. `scripts/testDevelopmentMigrationHistory.mjs` independently validates exact Git blob SHAs, exact remote statement fingerprints, uniqueness, monotonic ordering, required Dev-only provenance, unknown-remote refusal, and no-replay protection.

After restoring the seven blobs, `supabase migration list --linked` aligned every historical local/remote version and showed only `20260914000002` pending. No `migration repair` command was used. No historical SQL was executed. No database reset occurred.

The historical database row keeps the experiment's catalog binding and ledger schema intact. Runtime suspension is separate: the three Development Edge secrets and three EAS client flags are explicitly `false` and remain the enablement authority for QA.
