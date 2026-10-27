# Integrated source test results

Final application source: `4346840b69749b4ff54a7c9bd2e0abb0e67c8b12`.

Command: `node scripts/validateOnboardingIntegration.mjs`. This invokes 30 actual npm entrypoints with two workers, including the complete `npm run test:prebuild` lifecycle (its pre-hook, TypeScript and nested project suites). It does not replace them with mocked checks or suppress nonzero exits.

Result: **20 passed / 10 failed**. Full prebuild and safe-Development checks passed. The runner correctly exited 1. This is not an all-green test report.

Machine evidence: `tests/results.json` (final run), `tests/initial-results.json` (first integrated run), `tests/baseline-comparison.json` (all ten failures reproduced on untouched unified `6e4096a34bb4a09b66227474659d753670d3764f`). Raw per-command logs are retained locally under `tests/` and ignored by Git. No failing assertion was removed, weakened, or skipped.

## Passing entrypoints

`test:prebuild`, `test:safe-development`, `test:birthday-onboarding`, `test:onboarding-native-contract`, `test:localization`, `test:native-localization`, `test:global-eligibility-db`, `test:global-monetization`, `test:global-monetization-db`, `test:consent-identity`, `test:recognition-consent`, `test:privacy-policy`, `test:onboarding-account-transition`, `test:create-map-navigation`, `test:create-map-continue-runtime`, `test:onboarding-phase2-auth-map-hardening`, `test:onboarding-v2-hands-on-activation`, `test:fieldnotes-oct18`, `test:fieldnotes-oct15`, `test:monetization-suspension-contract`.

Prebuild includes auth/provider contracts, account transfer, offline onboarding, Share Extension, Fieldnotes, saved places, Quick Check, nearby/reminders, Plus policy and TypeScript checks. Database suites use isolated local Postgres, not a live database reset. Eligibility exercises all configured age-band/region combinations and denied access. Localization now also checks dynamic tutorial choices, all literal translation calls in five onboarding components, and account intent headings/subtext.

## Baseline failures retained

| Actual npm command | First failure on both baseline and integration | Classification |
| --- | --- | --- |
| `test:onboarding-v2-phase2` | Expects literal `title="Save to my map"`; source uses `t(...)` | Stale source assertion; later chained suites not reached |
| `test:onboarding-v2-visual` | Expects literal `Phase1PrimaryButton title="Explore my map"` | Stale source assertion; later chained suite not reached |
| `test:onboarding-v2-physical-runtime` | Final-journey test expects app version 1.6.59, actual 1.7.0 | Stale version assertion; preceding map/share checks pass |
| `test:onboarding-1259-regressions` | Expects literal `{placeName} is saved.` | Stale source assertion; final implementation uses a complete localized interpolation |
| `test:fieldnotes-physical-ui` | Expects raw `Mark visited` JSX | Stale source assertion after localization |
| `test:place-detail-ui` | Expects raw `Your note` / `From the post` source ternary | Stale source assertion after localization |
| `test:saved-place-result-ui` | Cannot resolve `@/lib/i18n` in its runtime mock loader | Incomplete test harness for localized component |
| `test:monetization-token-ux` | Missing `app/monetization.tsx` | Legacy storefront suite conflicts with intentional storefront removal |
| `test:monetization-integration` | Missing `app/monetization.tsx` | Same legacy storefront dependency |
| `test:premium-request-monetization` | Missing `app/monetization.tsx` | Same legacy storefront dependency |

These are reproduced baseline test failures, not evidence that every hidden assertion behind each first failure passes. No storefront was restored to satisfy obsolete tests. Full regression-suite cleanup remains separate from this Development candidate.

## Additional checks and limits

- `npm run verify:env -- --eas-environment development --expect development`: PASS, Nearr-Dev only; no key values recorded.
- `git diff --check`: PASS.
- Native locale plugin: PASS, two native targets / ten locales / forty string files / idempotent resource registration.
- Birthday test: real rendered components plus native bridge mocks, date/leap/future boundaries, minimized payload, country thresholds, restricted persistence, owned-declaration reuse, account changes and existing-account bypass protection.
- Real Google/Apple sign-in, signed-in account switching, reinstall, server-backed restricted account UX and physical extension handoff are **not** replaced by these contracts. Founder physical QA remains open.
- Windows iOS prebuild is unsupported; EAS macOS build and signed IPA inspection provide native packaging evidence instead.
