# Recognition provider migration plan

Status: code-ready candidate, qualification blocked. The target route is `openai_only`, but every global and regional switch remains false and the worker default route is disabled.

## Prepared architecture

The app and Share Extension obtain a fresh server access decision before parsing or submitting source content. Edge ingress authenticates the owner and uses the service-only `create_global_share_job_for_user` RPC. Database triggers reject unauthorized queue inserts/transitions. Queue-claim functions filter ineligible owners before `LIMIT` and locking so a stale blocked row cannot starve the batch. The worker rechecks the persisted owner before acquisition, transcription, OCR/model dispatch and retries.

`openaiRecognition.ts` implements the existing model interface against the fixed Responses API endpoint. It uses dedicated credentials/model configuration, `store:false`, bounded text/frames/body/output, timeout and parent cancellation, JSON validation, evidence grounding and no Gemini fallback. Automatic Deep is bypassed until its separate credentials, calls and economics are qualified. Downstream Google Places verification and save rules remain authoritative.

## Activation sequence

1. Approve the audience/provider/legal arrangement and exact markets; publish the approved legal snapshots.
2. Configure a dedicated OpenAI project/key, exact model, region/data controls and measured pricing. Do not reuse unrelated transcription or premium keys.
3. Run the retained, permission-cleared benchmark and compare exact identity, autonomous-save precision, multi-place recall, false positives, user-visible latency, failure rate and all-in cost with the current production baseline.
4. Deploy to Development with `MEDIA_ANALYSIS_PROVIDER=openai`, `MEDIA_OPENAI_RECOGNITION_ENABLED=true`, `NEARR_ALLOWED_PROVIDER_ROUTE=openai_only`, while global release qualification remains false.
5. Exercise one explicitly permitted Development adult account plus denied, withdrawn, stale-client and retry cases; record bounded provider calls and ownership checks.
6. Only after evidence review, set Development legal/market/recognition rows with an evidence reference. Repeat end-to-end and device QA.
7. Prepare a Production backup/restore rehearsal and compatible old-client restriction. Production activation requires a fresh decision; it is not inherited from Development.

## Rollback

Disable `recognition_qualified` or set the provider route to `disabled`, then stop worker dispatch. Keep additive schema, consent records and queue ownership intact. Do not restore the legacy `is_adult_eligible_for_ai` path or Gemini dispatch. Retries must reauthorize before provider work; queued rows can remain preserved until a lawful route resumes or support resolves them.

Offline worker verification passed 663 tests: 656 passed, 7 intentionally skipped live/integration cases, zero failed. This proves adapter and enforcement behavior with mocked transport. It does not prove provider permission, model availability, live accuracy, latency or cost. See [OpenAI candidate details](OPENAI_RECOGNITION_CANDIDATE.md).
