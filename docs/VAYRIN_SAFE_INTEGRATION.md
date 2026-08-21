# Vayrin Core safe-baseline integration

Vayrin is the finder inside Nearr. This integration adds the recognition engine only; it does not add the separate Product UI, AI Notes, onboarding, platform parity, or long-caption work.

## Safe development enablement

The worker defaults to `VAYRIN_VISUAL_GEOLOCATION_ENABLED=false`. Nearr-Dev testing uses Railway project `4037a3b5-d66f-409e-b734-56c22c244e3e`, environment `development`, service `media-worker`, and Supabase project `qnfxnmvxpjzfydgudtvs`.

After verifying those targets and confirming that a server-only OpenAI credential is already present, enable and deploy in this order:

```powershell
railway variable set VAYRIN_VISUAL_GEOLOCATION_ENABLED=true --skip-deploys --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment development --service media-worker
npm run dev:functions -- process-share-jobs --yes
npm run dev:worker -- --yes
```

The Edge wrapper must report only `process-share-jobs`, Nearr-Dev, and `--no-verify-jwt`. The worker wrapper verifies the service's `SUPABASE_URL` resolves to `qnfxnmvxpjzfydgudtvs` before Railway receives a deploy. Do not set the flag or run these commands against production.

No database migration, changed RPC, new index, or new Edge secret is required. The OpenAI credential remains server-only in the existing Railway environment. `VAYRIN_MODEL` may remain unset to use `gpt-5.6-sol`; the default frame budget is six diverse timestamped frames.

## Save From Link QA with the current build

| Test | Input | Expected result | Verify |
| --- | --- | --- | --- |
| Easy place | Post with a clear exact name/address | Existing cheap path resolves; Vayrin reports `invoked=false` | job result and worker diagnostics |
| Coarse to exact | Video whose metadata provides only a city/region | Vayrin runs and may return a stronger scene-grounded exact place | worker `diagnostics.vayrin`, job mention slots |
| Natural/informal | Hidden or natural location absent from Places | Structured lead survives without a fabricated provider ID or coordinates | `lead`, `mentionSlots`, and manual review payload |
| Same-scene ambiguity | One scene with two credible identities | One `logicalPlaceId`, ranked alternatives/candidates, no silent save | mention slot and media auto-save log |
| Multi-place | Video with distinct scenes | Separate logical place IDs and timestamp-associated evidence | evidence places, mention slots, multi-place review |
| Hard negative | Scene without specific grounded evidence | No exact answer is fabricated; manual/no-evidence path remains | Vayrin hypothesis count and final decision |

Inspect the worker task by job ID. Persisted diagnostics show whether Vayrin ran, trigger reason, model/prompt, frame count/strategy, latency, token usage, estimated cost, hypothesis/alternative counts, and multi-place classification. Evidence/result payloads preserve logical place IDs, timestamps, evidence basis, provider candidates, and non-Places leads. The bounded media auto-save log records the job ID, logical place ID, candidate counts, provider selection, rejection/conflict reasons, and final decision. Logs must never include keys, auth headers, access tokens, or full private captions.

## Build boundary

Save From Link through the current app plus Metro and the development backend can exercise Vayrin Core. An iOS export verifies bundling only. The current installed Share Extension binary cannot validate the newer native extension lifecycle/handoff fixes; that remains open until a future EAS development build.

## Later integration seam

Vayrin currently consumes the baseline bounded `metadataTitle` and `metadataDescription` fields. Long Caption Preservation must later feed its retained 10,000-character source and bounded 4,000-character model excerpt through this context boundary without changing Vayrin's evidence or result contracts.
