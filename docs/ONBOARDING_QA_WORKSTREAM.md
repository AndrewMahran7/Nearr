# Onboarding and monetization QA separation

## Onboarding QA

- Worktree: `C:\Users\andre\Desktop\Nearr-worktrees\onboarding-v2-clean-baseline`
- Branch: `fix/onboarding-v2-clean-baseline`
- Purpose: test the Onboarding V2 journey, curated fixtures, anonymous saves, map/carousel/Queue, Settings, permissions, and account handoff.
- Runtime contract: ordinary shares use the Development-only `create_onboarding_qa_share_job_for_user` RPC. It creates `normal_free` jobs and never consults or mutates a wallet, entitlement, purchase, Pro, or RevenueCat object.
- UI contract: monetization and Premium Request entry points are absent. Development environment flags cannot re-enable them in this branch.
- Reset fallback: open `nearr://dev-qa`. `Reset onboarding only` preserves the current anonymous identity and product data; `Fresh anonymous QA user` signs out this device and immediately creates a different anonymous identity.

Do not merge `fix/dev-monetization-rpc-status`, `feat/nearr-monetization-experiment-v2`, or the contaminated integration commit `75adec8afc527e2bc48d9115527ac032e6ab42f8` into this branch.

## Monetization QA

- Worktree: `C:\Users\andre\Desktop\Nearr-worktrees\nearr-monetization-experiment-v2`
- Branch: `feat/nearr-monetization-experiment-v2`
- Purpose: test token balances, reservations, debit/refund, purchases, paywalls, Pro, RevenueCat, earned rewards, and monetization-specific RPC behavior.
- Onboarding is not the monetization test surface. Do not use the onboarding clean branch to qualify wallet or purchase behavior.

Development may retain monetization schema objects because other worktrees use them. The onboarding runtime is isolated by a separate service-role-only RPC and server-side Development project guards; schema coexistence is not runtime coupling.
