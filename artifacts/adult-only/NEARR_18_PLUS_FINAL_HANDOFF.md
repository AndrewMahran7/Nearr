# PASTE BACK TO CHATGPT

## A. STATUS

**PARTIALLY IMPLEMENTED / BLOCKED.** Adult-only changes are implemented locally; two additive Nearr-Dev migrations and rollback-contained SQL gates passed. Modified Edge, Railway worker and new native client are not deployed; physical/live Development qualification and full `test:prebuild` are incomplete. This is **not** a releasable or Production-ready candidate.

## B. PRODUCT POLICY

The founder's intended audience is exclusively people aged **18 or older**, without a parental-permission exception. The current public 1.4 app and Production services have not yet been changed, so the intended policy is not yet operational across public access.

## C. AGE ASSURANCE

Chosen prototype: account-bound, server-recorded self-declaration (`adult_self_declared`), with separate `pending`, `under_18` and `revoked` outcomes. It proves only the answer recorded for that Supabase account; it is **not** independently verified age. Underage/revoked accounts cannot repeat a checkbox to upgrade the same account. New-account recreation remains possible. Provider/counsel clarification is required before claiming the actual product is not likely to be accessed by minors under Gemini's terms.

## D. CLIENT

Offline Phase 1 remains local. Anonymous Phase 2 and permanent/restored sessions trigger the server-backed gate. Pending users can answer; underage/revoked see restriction, support/data path and sign out; failed/offline checks remain closed. The gate supports safe area and themes, but device UX, Google/Apple sign-in, navigation/reinstall and app switching remain untested. Legacy client-side direct Gemini dispatch was disabled in the new 1.5 fallback; only local heuristics remain there.

## E. BACKEND

Nearr-Dev migration `20261018000001_adult_age_eligibility.sql` adds RLS table, authenticated self-declaration RPC, service-role eligibility RPC and queue guards; `20261018000002_adult_dispatch_transition_guard.sql` denies claims of previously queued ineligible rows by an old worker. Local `create-share-job`/`process-share-link` reject before metadata; `process-share-jobs` checks claimed jobs and callbacks; worker checks task start and immediately before transcription/OCR/model calls. Unknown, underage, revoked and check errors fail closed. Ownership comes from JWT or stored job/task owner, never a client age flag. Only the DB migrations are deployed to Development.

## F. OLD CLIENTS

The planned 1.4.55/b55 protection is synchronous Edge denial plus queue/dispatch checks even with cached tokens. An adult can establish eligibility using updated 1.5 and should then retain access to existing saves and potentially the old client's recognition path. The actual 1.4 binary/extension compatibility and AI-permission contract have **not** been replayed; no forced update has been configured.

## G. SHARE EXTENSION

The new extension distinguishes server age denial from acceptance and states no job was queued; the host handoff does likewise. This requires a replacement native build, not OTA. Old extension behavior can only be protected by deployed server gates. No physical extension cases have run.

## H. EXISTING USERS

Nearr-Dev existing users were left unknown: 42 pending, zero automatically adult/underage after migration. Saved places, source links, jobs and accounts were not deleted or reassigned. Anonymous adult-declaration transfer to a pending destination and preservation of a destination's underage decision passed a rollback-contained SQL test, not a device E2E test. Production data is unchanged.

## I. GOOGLE TERMS

Retrieved 2026-10-18: [Gemini API Terms](https://ai.google.dev/gemini-api/terms) and [Google Cloud Service Terms](https://cloud.google.com/terms/service-terms) contain the relevant under-18 directed/likely-accessed restriction. The actual worker uses Gemini Developer API. Local gates help but are not deployed and self-declaration may be insufficient to resolve “likely to be accessed.” Do not claim provider compatibility without qualified contractual advice or Google's clarification. No recognition models were changed.

## J. PRIVACY

Unpublished clean drafts and redline: `NEARR_18_PLUS_PRIVACY_POLICY_REVISED.md` (SHA-256 `27d7fcc71f8cc3c328c27bf411ea8a8df30e8f47ea19b43c133ab04fb674ee01`), `NEARR_18_PLUS_TERMS_REVISED.md` (SHA-256 `86fec380c275be7d1a79878e2f2aac2c9afd9879b2f56d3b49648d7a1f43d6f1`), `NEARR_18_PLUS_LEGAL_REDLINES.md`. Baselines: approved policy draft SHA-256 `9f4b7291aa909f93a13e88310441977e7d068c0320d2249c90efb9a5abf181e4`; published Terms SHA-256 `2730d8b0d874db714214f0a18c11c898f70f8c64093401bc6dfa44c0b657686d`. Operator Andrew Mahran (individual), monitored `andrew.mahran@icloud.com`; website 90-day attribution disclosure retained. Effective date and canonical publication URL need founder approval. Existing per-share AI prompt passed local tests, but durable backend permission and old-client handling are unresolved under [Apple §5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/). Nothing published.

## K. APP PRIVACY

Age decision is account-linked, minimal new data; Apple category mapping needs the actual data-type definitions reviewed. Prior unresolved Google Maps/Places, ScrapeCreators, Tracking, `Other Data Types`, and authentication-verifier questions remain. No ASC privacy answers were saved.

## L. APP STORE

Previously reported draft: 1.5.58, Prepare for Submission, Manual release; current public 1.4.55/b55. Existing EAS build `693249e5-f54c-4abd-b76d-cdb8bee9eb07` / build 58 / runtime 1.5.58 / source `ca08c154347096fe5da0bf2739cf0b25c0b706b0` **does not contain this age/extension work**. New build number and ASC state need recheck. Edge ASC tab timed out twice in this pass. Review 18+ rating/override, region-specific values, nine prepared international listings and 126 candidate screenshots without implying translated UI or importing 1.6 assets. No build uploaded/submitted/released.

## M. TESTS

PASS: app typecheck; worker TypeScript build; Deno age helper (2 tests); worker no-provider negative dispatch test; share-job-client 403/no false success; privacy-policy, Terms (direct script), AI permission, onboarding V2, Share Extension compact, release gate, Dev DB guard; rollback-contained Dev SQL adult/underage/RLS, anonymous transfer, and both queue requeue/claim guards. `git diff --check` passed. `test:prebuild` **did not pass**: first run exposed missing `.env.local` in the isolated worktree (fixed; Dev guard reran PASS); second run stopped at `test:update-args` because `eas` CLI is not installed. All later prebuild checks and physical/live Development proofs remain pending. Evidence/commands are in `AGE_ELIGIBILITY_TEST_RESULTS.md`.

## N. DEVELOPMENT

Supabase project `qnfxnmvxpjzfydgudtvs`: migrations `20261018000001` and `20261018000002` applied. Post-test persisted age decisions: zero; the pre-existing queued task remained queued and cannot be claimed without adult eligibility. No Edge function deployed: Dev `process-share-jobs` v142 was newer than the local base, and function source download failed safe-path validation; deployed source/rollback parity is unproven. No Railway deployment/config change: Dev worker `11acd95c-90f3-407e-aefa-2f1d66fc05a9` tracks `integrate/safe-development-baseline`, not this worktree. No EAS Dev/native build ID, IPA or OTA exists for this change. Development proof is incomplete.

## O. PRODUCTION PLAN

See `NEARR_15_PRODUCTION_AGE_ROLLOUT_PLAN.md`: founder-approved/quiesced cutover, preflight exact versions and trusted rollback/forward recovery, fresh encrypted backup/restore, additive DB, exact-source worker/Edge gates, old/new negative and adult positive checks, then monitored resume. Existing queued/in-flight work must be accounted for. Never roll back to unrestricted model dispatch or quietly disable Production recognition.

## P. GIT

Isolated worktree `C:\Users\andre\Desktop\Nearr\.tmp\nearr-1.5-adult-only`, branch `feat/nearr-15-adult-only-access`, starting commit `ca08c154347096fe5da0bf2739cf0b25c0b706b0`. Age-only commits: `6d7aa6e` (schema/Dev history), `1bda3ac` (Edge/worker), `1ffad18` (client gate), `e6f4983` (documentation), `bd395b8` (pre-rollout claim guard), and the documentation follow-up. Final HEAD is recorded in the terminal handoff. The original dirty `release/nearr-1.5-privacy-corrected` worktree was not changed. This isolated tree still has copied pre-existing privacy changes plus overlapping uncommitted 18+ Share Extension/share-route edits; no merge or push. Keeping overlapping dirty files uncommitted avoids accidentally folding the earlier privacy work into an age-only commit.

## Q. PRODUCTION

Production Supabase, Production Railway, public app, Production OTA, policy website and ASC were **not changed**. Only the two explicitly verified Nearr-Dev age migrations were applied outside local files.

## R. FOUNDER APPROVAL NEEDED

Consolidated later decision: approve a safe, potentially disruptive Production adult-only cutover **only after** Development gates and source parity pass; approve exact revised policy/Terms, effective date and canonical URL; resolve AI permission/App Privacy/Google provider-terms questions; approve replacement native build and eventual App Store submission separately. Manual public release requires another explicit instruction. There is no reason to approve Production now while technical/contractual gates remain open.

## S. NEXT STEP

Obtain exact deployed Development Edge v142 and worker source/rollback paths, isolate the age-only patches onto them, deploy to **Development only**, and complete real old/new client, queue, transfer and physical Share Extension proofs. Then resolve provider/legal and App Privacy questions before seeking Production approval.

## Founder Development QA commands (current local worktree)

```powershell
Set-Location 'C:\Users\andre\Desktop\Nearr\.tmp\nearr-1.5-adult-only'
npm.cmd run typecheck
npm.cmd run test:share-job-client
npm.cmd run test:onboarding-v2
deno test --no-config --no-check supabase/functions/_shared/ageEligibility.test.ts
Set-Location 'services/media-worker'
npm.cmd run build
node --import tsx --test tests/adultEligibilityDispatch.test.ts
```

`npm.cmd start -- --dev-client --lan --clear` is **not yet a verified live QA command** in this isolated worktree: its `.env.local` currently contains only `NEARR_DEV_SUPABASE_REF`, not the required Development public Supabase URL/anon key, and the age-gated Edge/worker plus replacement native extension build are absent. Do not point this app at Production to fill the gap. No `git pull --ff-only` is appropriate for this local, unpushed, dirty branch.
