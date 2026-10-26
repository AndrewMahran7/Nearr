# Legacy-client compatibility

The public 1.4 app and old Share Extension do not contain the new regional declaration, exact Terms/privacy flow, AI-sharing prompt, Plus UI or runtime localization. They cannot be represented as compliant 13+ clients.

The server therefore owns the safety boundary. The legacy `is_adult_eligible_for_ai` predicate is forced false. New global ingress authenticates the caller and checks current eligibility; queue/media triggers enforce the same rule at insert and processing transitions; claim functions skip ineligible owners; and the worker rechecks the persisted owner before provider work and retry. A stale client cannot reopen Gemini or satisfy consent with a local boolean. Unknown/malformed decisions fail closed with an update/restriction response.

Historical saved places and account/privacy controls remain accessible. Additive migrations do not rewrite owners, delete places, consume token balances or copy consent during account transfer. A destination account keeps any more-restrictive declaration and must establish its own current permissions. Restriction or subscription expiry affects new recognition, not prior saved data.

Compatibility table:

| Client | Read saved data | New recognition | Required action |
|---|---|---|---|
| Public iOS 1.4 / old extension | Preserve where existing APIs remain compatible | Denied by server because it cannot establish global-v1 eligibility/permission | Show clear update path; verify actual legacy error rendering before cutover. |
| Fieldnotes 1.6.59 OTA | Preserve | Denied unless it contains and completes the exact new contract; historical OTA is not assumed compatible | Install native 1.7.0 candidate. |
| Unified 1.7.0 candidate | Preserve | Still denied while legal/market/provider gates are closed | Complete declaration, approved Terms/notice, AI permission and qualified route after release approval. |

Before Production, test an actual public 1.4 binary and extension against the staged backend: open existing saves, export/delete account, attempt new share, retry an old queued job, switch accounts and upgrade in place. If the old UI loops or hides the update reason, introduce a server minimum-version response and an understandable Store update path. Do not re-enable an unsafe route to maintain apparent backward compatibility.
