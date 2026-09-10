# Curated tutorial fixtures

Curated tutorial fixtures make a very small, independently verified set of onboarding shares deterministic. They map Nearr's canonical public-content identity to an existing canonical `places` row. They are product-owned truth, not learned recognition truth, and never seed or reinforce Recognition Cache V2.

## Runtime flow

`process-share-jobs` derives the existing `v<version>:<platform>:<content-id>` identity, asks the service-role-only `resolve_onboarding_tutorial_fixture` RPC for one eligible mapping, and only then enters Cache V2. A hit uses the normal `saveForUser` path, the normal per-user `saved_places` row, the normal `saved_place_sources` attachment, and the normal `share_job_place_results` ledger. A miss or any invalid state falls through unchanged.

Jobs record `resolution_source` as `tutorial_fixture`, `recognition_cache_v2`, or `fresh_recognition`. Fixture jobs additionally pin the fixture ID, served verification revision, and role. The fixture path explicitly bypasses cache read/admission, Gemini, Sol, Automatic Deep, media recognition, and Places calls. Its analytics event contains IDs and low-cardinality state, never the raw source URL.

## Eligibility and lifecycle

A fixture resolves only when all of these remain true:

- identity key, identity version, platform, content ID, and canonical URL all exactly match;
- status is `active`, provenance is `onboarding_tutorial_verified`, and the verification revision is positive;
- health is `healthy` and its seven-day lease has not expired;
- when an expected media SHA-256 exists, the most recently observed hash matches it;
- the canonical place still has a Google ID, usable name and coordinates, is not merged, and is not permanently closed;
- the partial unique index allows only one active row for an identity/version.

Statuses are `active`, `stale`, `quarantined`, and `disabled`. Roles are `primary` and `backup`; `priority` is orchestration metadata. Runtime resolution always uses the exact shared source identity and never substitutes a backup source for a primary one.

`Wrong Place` and correction continue through the existing authenticated feedback RPC. The resulting immutable recognition correction event triggers a global fixture quarantine in the same transaction and records both the served and current verification revisions. A health check never reactivates a quarantined/disabled fixture. Reactivation requires the explicit `reverify` command, matching identity and place confirmations, a fresh source acquisition probe, and a new verification revision.

## Fingerprint and health trust model

V1 uses the stable provider content identity on the request path, so successful tutorial shares do not download media. The callable Development health tool runs `yt-dlp` without a shell, confirms that the public source resolves to the same canonical identity, confirms media formats are available, and checks that the mapped place is still usable. Its health lease expires after seven days, which makes request-time lookup fail closed even if the health command stops running.

Media fingerprinting is optional. If `expected_media_sha256` is present, health and re-verification require `--verify-fingerprint`, perform a bounded temporary download, compare SHA-256, and clean up. An identity or fingerprint mismatch quarantines; acquisition failure marks stale. No scheduler is introduced in V1.

## Development operations

These commands are hard-guarded to Supabase Development `qnfxnmvxpjzfydgudtvs` through the existing deployed-target resolver. Set the Railway audit variables required by the infrastructure skill before invoking them; secrets are read but never printed.

```powershell
$env:RAILWAY_CALLER='skill:use-railway@1.4.0'
$env:RAILWAY_AGENT_SESSION='railway-skill-curated-tutorial-fixtures-v1-20260909'

npm run tutorial-fixtures:manage -- register
npm run tutorial-fixtures:manage -- inspect --id=<fixture-uuid>
npm run tutorial-fixtures:manage -- list --status=active
npm run tutorial-fixtures:manage -- disable --id=<fixture-uuid> --reason=<code> --actor=<operator>
npm run tutorial-fixtures:manage -- quarantine --id=<fixture-uuid> --reason=<code> --actor=<operator>
npm run tutorial-fixtures:health -- --id=<fixture-uuid>
npm run tutorial-fixtures:manage -- reverify --id=<fixture-uuid> --reason=<code> --actor=<operator> --confirm-identity=<identity-key> --confirm-place-id=<place-uuid>
```

Registration validates the checked-in Development manifest, canonical identity, source acquisition, and an exact pre-existing canonical place. It never creates a place and an idempotent re-run never reactivates a disabled/quarantined row.

## Production rollout requirements

This V1 ticket is Development-only. A separate explicitly authorized release must re-review the migration, independently verify and health-check Production fixture candidates, establish Production operational ownership/health cadence, apply the migration to the Production project, deploy the exact reviewed Edge source, register Production rows separately, and run a bounded Production smoke test. Never copy Development fixture rows or service credentials into Production, and never infer Production authorization from this document.
