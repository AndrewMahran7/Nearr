# Separate AI-sharing permission

The existing prompt explains post link, caption, creator/location details, frames and sometimes audio sent for place identification to OpenAI. The Terms action now uses the atomic legal RPC and confirms server readback before displaying AI permission. The AI action still calls the independent `set_ai_sharing_permission` RPC and checks fresh `aiAllowed`; Settings can withdraw it. A decline or withdrawal preserves saved places and blocks future provider dispatch through the existing queue and worker checks.

The user still needs a final approved processor disclosure including the exact media acquisition and transcription recipients, retention, and region. This source change does not enable any provider.
