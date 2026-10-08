# Source and deployment provenance

Audit source: `286756a6896d0453b6033ede7aca18b2f63b4267`, `audit/recognition-research-2026-10-08`. The twelve audit reports were read before implementation. Local audit path: `C:/Users/andre/Desktop/Nearr-worktrees/recognition-research-2026-10-08/artifacts/backend-recognition-audit-2026-10-08/`.

Implementation worktree: `C:/Users/andre/Desktop/Nearr-worktrees/recognition-pareto-optimization`, branch `feat/recognition-pareto-optimization`, starting SHA **`45cedb7fc3e5d391e68295f60e2e097640008faa`**. Success gates were committed at `96aa2ce` before tuning. Baseline and experiment output manifests retain exact source and input hashes. Agent branches were merged into this isolated integration branch; the final integration HEAD is reported in the handoff because a commit cannot contain its own hash.

## Live reads before implementation and at integration close

| Surface | Development | Production |
|---|---|---|
| Supabase project | `qnfxnmvxpjzfydgudtvs` | `rlqvxdwtetxsqxhqztkw` |
| create-share-job | v73 | v45 |
| process-share-jobs | v142 | v123 |
| process-share-link | v86 | v153 |
| Migrations | 80; latest `20260928000001` | 65; latest `20260907000003` |
| Active Railway deployment | `11acd95c-90f3-407e-aefa-2f1d66fc05a9` | `6e78ebe9-58f7-4799-a90e-86238a1b14e9` |
| Worker source attribution | audit `d75177dd3c9e5011935a4f5209719f7d2947380f`; worker source identical at starting SHA | `e9daf499cfb276ea7072b651642a04218b90ccf9` |

The Dev Railway CLI-origin deployment does not expose a commit hash; its source attribution comes from the prior audit and empty worker diff, not an invented Railway metadata field. Production's newer skipped deployment `fee82c18-6652-449b-8f54-9868ad54dcc0` at `ded040465176a193bba8c6921b179b07ef6a9a64` is not the active worker.

The audit's earlier Dev process-share-jobs v141 was superseded by v142. The v142 entrypoint was downloaded read-only and its newline-normalized SHA256 matched starting source: `d0d2832acaed79791a9bab4deb0fd0d170a441bb727c28832236681f6d890c4a`. The CLI refused bundled imports outside its download directory; that restriction was not bypassed. This verifies the extracted entrypoint, not every remote bundle dependency. The saved Edge bundle hashes are in `evidence/live-provenance-start.json` and `evidence/live-provenance-end.json`.

Read-only commands included `supabase functions list --project-ref <ref> --output json`, a local scratch-project `supabase db query --linked --workdir .tmp/provenance/<lane> --file <audit migration-state.sql>`, Railway deployment listings, `git fetch origin --no-tags`, `git worktree list --porcelain` and current branch/source comparisons. Scratch project references did not relink another worktree. Start/end migration snapshots are retained under `evidence/`.

Relevant concurrent source lines were read, not merged indiscriminately: `fix/place-capabilities-images-notifications-nearby` at the starting SHA; `release/nearr-1.5-ios` / frontend audit at `ca08c154347096fe5da0bf2739cf0b25c0b706b0`; Jev shadow32 `b2fb4fc20755c5f7fd905011cd78f72e7d1b85b7`, Jev semantic-v2 `3222eed1a4282183103b419964a9985fea8a483e`; existing visual-retrieval branches and Sol-vs-Terra `409086d651eafe4da9da3717d8a5c4692a53a059`. The new architecture does not activate those experiment branches.

The final live reads match the implementation-start versions. No Edge, worker, migration, cache or real user record was deployed or mutated. The shared Dev lane had already advanced beyond the source audit; integration remains a separate coordinated step. Production was untouched.

## Workspace exception

An agent's mistaken dependency junction was followed by npm cleanup and the original workspace's dependency directory was observed empty. The root dependency tree was restored using its own lockfile (`npm ci --ignore-scripts`) and its existing patch-package patch was reapplied. The original workspace's pre-existing source changes were preserved. Subsequent dependency installs used actual isolated directories. The full account is in `SAFETY_SEMANTIC_DIFF.md`; this exception is disclosed rather than claiming the original worktree was never written.
