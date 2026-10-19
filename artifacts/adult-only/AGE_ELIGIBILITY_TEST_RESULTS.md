# Test results — 2026-10-18, local/Development only

Worktree: `C:\Users\andre\Desktop\Nearr\.tmp\nearr-1.5-adult-only`, base `ca08c154347096fe5da0bf2739cf0b25c0b706b0`, branch `feat/nearr-15-adult-only-access`. No replacement iOS binary or OTA was built.

| Command / proof | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS after local test declaration fix. |
| `npm.cmd --prefix services/media-worker run build` | PASS. |
| `node --import tsx --test tests/adultEligibilityDispatch.test.ts` in worker directory | PASS; denied owner caused zero media/transcription/OCR/model calls and terminal task/parent status. Required unsandboxed Node because sandbox `uv_os_get_passwd` returned ENOMEM before test startup. |
| `deno test --no-config --no-check supabase/functions/_shared/ageEligibility.test.ts` | PASS 2 tests; server decision false/error/missing owner fails closed. |
| `npm.cmd run test:share-job-client` | PASS, including new 403 age denial and no false durable-success reconciliation. |
| `supabase db push --linked --dry-run` | PASS; only `20261018000001_adult_age_eligibility.sql` pending, linked ref verified Nearr-Dev. |
| `supabase db push --linked --yes` | PASS; **Nearr-Dev only**, 2026-10-18. |
| Second `supabase db push --linked --dry-run`, then `--yes` | PASS; only `20261018000002_adult_dispatch_transition_guard.sql` applied to Nearr-Dev. |
| `supabase db query --linked --file artifacts/adult-only/dev_age_eligibility_transaction_test.sql` | PASS; unknown/adult/underage/locking/RLS/service-RPC tests in one rolled-back transaction. Follow-up persisted decision count = 0. |
| `supabase db query --linked --file artifacts/adult-only/dev_age_transfer_transaction_test.sql` | PASS; anonymous source declaration copied once to pending destination; existing underage destination stayed restricted; rolled back. |
| `supabase db query --linked --file artifacts/adult-only/dev_age_queue_guard_transaction_test.sql` | PASS after second migration; ineligible `share_jobs` and `share_media_tasks` requeue **and claim** transitions rejected before dispatch; rolled back. The pre-existing active task remained queued. |
| `npm.cmd run test:dev-db-guard` | PASS after adding this isolated worktree's minimal `.env.local` with only the Dev ref. |
| `npm.cmd run test:privacy-policy`, `npm.cmd run test:ai-share-permission`, `npm.cmd run test:onboarding-v2`, `npm.cmd run test:share-extension-compact`, `npm.cmd run test:release-gate`; direct `npx.cmd ts-node -P scripts/tsconfig.json scripts/testTermsRelease.ts` | PASS. `test:terms-release` is not a package script; the direct test command passed. |
| `npm.cmd run test:prebuild` | NOT PASS. First run stopped at `test:dev-db-guard` because this new worktree initially lacked `.env.local`; fixed and retested that script. Second run stopped at `test:update-args` because `eas` executable is not installed in this environment. Remaining prebuild tests did not run. |

Unrun or incomplete gates: actual adult/unknown/underage authentication/share/save/map flows; Google/Apple sign-in; real anonymous-to-permanent transfer and concurrency (only a rolled-back SQL trigger test passed); 1.4.55 binary/extension direct calls; age revocation during transcription/model call; real provider-call absence; physical extension; deep link/reinstall/account switch; current Development Edge and Railway worker. `git diff --check` and final hashes/status should be rerun after all edits.

No assertion here that the Dev migration alone protects deployed old clients or worker dispatch. No Production compatibility proof has been obtained.
