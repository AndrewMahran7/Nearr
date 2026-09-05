# Recognition answer-cache read suspension

## Before

```text
new share
  -> create_share_job_for_user
     -> prior completed same-URL job (historical result returned)
  -> canonical content identity
  -> recognition_cache lookup
     -> USER_CONFIRMED / VERIFIED_AUTO_SAVE -> saved result, no inference
     -> CANDIDATE_SET -> cached rerank -> save or review, no inference
  -> singleflight join -> later cache result, no independent inference
  -> otherwise current metadata/media recognition
```

Premium media tasks do not read `recognition_cache`, prior `share_jobs`, prior
hypotheses, or prior Places candidates. The media worker's historical
`candidate_payload` query is restricted to `ai_note_enrichment`, after a place
has already been saved, and is not part of recognition.

## Suspended behavior

`RECOGNITION_CACHE_READS_ENABLED=false` is the server-authoritative state. An
unset or invalid value also fails suspended.

```text
new share
  -> new logical job (completed-result reuse bypassed; request/in-flight dedupe retained)
  -> canonical content identity (no recognition_cache SELECT)
  -> current source metadata and compatible source evidence
  -> current media model inference
  -> current Places resolution and safety gates
  -> normal canonical saved-place dedupe
  -> recognition cache upsert remains enabled
```

No historical rows are deleted or downgraded. Saved-place reads, notes,
corrections, source links, notifications, recommendations, and map behavior do
not use this policy. A source-only saved-place match is not treated as a fresh
answer; canonical place ID/name/distance dedupe remains active after inference.

## Re-enable

1. Set `RECOGNITION_CACHE_READS_ENABLED=true` in the target Supabase project's
   Edge Function secrets.
2. Redeploy or restart only `create-share-job`, `process-share-jobs`, and
   `process-share-link` if the secrets update does not recycle their isolates
   automatically. The third function shares the saved-place source-only reuse
   policy with the asynchronous finalizer.
3. Verify the bounded `recognition_cache_policy` log reports reads enabled and
   run `npm run test:recognition-cache-suspension` plus
   `npm run test:recognition-cache`.

No code rollback, database migration, cache rebuild, Railway deploy, OTA, or
native build is required.
