// Development-only, authenticated public orchestration read for Onboarding V2.
// It returns source identity + launch presentation only. Place truth and all
// fixture-management fields stay server-side until the normal share job resolves.
// @ts-nocheck -- Deno runtime.

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { onboardingTutorialPreviewUrl } from '../../../lib/onboardingTutorialPreview.ts';
import { prioritizeOnboardingTutorialFixtures } from './selection.ts';

const DEVELOPMENT_HOST = 'qnfxnmvxpjzfydgudtvs.supabase.co';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SUPPORTED_PLATFORMS = new Set(['instagram', 'tiktok', 'facebook', 'youtube']);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function isDevelopmentDeployment(supabaseUrl: string): boolean {
  try { return new URL(supabaseUrl).hostname === DEVELOPMENT_HOST; } catch { return false; }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!isDevelopmentDeployment(supabaseUrl)) return json({ error: 'not_found' }, 404);
  if (!serviceRoleKey) return json({ error: 'server_misconfigured' }, 500);

  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!accessToken) return json({ error: 'missing_auth' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData?.user) return json({ error: 'invalid_auth' }, 401);

  let preferredPlatform: string | null = null;
  try {
    const body = await request.json();
    if (body?.preferredPlatform != null) {
      if (typeof body.preferredPlatform !== 'string' || !SUPPORTED_PLATFORMS.has(body.preferredPlatform)) {
        return json({ error: 'invalid_preferred_platform' }, 400);
      }
      preferredPlatform = body.preferredPlatform;
    }
  } catch {
    // An empty body is backward compatible with older Development clients.
  }

  const { data: rows, error } = await admin
    .from('onboarding_tutorial_fixtures')
    .select('id,identity_key,identity_version,platform,content_id,canonical_url,role,priority,verification_revision')
    .eq('status', 'active')
    .eq('health_state', 'healthy')
    .gt('health_expires_at', new Date().toISOString())
    .order('role', { ascending: false })
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(12);
  if (error) return json({ error: 'fixture_lookup_failed' }, 503);

  // The database ordering remains the fallback authority. A healthy exact
  // platform match is only moved ahead of otherwise eligible candidates.
  const orderedRows = prioritizeOnboardingTutorialFixtures(rows ?? [], preferredPlatform);

  for (const row of orderedRows) {
    const { data: eligible, error: eligibilityError } = await admin.rpc('resolve_onboarding_tutorial_fixture', {
      p_identity_key: row.identity_key,
      p_identity_version: row.identity_version,
      p_platform: row.platform,
      p_content_id: row.content_id,
      p_canonical_url: row.canonical_url,
    });
    if (eligibilityError || !Array.isArray(eligible) || eligible.length !== 1) continue;
    return json({
      fixtureId: row.id,
      fixtureRevision: row.verification_revision,
      fixtureRole: row.role,
      platform: row.platform,
      identityKey: row.identity_key,
      identityVersion: row.identity_version,
      contentId: row.content_id,
      canonicalUrl: row.canonical_url,
      launchUrl: row.canonical_url,
      thumbnailUrl: onboardingTutorialPreviewUrl(row.platform, row.content_id),
      selectedAt: new Date().toISOString(),
    });
  }
  return json({ error: 'fixture_unavailable' }, 503);
});
