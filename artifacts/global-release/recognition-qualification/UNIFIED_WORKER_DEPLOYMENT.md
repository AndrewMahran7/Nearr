# Unified Development worker deployment

26 October 2026. **Deployed successfully, intentionally not ready for recognition.** Railway authentication completed through one fresh browser login; CLI then confirmed the authorized account. No password/token was requested in chat.

| Evidence | Value |
|---|---|
| Project | `4037a3b5-d66f-409e-b734-56c22c244e3e` |
| Development environment | `57d055b7-5326-4f96-a7a9-70523ee0d3f0` |
| media-worker service | `3c8cd190-b118-4ee4-9338-407843ef4e1f` |
| Prior active deployment | `69831ef2-7da5-495d-95b4-f1618b2f0b6e`, older `749cade` archive |
| New deployment | `0f738ab6-ec1a-4b34-a2c6-bc67488b74c3`, observed **SUCCESS** |
| Upload created | `2026-10-26T19:39:47.086Z` |
| Runtime startup | `2026-10-26T19:44:48.407Z` |
| Exact source commit | `001eea5d40ee1ebca742bb1f48f042ba40f802b9` |
| Worker Git tree | `fee45693772b007908e2f3bcc7b7b089aceb15d1` |
| Git archive SHA-256 | `5ca60b28726b868d57f5e4a70d1e05cc265dd6137887be7c2a84523801c28134` |
| Railway final imageDigest | `sha256:6c25b4262344bbfe7ad9106913c7c194cf693e2e16b37d500be1647ebbcd0c21` |

190 tracked worker files were exported with `git archive` from the exact commit, excluding local secrets, node_modules and uncommitted work. The archive was extracted to a new temporary staging directory, uploaded with explicit project/environment/service, and its source SHA and archive hash included in Railway deployment metadata. Root/config remain `/services/media-worker` and `/services/media-worker/railway.json`. The build's intermediate OCI digest differs from Railway's final imageDigest; the latter above is the platform readback. This is reproducible source provenance, not a claim of byte-identical future image builds: Docker uses a mutable Node base tag and npm install.

Compared with the prior source: 13 worker files, 391 insertions/34 deletions, including the OpenAI adapter, global eligibility rechecks, provider restrictions and regression tests. No app/UI source changed in this task.

## Mutation and containment

Before mutation, verified SUPABASE_URL was `https://qnfxnmvxpjzfydgudtvs.supabase.co`, global legal/recognition/purchase false, provider route disabled and all ten market/minor flags false. Re-read latest Dev deployment immediately before variable update and again before upload; both were the expected old deployment. No concurrent release advance was observed.

Used `--skip-deploys` for one reviewed variable update, then the explicit-source deployment. Set every existing worker `*_ENABLED` flag false, plus `MEDIA_OPENAI_RECOGNITION_ENABLED=false`, `NEARR_ALLOWED_PROVIDER_ROUTE=disabled`, `MEDIA_ANALYSIS_PROVIDER=disabled`, `MEDIA_TRANSCRIPTION_PROVIDER=noop`, `MEDIA_OCR_PROVIDER=noop`. No credential was removed, copied to another provider or printed. Secrets retained in the service are inactive, not proof of permission. Provider/market DB flags were not changed.

Before upload, containment was established: keep the database gate disabled during build/cutover, keep all new worker switches off, and if the new worker fails leave/redeploy only a globally gated version. The old adult-gated source is **not** an acceptable application rollback. Do not reverse consent migrations or erase queues. Recovery source is the exact unified archive above; rebuilding that source is safe only with the same disabled flags and a fresh concurrency check. For later provider incidents, disable DB recognition and worker dispatch first, then repair forward without opening an unqualified fallback.

## Verification

- `/health`: HTTP 200, `status=ok`.
- `/ready`: HTTP 503, `status=not_ready`; config false, ffmpeg/ffprobe/yt-dlp true; yt-dlp `2026.08.19`.
- `/ready` lists missing enabled OpenAI route/key/model plus transcription provider. This is expected containment, not successful recognition readiness.
- `checks.supabase=false` means the readiness implementation did not construct/probe processing dependencies while config is disabled, **not evidence of a Supabase outage**. Independent authenticated REST/RPC reads and Edge tests succeeded.
- `capabilities.aiNoteEnrichment=true` is a static implemented-capability field, not an enabled-dispatch signal. Overall readiness and authenticated processing endpoint remain closed.
- Authenticated `/v1/process-media-tasks`: HTTP 503 `not_ready`; no queue claim performed.
- Startup logs show all media acquisition, fallbacks, automatic-deep and visual-geolocation flags false; analysis disabled, audio/OCR noop.
- Worker typecheck/build and 656/663 tests passed, 7 skips, zero failures before deployment.

Edge readback: create-share-job v75, process-share-link v88, process-share-jobs v144, plus-api v1, revenuecat-plus-webhook v1, all ACTIVE. No Edge or database migration was changed in this task. Actual eligibility RPCs work against the deployed schema.

Production was read only: its successful deployment remains `6e78ebe9-58f7-4799-a90e-86238a1b14e9`; a newer historical September entry is SKIPPED, not the active image. No Production variables, schema, Edge, worker, OTA or Store submission was changed.
