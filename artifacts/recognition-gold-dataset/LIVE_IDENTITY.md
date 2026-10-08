# Live identity and evaluation boundary

Read-only verification at 2026-10-08 23:26 UTC. This record describes the systems at collection start; it does not imply that this branch is deployed.

| Surface | Observed identity |
| --- | --- |
| `origin/main` | `ded040465176a193bba8c6921b179b07ef6a9a64` |
| Recognition R&D base, `origin/feat/recognition-pareto-optimization` | `72a525040b8f656c4dde69c7e135fa38980e3acc` |
| Dataset worktree / branch | `C:\Users\andre\Desktop\Nearr-worktrees\recognition-gold-dataset` / `audit/recognition-gold-dataset`, branched from recognition R&D base |
| Supabase Development (`qnfxnmvxpjzfydgudtvs`) | `create-share-job` v73; `process-share-jobs` v142; `process-share-link` v86; 80 migrations, latest `20260928000001` |
| Supabase Production (`rlqvxdwtetxsqxhqztkw`) | `create-share-job` v45; `process-share-jobs` v123; `process-share-link` v153; 65 migrations, latest `20260907000003` |
| Railway Development media worker | Deployment `11acd95c-90f3-407e-aefa-2f1d66fc05a9`, `SUCCESS` (15 September 2026) |
| Railway Production Nearr service | Deployment `6e78ebe9-58f7-4799-a90e-86238a1b14e9`, `SUCCESS` (8 September 2026); later `main` deployment `fee82c18-6652-449b-8f54-9868ad54dcc0` was `SKIPPED` |

Verification used `git rev-parse`, `git worktree list`, `supabase functions list`, read-only `supabase db query` against `supabase_migrations.schema_migrations`, and Railway project/service/deployment reads. The original `Nearr` worktree is on `integrate/safe-development-baseline` with unrelated uncommitted work and is outside this task's edit surface. There are many active worktrees; dataset development must remain isolated.

The benchmark tooling is offline. No evaluation command in this task should invoke live Development or Production recognition, update a recognition cache, or create application jobs. Any future paid baseline run needs an explicit bounded cost estimate and eval-only isolation. An offline score of stored model outputs must be identified as replay rather than a new live baseline.
