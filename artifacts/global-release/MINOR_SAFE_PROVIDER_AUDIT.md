# Recognition-provider audit for a 13+ audience

Reviewed 25 October 2026. Outcome: **no provider path is qualified for Nearr's intended 13+ audience. Recognition remains disabled.** The audit separates API availability from contractual permission, privacy qualification and product quality.

| Component | Current finding | Release decision |
|---|---|---|
| Gemini API / Vertex Gemini | The applicable terms and deployment context have not produced an affirmative documented permission for a consumer app directed to or likely accessed by under-18 users. Paid or server-side use is not treated as an exception. | Prohibited by `providerAudiencePolicy`; old eligibility alias remains closed. |
| OpenAI API candidate | The Services Agreement says customers must not allow minors to use OpenAI services without parent/guardian consent. Nearr has no verified guardian mechanism. API data is not used for training by default, but abuse-monitoring content can ordinarily be retained up to 30 days. | Adapter prepared and tested offline; not qualified for minors, any region, or live use. |
| Anthropic API | Anthropic has described organizational API use for minors as possible only with specific safety features and disclosures. Nearr has not accepted or documented a qualifying arrangement, nor benchmarked this route. | Not implemented or approved. |
| SoScripted / transcription | Existing third-party transcription route lacks a completed minor-audience, retention, geography and subprocessor qualification in this release record. | Blocked from the global route. |
| Social-media acquisition providers | URLs, media, captions and metadata may contain personal data. Provider terms, source-platform permission, retention and regional transfers require service-by-service review. | Existing acquisition code does not establish permission; recognition gate prevents dispatch. |
| Google Places | Used for identity resolution after candidate extraction. It does not authorize upstream AI processing and its own license/privacy requirements still apply. | May remain in the architecture only after the whole route qualifies. |
| Self-hosted models | Could reduce vendor audience restrictions but would still require licensed weights, secure hosting, content safety, accuracy, operations and privacy review. | No approved model or hosting budget; not release-ready. |

Primary references: [OpenAI Services Agreement](https://openai.com/policies/services-agreement/), [OpenAI under-18 API guidance](https://platform.openai.com/docs/guides/safety-best-practices), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Anthropic policy explanation for minor-facing API products](https://www.anthropic.com/news/updating-our-usage-policy), [Google Gemini API Terms](https://ai.google.dev/gemini-api/terms), and [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms).

## Required evidence before qualification

For the exact contracting account, model, endpoint and markets, obtain written/archived terms showing that the audience and guardian design are permitted; document controller/processor roles, DPA, subprocessors, regions, retention and deletion; complete child/teen safety and incident controls; and verify that source media may be sent. Then run the retained benchmark against the production behavior baseline for exact-place identity, autonomous-save precision, multi-place recall, false saves, latency, failure rate and full-path cost. A provider must pass both permission and performance gates.

No live provider call or paid experiment was made for this audit. No provider result, accuracy number or price is invented. The safest current behavior is the implemented one: fail closed before acquisition/model work, recheck before queue claims and worker dispatch, preserve existing saved data, and give a clear unavailable/update path.
