# Development monetization suspension

Status: **SUSPENDED** for the Nearr Development QA lane. Do not re-enable it until the founder explicitly asks.

## Scope and mechanism

This is a reversible configuration quarantine, not a monetization rollback. Its machine-readable contract is
`config/development-monetization-suspension.json`.

Only Development is targeted:

- EAS environment `development` has `EXPO_PUBLIC_MONETIZATION_ENABLED=false`,
  `EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED=false`, and
  `EXPO_PUBLIC_TOKEN_MONETIZATION_ENABLED=false`.
- Supabase project `qnfxnmvxpjzfydgudtvs` has
  `TOKEN_MONETIZATION_ENABLED=false`, `PREMIUM_REQUESTS_ENABLED=false`, and
  `MONETIZATION_DEV_MOCK_ENABLED=false`.

The deployed Development `create-share-job` function reads
`TOKEN_MONETIZATION_ENABLED` and passes its value as `p_enforce_tokens` to the
database RPC. With the flag false, new shares are created as normal queued jobs:
no token eligibility check, reservation, debit, `awaiting_purchase` state, or
`requiresPurchase` response. Disabling Premium Requests also prevents the later
premium reservation/settlement path. Disabling the dev mock switch prevents QA
from creating fake purchase grants.

The branch's Share Extension already renders the normal `Sent to Nearr`
completion for an accepted durable job. The installed Development binary may
still contain older monetization-aware extension JavaScript because the native
extension is not replaced by an OTA; the server-side false response is therefore
the critical control that keeps even that extension out of the View Packs path.

## Root cause

The approved Google cost-control commits did not add monetization. Monetization
schema and product surfaces pre-existed their base. The physical block was the
combination of an older monetization-aware Share Extension binary and current
Nearr-Dev backend state: `create-share-job` had token enforcement enabled, so a
zero-balance share became `awaiting_purchase` and returned
`requiresPurchase=true`. The extension then showed the out-of-tokens/View Packs
experience and the worker could not claim the held job.

## Preserved state

No schema, migration, Edge Function, balance, reservation, ledger entry, grant,
purchase, entitlement, webhook event, product, package, RevenueCat credential,
or feature branch is removed or rewritten. Historic `awaiting_purchase` rows are
also preserved. Use a new QA share URL/request for the cleanest physical proof;
an old exact in-flight dedupe key may deliberately resolve to its historic job.

## Verification

Run the deterministic seven-case contract:

```powershell
npm run test:monetization-suspension-contract
```

For physical QA, the following evidence is authoritative:

- Supabase secret readback shows the three Development server controls updated
  to the known false value hash.
- The Extension log contains `[share-extension] job_accepted=true` and no
  purchase navigation.
- `create-share-job` returns `status=queued` and `requiresPurchase=false`; its
  Edge log contains `[share-job] created job_id=...` (or an in-flight duplicate).
- `process-share-jobs` logs that job moving through claim/processing and a
  terminal recognition result.
- No new `reserve`, `consume`, or Premium settlement ledger entry exists for
  the QA job.
- Development console telemetry still emits `[candidate-presentation] ...`
  events for the Google presentation-cost path.

## Re-enable later

Re-enabling is a separate, founder-authorized operation. Re-enable only the
intended Development experiment flags, publish a new Development OTA, and rerun
the monetization integration suites. Do not infer Production values from this
document and never copy this suspension manifest to Production.
