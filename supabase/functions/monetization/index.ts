// Nearr place-find balance and Dev-only mock purchase endpoint.
// Real StoreKit verification is intentionally NOT simulated here. The mock
// grant path is available only in the exact Nearr-Dev project, behind a server
// flag, and to an explicit server-side user allowlist.

// @ts-nocheck -- Supabase Edge/Deno runtime.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { premiumRequestsEnabled } from '../_shared/premiumRequests.ts';
import { PREMIUM_REQUESTS_SUSPENDED_REASON } from '../../../lib/premiumRequestsPolicy.ts';

const NEARR_DEV_PROJECT_REF = 'qnfxnmvxpjzfydgudtvs';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function bearer(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function projectRef(url: string): string | null {
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

function allowedMockUser(userId: string): boolean {
  const allowlist = (Deno.env.get('MONETIZATION_DEV_TEST_USER_IDS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.includes(userId);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'server_misconfigured' }, 500);
  const token = bearer(req);
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) return json({ ok: false, error: 'unauthorized' }, 401);
  const user = authData.user;
  const isAnonymous = user.is_anonymous === true;
  const isDevProject = projectRef(supabaseUrl) === NEARR_DEV_PROJECT_REF;
  const mockEnabled = isDevProject && Deno.env.get('MONETIZATION_DEV_MOCK_ENABLED') === 'true';
  const mockAuthorized = mockEnabled && allowedMockUser(user.id) && !isAnonymous;

  let body: {
    action?: string;
    productId?: string;
    clientPurchaseId?: string;
    jobId?: string;
    premiumJobId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const action = body.action ?? 'balance';

  // The server is authoritative. Reject every monetization entry point before
  // wallet creation, reservation, task creation, purchase, or Premium RPC work.
  // Existing reserved/processing requests settle through process-share-jobs
  // and never pass through this initiation endpoint.
  if (!premiumRequestsEnabled()) {
    return json({ ok: false, error: PREMIUM_REQUESTS_SUSPENDED_REASON }, 503);
  }

  if (action === 'balance' || action === 'sync') {
    const { data, error } = await admin.rpc('ensure_place_find_wallet', {
      p_user_id: user.id,
      p_is_anonymous: isAnonymous,
    });
    if (error || !Array.isArray(data) || !data[0]) {
      console.warn(`[monetization] balance_failed code=${error?.code ?? 'unknown'}`);
      return json({ ok: false, error: 'balance_unavailable' }, 503);
    }
    const { data: products } = isDevProject
      ? await admin
          .from('place_find_products')
          .select('product_id,use_count,mock_display_price,sort_order')
          .eq('product_kind', 'dev_mock')
          .order('sort_order')
      : { data: [] };
    return json({
      ok: true,
      balance: {
        available: data[0].available_uses,
        reserved: data[0].reserved_uses,
        version: data[0].version ?? null,
      },
      products: (products ?? []).map((product) => ({
        productId: product.product_id,
        uses: product.use_count,
        displayPrice: product.mock_display_price,
        priceSource: 'dev_mock_config',
      })),
      mode: isDevProject ? 'dev_mock' : 'storekit_unavailable',
      mockPurchaseAuthorized: mockAuthorized,
      purchaseUnavailableReason: isAnonymous
        ? 'permanent_account_required'
        : mockAuthorized
        ? null
        : isDevProject
        ? 'dev_mock_not_authorized'
        : 'storekit_not_integrated',
    });
  }

  if (action === 'mock_purchase') {
    if (!isDevProject) return json({ ok: false, error: 'production_mock_forbidden' }, 403);
    if (!mockEnabled) return json({ ok: false, error: 'dev_mock_disabled' }, 403);
    if (!mockAuthorized) return json({ ok: false, error: 'dev_test_user_required' }, 403);
    const productId = typeof body.productId === 'string' ? body.productId : '';
    const clientPurchaseId = typeof body.clientPurchaseId === 'string' ? body.clientPurchaseId : '';
    // Mock products are stored inactive in the portable migration so a future
    // production schema apply cannot expose them. Only this triple-gated Dev
    // path activates the selected mock SKU.
    const activation = await admin
      .from('place_find_products')
      .update({ active: true })
      .eq('product_kind', 'dev_mock')
      .eq('product_id', productId);
    if (activation.error) return json({ ok: false, error: 'mock_product_activation_failed' }, 503);
    const { data, error } = await admin.rpc('apply_dev_mock_place_find_purchase', {
      p_user_id: user.id,
      p_product_id: productId,
      p_client_purchase_id: clientPurchaseId,
    });
    if (error || !Array.isArray(data) || !data[0]) {
      console.warn(`[monetization] mock_purchase_failed code=${error?.code ?? 'unknown'}`);
      return json({ ok: false, error: 'purchase_not_applied' }, 409);
    }
    let resumedJob = null;
    if (typeof body.premiumJobId === 'string' && body.premiumJobId) {
      const resumed = await admin.rpc('request_premium_recognition', {
        p_user_id: user.id,
        p_job_id: body.premiumJobId,
      });
      if (resumed.error) {
        console.warn(`[monetization] premium_resume_after_purchase_failed code=${resumed.error.code ?? 'unknown'}`);
      } else {
        resumedJob = Array.isArray(resumed.data) ? resumed.data[0] ?? null : null;
      }
    } else if (typeof body.jobId === 'string' && body.jobId) {
      const resumed = await admin.rpc('resume_place_find_job', {
        p_user_id: user.id,
        p_job_id: body.jobId,
      });
      if (resumed.error) {
        console.warn(`[monetization] resume_after_purchase_failed code=${resumed.error.code ?? 'unknown'}`);
      } else {
        resumedJob = Array.isArray(resumed.data) ? resumed.data[0] ?? null : null;
      }
    }
    return json({
      ok: true,
      balance: { available: resumedJob?.available_uses ?? data[0].available_uses },
      grantedUses: data[0].granted_uses,
      replayed: data[0].replayed,
      resumedJob,
    });
  }

  if (action === 'request_premium') {
    if (isAnonymous) return json({ ok: false, error: 'permanent_account_required' }, 403);
    if (typeof body.premiumJobId !== 'string' || !body.premiumJobId) {
      return json({ ok: false, error: 'job_id_required' }, 400);
    }
    const { data, error } = await admin.rpc('request_premium_recognition', {
      p_user_id: user.id,
      p_job_id: body.premiumJobId,
    });
    if (error) {
      const message = String(error.message ?? '');
      const notEligible = message.includes('premium_job_not_eligible');
      const notFound = message.includes('premium_job_not_found');
      console.warn(`[monetization] premium_request_failed code=${error.code ?? 'unknown'}`);
      return json(
        { ok: false, error: notEligible ? 'premium_not_eligible' : notFound ? 'premium_job_not_found' : 'premium_request_failed' },
        notEligible ? 409 : notFound ? 404 : 500,
      );
    }
    const job = Array.isArray(data) ? data[0] ?? null : null;
    return json({
      ok: true,
      job,
      requiresPurchase: job?.requires_purchase === true,
      balance: { available: job?.available_uses ?? null },
    });
  }

  if (action === 'resume_job') {
    if (isAnonymous) return json({ ok: false, error: 'permanent_account_required' }, 403);
    if (typeof body.jobId !== 'string' || !body.jobId) return json({ ok: false, error: 'job_id_required' }, 400);
    const { data, error } = await admin.rpc('resume_place_find_job', {
      p_user_id: user.id,
      p_job_id: body.jobId,
    });
    if (error) {
      const insufficient = String(error.message ?? '').includes('insufficient_place_finds');
      return json({ ok: false, error: insufficient ? 'insufficient_place_finds' : 'resume_failed' }, insufficient ? 409 : 500);
    }
    const job = Array.isArray(data) ? data[0] ?? null : null;
    return json({ ok: true, job, balance: { available: job?.available_uses ?? null } });
  }

  // A real StoreKit callback must be cryptographically verified server-side.
  // Until the native client + Apple verification service are installed, fail
  // closed instead of granting from a client success callback.
  if (action === 'verify_storekit_purchase') {
    return json({ ok: false, error: 'storekit_verification_not_configured' }, 503);
  }
  return json({ ok: false, error: 'unknown_action' }, 400);
});
