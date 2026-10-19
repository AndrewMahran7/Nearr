# Adult-only recognition entry-point audit (local code, 2026-10-18)

The entries below describe **proposed local code** unless marked deployed. Authentication is a validated Supabase session/JWT or a server-owned queued row. Eligibility is the server-owned `account_age_eligibility` decision, not a request flag. Nearr-Dev has the DB migration, but the modified Edge and Railway worker have not been deployed.

| Path | Auth / owner | Older or anonymous client? | Can reach third-party AI? | Restriction and proof state |
| --- | --- | --- | --- | --- |
| Offline Phase 1 fixture | Local tutorial, no server account required | Yes | No; bundled deterministic fixture | No age/network dependency. Existing tutorial regressions still needed. |
| Anonymous Phase 2 real share | Supabase anonymous authenticated owner | Yes, after Phase 1 | Yes via normal share pipeline | Account-bound 18+ declaration required before live path; transfer trigger carries eligible state. Device/transfer proof pending. |
| Permanent email / Google / Apple sign-in and restored sessions | Supabase session | Yes | Indirectly through share | New `AuthGate` prompts pending accounts; only server decision authorizes backend. Provider-specific device proof pending. |
| iOS current Share Extension; Instagram/TikTok/Facebook/YouTube share URLs | Shared session token, validated by `create-share-job` | Yes | Queued recognition | Edge check, DB insert guard, dispatch recheck; tailored 403 UI in replacement binary. Not live-tested. |
| Old extension and Nearr 1.4 synchronous share | Valid bearer token at `process-share-link` | Yes | Metadata and recognition | Local Edge check before metadata. Deployed old-client replay pending. |
| Host handoff / Android intent / deep link / paste URL | Host session | Yes | `create-share-job` or legacy fallback | Backend checks both; host displays denial. Local legacy direct Gemini call disabled. |
| Direct API, forged client age flag, expired token | JWT must resolve actual account | Yes | Could enqueue if unchecked | Edge derives owner from JWT, ignores any age boolean; DB triggers reject noneligible queued rows. Live negative tests pending. |
| `share_jobs` database insert/requeue | Service role or authorized RPC, stored `user_id` | Existing deferred rows too | Leads to processing | Dev DB trigger blocks new queued/awaiting-purchase jobs and requeue, worker rechecks old accepted rows. Direct SQL/RPC adversarial test pending. |
| `share_media_tasks` insert/requeue, premium/AI-note/enrichment | Service role/RPC, stored `user_id` | Existing saved places can generate tasks | Gemini, OpenAI transcription/Responses, OCR | Dev DB trigger blocks new queued tasks; local worker checks task start and before each external model path. Railway deployment pending. |
| `process-share-jobs` scheduled sweep/retry | Internal secret, stored job owner | Yes, including old jobs | Metadata and media handoff | Local `processOne` checks owner before provider work; callback checks task owner before commit. Dev v142 source-parity unresolved. |
| Railway media worker claim/retry/recovery | Internal service-role, stored task owner | Yes, including pre-rollout tasks | Yes, directly | Local task-start + pre-transcription/OCR/model checks. Dev deployment blocked by source-branch parity. |
| `lib/aiExtractPlace` mobile fallback | App session, previously bundle key-dependent | Old app remains separate | Could call Gemini if key bundled | New 1.5 app passes `allowProviderCall:false`; scripts retain server-side evaluation. Typecheck passed. |

Other authenticated account and map mutations do not themselves dispatch AI. User-specific saved-place RLS remains unchanged; the gate visually restricts the app but does not erase or reassign data. This audit does not claim every monetization/quick-check path has a deployed Dev proof; queue triggers and worker checks are intended as common enforcement points.

Source anchors: `app/_layout.tsx`, `app/share.tsx`, `ShareExtension.tsx`, `components/ShareJobHandoff.tsx`, `supabase/functions/{create-share-job,process-share-link,process-share-jobs}/index.ts`, `supabase/migrations/20261018000001_adult_age_eligibility.sql`, `services/media-worker/src/pipeline/runMediaTask.ts`, `services/media-worker/src/db/tasks.ts`.
