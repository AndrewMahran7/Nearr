# Production containment proposal — NOT EXECUTED

Observed 2026-10-28 UTC. The current Production worker has Gemini analysis and OpenAI transcription enabled and returns ready. The new 1.7 eligibility and AI-permission schema is absent. This establishes an unqualified release configuration; it does **not** establish that any underage person was processed. No real recognition requests were issued in this audit.

## Exact scope requiring founder cutover approval

- Railway project `4037a3b5-d66f-409e-b734-56c22c244e3e`.
- **Production** environment `49650a9c-4744-4649-8cd1-4ff38473d22f`.
- **Nearr** service `59234570-e2ec-4a7e-86de-22826da86c66` (not Development's media-worker service).
- Current SUCCESS `6e78ebe9-58f7-4799-a90e-86238a1b14e9`, source `e9daf499cfb276ea7072b651642a04218b90ccf9`.
- Supabase `rlqvxdwtetxsqxhqztkw`; legacy Edge ingress also requires containment, not just worker flags.

## Bounded desired outcome

Temporarily stop **new AI recognition**, preserve login, existing saved places, source associations, photos, export/deletion and reminder state. Tell users recognition is temporarily unavailable. Do not delete jobs, reset accounts, reverse migrations, re-enable purchases, or falsely mark jobs successful. Already-dispatched external requests cannot be recalled by a flag change.

## Exact worker flag proposal

Set every currently enabled acquisition/recognition flag false: `AUTOMATIC_DEEP_RECOGNITION_ENABLED`, `FACEBOOK_MEDIA_RESOLVER_ENABLED`, `INSTAGRAM_MEDIA_RESOLVER_ENABLED`, `MEDIA_FALLBACK_ENABLED`, `NATIVE_VIDEO_ANALYSIS_ENABLED`, `RECOGNITION_CACHE_READS_ENABLED`, `SCRAPECREATORS_FACEBOOK_FALLBACK_ENABLED`, `SCRAPECREATORS_INSTAGRAM_FALLBACK_ENABLED`, `SCRAPECREATORS_TIKTOK_FALLBACK_ENABLED`, `SNAPCHAT_MEDIA_RESOLVER_ENABLED`, `TIKTOK_MEDIA_RESOLVER_ENABLED`, `VAYRIN_VERIFICATION_V3_ENABLED`, `VAYRIN_VISUAL_GEOLOCATION_ENABLED`, `YOUTUBE_MEDIA_RESOLVER_ENABLED`. Preserve `PREMIUM_REQUESTS_ENABLED=false`.

Set `MEDIA_ANALYSIS_PROVIDER=disabled`, `MEDIA_TRANSCRIPTION_PROVIDER=noop`, `MEDIA_OCR_PROVIDER=noop`, `MEDIA_OPENAI_RECOGNITION_ENABLED=false`, `NEARR_ALLOWED_PROVIDER_ROUTE=disabled`. Do not erase or copy secrets. These names and values are proven on the current Development unified worker, **not assumed to be enforced by the September Production executable**.

## Required sequence before execution

1. Re-read exact deployment/source/variables/Edge hashes and migration state; abort on unreviewed changes. Capture aggregate queue/ownership state and an isolated, restorable backup. A private database-only archive and isolated restoration now pass (see BACKEND_QUALIFICATION.md and restore-receipt.json). The provider backup API lists no concrete restore point and PITR=false; Storage-object recovery and hosted disaster recovery are not established. Reconcile any writes since the recorded archive before a cutover.
2. Resolve the six Production-only migrations and 23 absent local IDs. Do not blanket `db push`: Development-only markers/catalog changes and Production-specific notification/source guards must be preserved and reconciled.
3. Prepare and test a minimal additive containment gate across **all ingress/direct Edge provider calls, queue enqueue/claim and worker dispatch**. Worker-only switches cannot prove zero dispatch from legacy Edge sources. Decide safe in-flight handling and truthful temporary-unavailable response for public 1.4 clients.
4. Apply the approved gate/cutover in the narrowest window, then the exact compatible globally gated worker/Edge source with the disabled configuration. Do not blindly deploy the 1.7 worker against the unreconciled Production schema.
5. Read back health 200, deliberately closed processing readiness, actual blocked ingress, zero new provider dispatch, unchanged owned saves/source links and intact queue records. Monitor in-flight completion and error counts; do not equate closed readiness with an outage in Supabase.

## Rollback constraint

Rollback stays fail-closed: retain the new additive containment gate and restore only a tested compatible gated build with all dispatch disabled. The September Gemini-enabled image/config is **not** an acceptable rollback for 1.7. If safe zero-dispatch cannot be established, stop the affected cutover and keep existing data intact; do not use destructive queue cleanup or unproven database restore.

## Founder decision

Approve or decline a planned temporary interruption of new Production recognition while existing saved data remains accessible. Approval is for a reviewed, tested containment/cutover plan—not permission to bypass missing provider contracts, restore proof or migration reconciliation. No Production action has been taken by this audit.
