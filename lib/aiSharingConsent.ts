export const AI_NOTICE_VERSION = 'nearr-ai-openai-v1';
export type ConsentTransport = { supabaseUrl: string; accessToken: string; publicKey: string };
export async function consentRpc(transport: ConsentTransport, method: string, body: Record<string, unknown> = {}): Promise<unknown> {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(transport.supabaseUrl) || !transport.accessToken || !transport.publicKey) throw new Error('consent_auth_required');
  const response = await fetch(`${transport.supabaseUrl}/rest/v1/rpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${transport.accessToken}`, apikey: transport.publicKey },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('consent_unavailable');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function allowAiSharing(transport: ConsentTransport): Promise<void> {
  await consentRpc(transport, 'set_ai_sharing_permission', { p_allowed: true, p_notice_version: AI_NOTICE_VERSION });
}
export async function revokeAiSharing(transport: ConsentTransport): Promise<void> {
  await consentRpc(transport, 'set_ai_sharing_permission', { p_allowed: false, p_notice_version: AI_NOTICE_VERSION });
}
