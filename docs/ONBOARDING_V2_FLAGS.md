# Onboarding V2 production flag contract

Onboarding V2 is enabled only when its backend capability has been verified.
All other combinations fail visibly to the legacy onboarding route.

| `ONBOARDING_V2_ENABLED` | `ONBOARDING_V2_BACKEND_READY` | `PHASE1_ONLY` | Mode |
| --- | --- | --- | --- |
| false/unset | any | any | legacy |
| true | false/unset/invalid | any | legacy |
| true | true | true | V2 phase 1 |
| true | true | false | full V2 |

Before setting backend readiness, verify the production migration ledger has
the onboarding tables/RPCs, anonymous auth works, and RLS permits the expected
anonymous flow. Invalid or missing values never select V2.
