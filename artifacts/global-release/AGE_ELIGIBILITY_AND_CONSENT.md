# Age eligibility and processing permissions — implementation evidence

Development source review, 20 October 2026 (US Pacific). This describes the integrated code and local tests, not a deployed or legally approved release. The global legal, recognition, purchase and regional qualification switches default to **false**. A passing age declaration alone does not authorize recognition, purchases or a public market launch.

## What the person is asked

`components/PreAccountEligibility.tsx` renders `AgeEligibilityGate` before mounting the onboarding/authentication tree for a new installation. It asks for an age band (`under_13`, `13`, `14`, `15`, `16_17`, `18_plus`) and country of residence. Neither answer is preselected. It collects no date of birth, government document, face image, parent email or payment information. The screen explicitly calls this a declaration and offers support to correct an error.

The initial answer is stored locally under `nearr.globalEligibility.v1`. `lib/globalEligibility.ts` and `config/global-eligibility-policy.json` provide the offline explanation only. The account subsequently declares its own answer through `declare_global_eligibility`; the server computes its decision independently. Altering local storage or a client boolean does not grant server recognition access.

| Country | Draft minimum for the ordinary age declaration |
| --- | --- |
| United States, United Kingdom | 13 |
| Spain, Italy, South Korea | 14 |
| France | 15 |
| Germany | 16 |
| Brazil, Japan, Mexico | 18 pending further market qualification |
| Any other country | Unavailable |

Every under-13 answer is restricted. These are conservative implementation thresholds, not a statement that privacy consent age equals contractual capacity or that every market accepts self-declaration. See [the legal requirements matrix](AGE_LEGAL_REQUIREMENTS_MATRIX.md) for legal sources and market-specific unresolved questions, including Korea's contractual-capacity distinction and Brazil's separate child-safety duties.

**No guardian authorization, independent age estimation, identity verification or verifiable parental-consent service has been implemented.** The first server declaration is locked against self-service age/country changes; support-assisted correction and passage-of-time reassessment still need an operational process. A person can lie on the first declaration. The code does not claim to prevent that or infer age from a payment.

## Existing accounts and saved-data access

An existing permanent authenticated session can mount the account tree even when the local answer is restricted. This is intentional: the server gate must preserve access to existing saved places and account/data controls. An anonymous session does not receive this local exception. The root layout binds the saved-data escape to the current `session.user.id` using `dataAccessOwner`; a different account does not inherit that UI choice. None of these UI paths changes the server's AI permission.

The Supabase client is imported before the local gate. Restoring an existing session and its normal token-refresh behavior may therefore contact authentication infrastructure before a new local answer. The implementation prevents the gated onboarding tree from creating a new anonymous account while restricted; it does **not** establish a claim of zero authentication/network traffic before age declaration. The device may already contain a previous session or local saved data.

Age restriction, an unavailable market, withdrawal, or failed recognition qualification does not delete saved places. The gate exposes support, privacy and, for an authenticated account, saved-data/account options. The existing export/deletion paths remain separate from a subscription. Existing places, notes, identifiers, sources, historical credits and consent records are not destructively rewritten by these additive migrations.

## Server authority and legacy handling

`20261021000001_global_eligibility_and_consent.sql` adds owner-readable eligibility and permission tables. Authenticated clients cannot write the underlying decision tables or release switches. Declaration and permission RPCs derive the owner from `auth.uid()`, not a body-supplied user ID. Arbitrary-owner eligibility predicates are executable only by the service role. RLS prevents one account reading another's declaration or permission row.

`account_ai_access_reason` requires all of: an eligible declaration under the current policy; the declared band's lower age bound meeting the **current** regional minimum; no legacy administrative revocation; a qualified market; adult age band; approved current legal text; current terms acceptance; affirmative current-version AI permission; and a qualified `openai_only` recognition route. Missing or unrecognized results fail closed. Purchase qualification additionally requires its separate release switch. `minor_ai_qualified` and optional analytics are constrained false in this release.

Legacy adult self-declaration does not waive the new regional declaration or consent. A legacy under-18 decision cannot be replaced by an adult claim through the ordinary declaration RPC; it may establish a permitted teen declaration. A legacy revocation remains restrictive. The old `is_adult_eligible_for_ai` function returns false so a stale worker containing an incompatible provider cannot resume merely because a newer route is approved.

Completed account transfers copy a source eligibility record only when the destination has none. They do not overwrite a restrictive destination record or copy AI/terms/privacy permissions. The destination must establish its own permissions. This preserves a destination withdrawal during an anonymous-to-permanent account transfer.

## Separate choices, notices and identity binding

| Record/action | Actual behavior |
| --- | --- |
| Terms | `record_global_terms` requires legal qualification and the exact current terms version. `AiSharePermissionPrompt` offers a distinct acceptance action. |
| Privacy presentation | `record_global_privacy_notice` stores presentation, not consent. `app/legal/privacy.tsx` invokes it only for an actually rendered approved `nearr-global-privacy-v1` snapshot, matching server privacy version and legal approval, with the same authenticated owner before and after the read. |
| AI sharing | `set_ai_sharing_permission` requires an affirmative action and the current qualified AI notice for a grant. It is not inferred from account creation, terms, privacy viewing, location permission or a purchase. |
| Withdrawal | Settings can set AI permission false even with an old notice version. Saved-data access remains. New work and later dispatch checkpoints are denied; a provider request already sent cannot be recalled by this mechanism. |
| Optional analytics/marketing | Not enabled by these choices. Optional analytics remains disabled; no marketing consent is manufactured. |

The bundled approved privacy snapshot is currently null. Opening a policy website, viewing the English Development review draft, or pressing an AI action consequently creates **no** privacy-presentation receipt. `GlobalLegalDraft` is explicitly unapproved/not effective and renders only with `__DEV__`; it is review material, not accepted legal text. The historical terms module is retained for history, not treated as accepted global-v1 terms. Andrew Mahran (individual) and the monitored `andrew.mahran@icloud.com` contact are supplied by user Part 27; this is not a pending operator-identification question.

`AiSharePermissionPrompt` and `ProcessingPermissionsSettings` bind their state to an account subject and generation. They refresh the bearer immediately before writes, discard stale completions, clear state when the account changes, and refresh when returning to the foreground. The host observes authentication changes; the extension additionally verifies its shared session on each action. A consent screen opened for account A cannot grant for account B or enqueue recognition when A's old asynchronous request completes after a switch. Settings uses an explicit owner-bound bearer instead of silently using the mutable global client for withdrawal. Unavailable identity/transport fails closed.

## Recognition enforcement

The authenticated Edge ingress derives the owner using verified authentication. `20261021000003_global_share_ingress.sql` restricts the new queue creation RPC to the service role and checks the server decision. Queue/media insert and processing-transition triggers enforce eligibility again. The worker uses the persisted task owner and rechecks before transcription, OCR/model dispatch and retry continuation. Root's final queue-claim filtering migration additionally excludes ineligible rows before selecting a batch; its separate validation record is authoritative for that later migration.

`providerAudiencePolicy.ts`, the client provider paths and the worker provider guard contain Gemini/Vertex Gemini and the unqualified SoScripted path. An adult user's request is not an exception to an application-wide audience restriction. The candidate OpenAI route remains disabled pending contractual, data-handling, quality/cost and regional evidence. No paid benchmark or live provider experiment was performed for this audit. See [provider audit](MINOR_SAFE_PROVIDER_AUDIT.md) and [migration evidence](RECOGNITION_PROVIDER_MIGRATION.md).

## What has actually been tested

- `scripts/testGlobalEligibilityDatabase.ts` runs the real age migrations in a disposable local PostgreSQL cluster. The recorded [database result](eligibility-database-tests.json) reports 12 passing suites, including 60 region/age combinations, locked declarations, owner RLS/role grants, distinct permission records, teen exclusion, withdrawal before queue claims, legacy revocation, transfer behavior and disabled/stale policy. Its synthetic qualification fixture is labelled `LOCAL_TEST_ONLY`; it is not release evidence. Later changes need their corresponding rerun record.
- `scripts/testConsentIdentityBoundary.ts` mounts the actual React consent/settings components with mocked native/session/RPC boundaries. It passes host and extension account-switch cases, fresh-token use, held asynchronous responses, withdrawal ownership, and absence of an invented privacy acknowledgment. These are behavioral tests, not source-string assertions or a device demonstration.
- `scripts/testRecognitionConsentBoundary.ts` executes the complete actual host `runSaveFlow` with mocked external boundaries. It passes held/fresh authorization before source parsing, denied/malformed decisions, changed-owner and signed-out cases, and verifies null/throwing/restricted server responses cannot reach the legacy client AI, Places, save or manual fallback.
- `scripts/testPrivacyPolicy.ts` passes 32 checks using the actual React privacy viewer and pure translation engine with synthetic approved fixtures. It retains exact content, themes/contrast, accessibility, offline/error/retry, URL and release-gate assertions and now checks missing/test-only snapshots, legal/version mismatch, account switching and refreshed-owner receipt tokens. The restored EAS pre-install hook allows the internal Development profile and rejects a Store/Production build without genuine exact-content privacy approval.
- Worker and Edge eligibility/provider test files exercise server-decision failure and the prohibited-provider boundary. They do not prove live vendor settings, provider contract approval, App Store approval, age-verification effectiveness or native-device coverage.

No legal approval, public policy publication, production deploy, real parental authorization or App Store privacy submission is implied by these tests. Qualification stays off until its actual evidence is supplied and recorded. Existing account/data rights remain available during that hold.
