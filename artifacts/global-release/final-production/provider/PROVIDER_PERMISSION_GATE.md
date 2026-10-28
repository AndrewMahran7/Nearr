# Final recognition permission gate

Reviewed 27 October 2026 (America/Los_Angeles); checks completed 28 October 2026 00:03:52 UTC. Source baseline: `3dbf10278368c2074afa095627b71be21f24aaa3`. This is an engineering release decision, not legal certification.

## Decision

**BLOCKED for the intended 13+ consumer release. Keep recognition disabled and do not submit an app advertised as functioning recognition.** Select the existing bounded OpenAI Responses adapter as the preferred qualification candidate. Do not change Nearr to adult-only, enable Gemini, obtain a new paid contract, or treat the presence of a key as permission.

OpenAI does not categorically prohibit minor-facing API applications. Its ordinary applicable API agreement may be sufficient; a negotiated exception or bespoke commercial contract is not universally required. The concrete unresolved condition is guardian authorization plus the appropriate safeguards, account settings and processor/source-media permissions—not an invented requirement for an enterprise sales deal.

## Current primary terms, checked directly

| Evidence | Applicable finding |
|---|---|
| [OpenAI Services Agreement](https://openai.com/policies/services-agreement/), updated 1 December 2025, effective 1 January 2026 | Sections 2.2 and 3.2 cover customer applications and their end users. Section 3.3(c) requires parent/guardian consent for minors. Sections 3.2, 4.3 and 5.3 address necessary consents, input rights and the incorporated DPA. Establish the actual account's governing terms/amendments rather than assuming an exception. |
| [Service Terms](https://openai.com/policies/service-terms/), updated 16 October 2026 | API use must follow applicable documentation. Visual-capability restrictions include identifying people or inferring their private/sensitive information. Nearr's physical-place purpose must remain bounded; source frames containing people do not authorize identity or private-address inference. |
| [Under-18 API guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance), retrieved 27 October 2026 local | Requires reasonable age-appropriate safety measures. Relevant examples are disclosures, content filtering, monitoring/reporting/escalation and age assurance where required or appropriate. It addresses ZDR before processing personal data below 13 or the applicable digital-consent age. This is not a blanket ZDR rule for every 13–17-year-old. Higher local minimums and exclusion of under-13 users remain unchanged. |
| [Usage Policies, revision effective 29 October 2025](https://openai.com/policies/usage-policies/revisions/2025-10-29/) | The current top-level policy page unexpectedly displays a **future** effective date of 20 November 2026. Its own Previous Version link resolves to this 2025 revision; use the effective revision for this 27 October review and recheck at activation. Minor-safety restrictions include age-inappropriate content, dangerous challenges and underage access to age-restricted goods/activities. No inference that the future version already applies is made. |
| [API data controls](https://developers.openai.com/api/docs/guides/your-data), retrieved 27 October 2026 local | Default abuse-monitoring logs can retain content for up to 30 days, subject to exceptions. ZDR/MAM require separate approval and project/organization configuration. `store:false` alone does not establish zero retention. Endpoint/features and image-safety exceptions matter. No actual account retention setting was verified. |

The official OpenAI documentation skill guided this direct-source review. Legal-term pages were included because the user explicitly requested the applicable provider terms. No broad provider survey was repeated.

## Affirmative conditions and Nearr evidence

| Gate | Evidence on this source | Remaining fact or implementation |
|---|---|---|
| Actual provider account | Historical qualification records establish an existing transcription key, not a dedicated recognition credential/model. Root's live browser inventory had no OpenAI organization/settings tab. | Authorized account owner identifies the existing organization/project and applicable ordinary agreement or actual amendment; verify active model access, billing/spend limits, data controls and any organization restrictions through that account. No account access, entitlement or negotiated exception is claimed. |
| Guardian permission | `supabase/migrations/20261021000001_global_eligibility_and_consent.sql:25` constrains `minor_ai_qualified` false. `account_ai_access_reason` at lines 146–169 returns `guardian_authorization_required` for non-adults. No guardian grant/revocation mechanism exists in inspected product source. | Approve and implement a proportionate, independently attributable guardian authorization process. The minor's AI-sharing checkbox and the founder's release approval cannot substitute for a guardian's permission. Do not remove the SQL prohibition without the reviewed mechanism and adversarial tests. |
| Minor safeguards | Regional age declarations, server eligibility, separate AI consent, bounded source/context processing and no automatic Gemini fallback exist. | No completed minor-specific content-safety/reporting/escalation qualification was evidenced. In particular, physical-place recommendations can expose age-restricted venues or unsafe private locations; structured JSON validation is not a teen-safety filter. Approve the risk/response design and test inputs, outputs, reports and revocation. |
| Input and processor permission | Existing acquisition, transcription, storage and Google Places dependencies are documented in `recognition-qualification/PROVIDER_CONTRACT_ELIGIBILITY.md`. | OpenAI permission alone does not qualify ScrapeCreators/SoScripted, source-platform rights, transfers, retention or source imagery. Select and document the exact acquisition/audio route and its lawful input basis. The earlier unresolved processor findings were not silently converted to approval. |
| Dispatch enforcement | Host pre-authorization; Edge/DB/claim gates; worker `requireEligibilityBeforeProvider` before acquisition, audio/OCR, model and note initial/repair dispatch; revoked-account checks and closed legacy contract retained. | Positive qualified adult/minor end-to-end evidence remains absent. Recheck live deployed versions separately; this document does not equate source guards with the current Production configuration. Already-sent requests cannot be retroactively unsent. |
| Model and quality | Existing `services/media-worker/src/providers/openaiRecognition.ts` uses the fixed Responses endpoint, bounded frames/context/response, `store:false`, explicit model and enabled-route gates, grounded parsing and bounded timeout. | Exact accessible model/version and current pricing are unverified. No model was selected by guess. Live accuracy, wrong autosaves, coverage, multi-place recall, negative-case performance, latency, reliability and full cost/success are **unmeasured**, not zero or passing. |

The founder's earlier “I don't know” answer about agreement/guardian process remains uncertainty, not proof that a private agreement does not exist. Even discovering an ordinary active API account would not implement the missing guardian flow.

## Safe checks completed now

The new final worktree initially lacked `tsx` and `ts-node`, so two test invocations could not start. These are missing dependency errors, not app test failures. Rather than install another dependency tree during Android build/stress work, checks used the existing qualified worktree at `C:\Users\andre\.codex\worktrees\nearr-android-qualification\Nearr` after verifying its HEAD is the same baseline and relevant files are unchanged/clean. No product files or configuration were edited there.

| Command | Actual result, 28 October 2026 around 00:03:31–00:03:40 UTC |
|---|---|
| `node --import tsx --test tests/openaiRecognition.test.ts` (worker directory) | **12 passed; 0 failed; 0 skipped.** Injected synthetic transport only; disabled-route denial, request bounds, malformed output, timeout/cancellation, no Gemini/legacy recovery fallback and unknown-cost handling pass. |
| `npm run test:recognition-consent` | **PASS.** Actual host flow executes against boundary mocks: fresh authorization before parsing; identity changes/withdrawal deny; failed server does not fall back to client AI, Places or saves. |
| `npm run test:tutorial-recognition-corpus` | **5 groups PASS**, including 11 audited tutorial sources, outcome safety, no truth leakage and freshness/health rules. |
| `node --import tsx src/cli/recognitionLiveBenchmark.ts --category landmarks --dry-run` | **PASS**, case `C07`, research excluded, cache reads false, ground truth not loaded. No inference. |

This subtask made **zero provider inference calls and incurred $0 inference spend**. Offline mocks are not live recognition, commercial qualification or a provider-wide billing audit. Retained earlier live disabled-route receipts prove denied submissions/zero created jobs for their exact Development runs; they do not establish a positive recognition path today.

## Benchmark readiness and limits

Retain `scripts/mediaRegressionCorpus.json`, `artifacts/recognition-regression/corpus.json`, inference-only manifests, separate truth and historical baselines. Do not relabel exposed cases as blind holdouts. The current `recognitionLiveBenchmark.ts` paid branch invokes `solParityBenchmark.ts` and labels the historical `simple-sol-premium.v2` engine; **it does not automatically benchmark the OpenAI adapter**. Explicit candidate wiring into the same scoring/persistence contract is still needed before any paid run.

After permission gates pass, use the existing first-run cap: eight retained Development cases, one attempt each, concurrency one, at most $5 incremental total spend including acquisition/transcription/Places/retries, 90-second model deadline, no hidden fallback. Include named-place, scene-only/outdoors, misleading caption, multi-place, no-place, corrected-identity and saved-source controls. Persist predictions before truth; measure exact identity, wrong autosaves, coverage, multi-place recall, no-place behavior, request failures, p50/p95, full cost and cost/success. Then exercise the real application with properly authorized disposable adult and guardian-authorized minor identities, withdrawal and retry. A small canary alone cannot certify launch accuracy or authorize autonomous saves.

## Free-only release is not yet a bypass

Deferring subscriptions is legitimate, but does not resolve recognition qualification. At the audited baseline the disabled UI still presented Restore/Manage and Plus allowance text; the original SQL CHECK coupled free allowance enforcement to a paid catalog. A subsequent local-only change in this worktree now prepares an explicit, qualified `free_only` mode and an additive migration. See `FREE_ONLY_READINESS.md` for the 34-case PostgreSQL result and UI/API checks. It has **not** been applied to a live backend or enabled, does not qualify recognition, and must not be described as a working free consumer release. Do not falsely mark a paid catalog verified to unlock free usage.

## One consolidated founder action

**Open the existing OpenAI organization's authorized account/settings session and provide the governing agreement/amendment reference; in the same review, approve a completed 13+ guardian/teen-safety and exact processor/data-handling plan with the privacy/legal owner.** No API key or password should be pasted in chat. Ordinary applicable API terms may suffice; obtain a written exception only if the chosen design actually requires one. Until this evidence and the corresponding implementation/tests exist, keep recognition and automatic public release disabled. This is an external evidence/design-approval gate, not something a successful API request can settle.
