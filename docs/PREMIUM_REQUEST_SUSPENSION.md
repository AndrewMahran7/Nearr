# Premium Request production suspension

New Premium Requests are controlled at both runtime boundaries:

- Client: `EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED`
- Supabase Edge: `PREMIUM_REQUESTS_ENABLED`

The shared policy defaults development and preview to enabled, production to
disabled, and unknown server projects to disabled. Production is configured
explicitly to `false`. The client hides offers, the Settings token entry, and
the token store; a stale store route shows only a temporary-unavailability
state. The authenticated monetization Edge function independently rejects all
new monetization actions with `premium_requests_suspended` before wallet,
reservation, task, or RPC work.

Eligibility continues to be persisted. While suspended, the Edge finalizer
emits `premium_eligible_while_suspended` instead of
`premium_request_offered`. Existing `reserved` or `processing` Premium jobs
continue through the unchanged worker and settlement paths, and historical
results, balances, lifetime grants, and ledger rows remain untouched.

## Re-enable production

1. Set the production Supabase secret:
   `npx supabase secrets set PREMIUM_REQUESTS_ENABLED=true --project-ref rlqvxdwtetxsqxhqztkw`
2. Set the production EAS environment variable:
   `eas env:update production --variable-name EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED --value true --visibility plaintext --non-interactive`
3. Redeploy only `monetization` and `process-share-jobs` if their currently
   deployed bundles do not already contain this policy.
4. Publish a guarded production OTA from a clean, pushed `main` using the
   production release record workflow in `docs/PRODUCTION_RELEASE_GATE.md`.
5. Verify a Premium-eligible result shows the offer, direct initiation reserves
   exactly one token, the Premium task runs, settlement consumes/releases as
   appropriate, and Settings/token-store surfaces are visible.

No Railway deployment, database migration, wallet edit, or ledger edit is part
of either suspension or re-enable.
