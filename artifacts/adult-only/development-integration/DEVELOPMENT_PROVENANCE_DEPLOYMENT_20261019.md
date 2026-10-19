# Nearr 18+ Development provenance and live integration — 2026-10-19 PDT

Scope is **Nearr-Dev only**: Supabase `qnfxnmvxpjzfydgudtvs`; Railway project `4037a3b5-d66f-409e-b734-56c22c244e3e`, environment `57d055b7-5326-4f96-a7a9-70523ee0d3f0`, service `3c8cd190-b118-4ee4-9338-407843ef4e1f`. Production, App Store Connect, OTA, policies and main were not changed.

## Provenance and temporary access

Read-only Railway deployment metadata/build logs had no commit SHA and the configured Git branch lacked live log symbols. After exhausting those, one dedicated Ed25519 key (fingerprint `SHA256:jSqMt88twYQYvXpzTUMC5c81LZEOTiIW/1QupiF8738`) was temporarily registered solely for a read-only `railway ssh` inspection. `/app` contained 228 compiled `dist` files plus package/lock files, not TypeScript originals. SHA-256 of **all 228** remote files, plus package and lock, matched a clean build of `ca08c154347096fe5da0bf2739cf0b25c0b706b0` exactly. This establishes a source-equivalent, reproducible running-artifact baseline; it does not claim Railway's absent original commit metadata. The key was deleted from Railway (`sshPublicKeyDelete` returned true), `railway ssh keys list` showed no registered keys, and its local private/public files were removed. No runtime secrets or private user content were retrieved.

The age candidate is clean commit `749cade860c588b1f7b236e4fa308a46587ae3ef`. Comparing its compiled worker to that recovered baseline: 225/228 files match, and only `pipeline/runMediaTask.js`, its source map and `types/media.js.map` differ, corresponding to the intended eligibility patch. Both builds passed the same 113 deterministic recognition/retry tests. A separate frozen replay (`compareWorkerRecognitionReplay.mjs`) produced 91 identical results, SHA-256 `e28b82502bd5a796aed0e68fb5f2b942710f9bca4eca7e573320ab967e7d5801` on both sides, with zero changed/missing case IDs and no provider calls. The age worker also passed its focused dispatch test.

## Fail-closed Development deployment

Immediately before mutation, the old worker `11acd95c-90f3-407e-aefa-2f1d66fc05a9` was still the active target; the Dev database had zero declared adults, zero processing tasks and metadata jobs, one queued task, and two enabled age triggers. The old worker was intentionally stopped with scoped `railway down`; Railway marked it `REMOVED` and public `/health` returned 404, proving no old-worker fallback. An initial full-repository upload created failed deployment `052d16ba-94fb-4cb1-b877-56cba99abe84` without a build. A minimal, exact 187-file archive of commit `749cade`'s `services/media-worker` subtree (ZIP SHA-256 `9651da9564be9a745c7d243f0db95b2dfe70b7ffa68951f03e26807442644f59`) uploaded successfully. **Age-gated worker deployment `69831ef2-7da5-495d-95b4-f1618b2f0b6e` is SUCCESS**; `/health` and `/ready` returned HTTP 200, readiness `ready` after live tests. No Railway variables or service settings were changed.

All three exact-source-preserving age candidates were Deno-checked and deployed to Dev with Supabase CLI 2.102.0 `--use-api` and explicit project ref. Active versions and deployed EZBR SHA-256 are:

| Function | Old → new | JWT verification | New EZBR SHA-256 |
| --- | --- | --- | --- |
| `process-share-link` | 86 → **87** | false, unchanged | `481e4f1871980b143daf64410f2127d0a2c49a23ec57e1e8d3ead59c241e8693` |
| `create-share-job` | 73 → **74** | true, unchanged | `60fad669182e69e8771e1d37ab97168739b8ce6a678aa52b31cab6d895bc72e8` |
| `process-share-jobs` | 142 → **143** | false, unchanged | `f1406419824e65d97a637680aff7f0b7b0f3d96a0615af049117904f05be23fe` |

Each old version/fingerprint/JWT and the two prior new versions were rechecked immediately before its deployment; post-deploy function listing confirmed ACTIVE and the expected fingerprint. The Dev age migrations and both DB trigger guards remain installed.

The **recovery/containment path is fail-closed, not a rollback to the ungated artifact**. On a faulty worker, first verify that the exact active target is still `69831ef2-7da5-495d-95b4-f1618b2f0b6e` in the Dev project/environment/service, then use the already exercised stop operation:

```powershell
$env:RAILWAY_CALLER='skill:use-railway@1.5.5'
$env:RAILWAY_AGENT_SESSION='railway-skill-nearr-age-20261019'
& 'C:\Users\andre\Desktop\Nearr\.tmp\nearr-1.5-adult-only\.tmp\railway-cli\node_modules\.bin\railway.cmd' down --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment 57d055b7-5326-4f96-a7a9-70523ee0d3f0 --service 3c8cd190-b118-4ee4-9338-407843ef4e1f --yes
```

Verify the deployment is `REMOVED`, `/health` is unavailable, and processing counts are zero; leave the DB age guards active. If a Dev Edge route is faulty, the CLI's scoped `functions delete <slug> --project-ref qnfxnmvxpjzfydgudtvs --yes` can make that route unavailable while a repaired age-gated candidate is prepared. That Edge deletion contingency was inspected but **not exercised**. Never restore v86/v73/v142 or the old worker to bypass the age check. Forward recovery is redeployment of a reviewed age-gated source. The stop control and no-fallback observation were actually exercised; an incident itself was not simulated.

## Live eligibility and legacy contracts

`liveAgeGateSynthetic.mjs` used only the Development **public** publishable key obtained in memory from the named EAS variable. It created isolated anonymous test identities and deleted each using authenticated `delete-account` (all HTTP 200). Results: unauthenticated legacy/queued requests 401; undeclared and under-18 users 403 `age_eligibility_required` on both `process-share-link` (old 1.4-style `{url}`/`mode:save`) and `create-share-job`; adult queued request passed the age gate and returned expected invalid-URL 400 before enqueue; adult legacy request passed the gate and returned `metadata_failed` for a reserved `.invalid` domain before recognition/provider work; changing an adult declaration to under-18 was rejected as locked. `liveRevokedSynthetic.mjs` then created one additional adult test owner, revoked only its exact Dev database row, and proved both routes returned 403; its account deletion returned 200. Neither test submitted a resolvable social post. These are live **route contract** probes, not a physical 1.4.55 binary replay or adult recognition/save pass.

After tests, Dev database aggregates were: zero age decisions (synthetic accounts removed), two enabled triggers, zero processing tasks, zero metadata jobs, one preserved queued task. A rollback-contained rerun of installed `claim_media_tasks(1,60)` refused to lease that pending-age task. Worker `/health` 200 and `/ready` 200/ready. We did not extract log payloads or claim a provider-billing audit from only three startup log lines; the negative routes return before metadata/AI by source order, and the adult synthetic inputs cannot reach paid recognition. Revocation **during an active claim**, real adult social-post recognition/save, old physical binary behavior, and iPhone Share Extension/error UI remain pending.

## Native QA readiness and release boundary

Clean Development iOS build 61, EAS `4b64b0ef-483c-455e-b3fa-8caa0c1afa62`, source `c4187f815aa50703f9612f83e999186d10c21218`, Nearr/runtime 1.5.59, is finished and its IPA host/extension metadata was inspected. Founder installation, correct public Dev Metro configuration, physical 18+ flows, legacy 1.4.55 device replay, provider telemetry and saved-map/photo preservation are still required before a complete Development QA claim. No Production rollout is authorized by these Development results.
