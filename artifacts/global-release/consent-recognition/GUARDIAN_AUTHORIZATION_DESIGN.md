# Guardian authorization design and current hold

The present database deliberately has `minor_ai_qualified=false` and returns `guardian_authorization_required` for 13–17 accounts. No teen can approve their own guardian record. An email link alone would show mailbox access, not legal authority; no verified guardian process was available in this session.

Before opening teen AI, select and approve an identity/relationship verification method, its processor terms, data retention, cost, appeal and revocation process. An implementation must bind the verified guardian to the teen account and exact permission scope/version, record pending/denied/approved/expired/revoked status and audit evidence, prevent replay/self-authorization, and recheck current status at enqueue and provider dispatch. The owner must review whether guardian permission is needed for account use, AI processing, or both in each market. No paid verification service was purchased or activated.
