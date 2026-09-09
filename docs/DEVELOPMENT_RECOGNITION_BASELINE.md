# Canonical Development recognition baseline

This document describes the reproducible Development recognition contract
established on 2026-09-09. Production remains on its separately released
baseline and must not be inferred from Development deployment state.

## Normal share-job contract

- An exact `(user_id, clientRequestId)` retry returns the same job.
- The same user and canonical source reuse one active job while its status is
  `awaiting_purchase`, `queued`, or `processing_metadata`.
- A new request ID after any terminal result creates a fresh job. Completed
  jobs are not reused as recognition truth; Cache V2 owns reusable source truth.
- Different users never dedupe to one another's jobs.
- The eight-argument `create_share_job_for_user` signature is retained. Its
  legacy window and force-rerun inputs are accepted but intentionally ignored.
- The experimental token-aware nine-argument overload is not part of the
  canonical recognition entry point.

## Development qualification lane

`qualification_fresh` is available only through
`create_dev_qualification_share_job_for_user`. Edge authorization requires the
Development project plus server-controlled user metadata:

- `account_class=dedicated_dev_test`
- `purpose=onb2_tutorial_qualification`

An exact request-ID retry returns its existing qualification job. Every new
request ID creates independent work even for the same canonical source.
Qualification jobs disable Cache V2 reads, source singleflight, completed-result
reuse, and positive cache admission, and require the wired media path.

## Recognition policy

Development retains the Production source-identity and semantic-contradiction
work, then adds `exact-identity-safety-2026-09-09.v1` across metadata, media,
Automatic Completion, synchronous resolution, and finalization. Candidate
rank, geography, or singleton status cannot establish exact identity by itself.
Unresolved parent/child, sibling, or same-category regional ambiguity remains
review-only.

Cache V2 remains `recognition-cache-v2.1`; its database read, admission,
correction, quarantine, revalidation, support, and saved-source objects were not
changed by this reconciliation.

Automatic Deep remains enabled in Development and disabled in Production.

| Subsystem | Canonical Development source/policy version |
| --- | --- |
| Source identity | `vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups` + `source-entity-semantic-consistency-2026-09-08.v1` |
| Metadata autosave | `metadata-autosave-2026-09-09.v9-exact-identity` |
| Media autosave | `media-autosave-2026-09-09.v12-exact-identity` |
| Automatic Completion | `automatic-completion-2026-09-09.v2-exact-identity` |
| Automatic Deep | `automatic-deep-recognition.v2` |
| Exact-identity safety | `exact-identity-safety-2026-09-09.v1` |
| Cache V2 | `recognition-cache-v2.1` |
| Qualification freshness | `qualification_fresh` / `qualification_fresh_override` |

## Migration-history warning

The environments contain same-version/different-content history, including
`20260906000006` (Production/repository revalidation quarantine versus a
Development token-monetization migration). Historical versions must not be
replayed or falsely marked as applied. The local
`20260908000001_development_history_marker.sql` is intentionally inert: it
acknowledges an already-applied Development-only ledger version without
replaying its historical body. The canonical object delta is represented by
`20260909000001_canonical_development_recognition_baseline.sql`, a new
forward-only migration based on inspected live objects.

## Development deployment record

The 2026-09-09 Development deployment is reproducible from this baseline:

| Surface | Version / deployment | Source hash / image |
| --- | --- | --- |
| `create-share-job` | Edge version 66, `2bf6a549-e9c6-4cee-accb-3a6bc95b44d5` | `9903397ac45b6d0892229a7f4cf5846f4e0a4312f0907f8e060292a2cb8f5199` |
| `process-share-link` | Edge version 82, `87f5bb75-f296-4cf7-83fc-d976fa65c634` | `8a095e90538248690f338c5dafba0f7d81978f09c88dd4a7cb9030c476e55f94` |
| `process-share-jobs` | Edge version 133, `7c25443f-d595-4332-b3fd-627855bd782a` | `268e2019ba0b5a8b226107350b8bb4ded219d5b1e70b7ee614a6811e0ef77405` |
| Railway `media-worker` | `4d9ab527-8f1a-4837-964b-3fef598ecf87` (unchanged) | `sha256:fb274e21f7140cf14916adb39fa2af339872c2772a15f6331881e11c271fb280` |

The Railway worker was not redeployed because this reconciliation changed no
worker source. At verification it reported healthy and ready, targeted the
Development Supabase project, and had
`AUTOMATIC_DEEP_RECOGNITION_ENABLED=true` with
`GEMINI_MODEL=gemini-3.5-flash-lite`.

Production differences remain intentional until a separate release: older
autosave gates, no qualification mode, a different normal-job dedupe contract,
and Automatic Deep disabled.
