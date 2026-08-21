import { routeAfterAuthenticatedUser } from '@/lib/authDeepLinkCore';
import { getOnboardingStatus } from '@/lib/onboarding';
import { isOnboardingV2Enabled } from '@/lib/featureFlags';
import {
  bypassOnboardingV2ForExistingUser,
  getOnboardingV2State,
} from '@/lib/onboardingV2';
import { finishOnboardingAccountTransition } from '@/lib/anonymousOnboarding';
import { resolveOpenSavedPlaceRoute, type MapRouteTarget } from '@/lib/openSavedPlace';
import { supabase } from '@/lib/supabase';

export type PostAuthRoute = '/activate' | '/(tabs)/map' | MapRouteTarget;

/**
 * THE post-authentication resolver.
 *
 * Apple, Google, magic link, password sign-in, password sign-up and password
 * recovery all funnel through this one function, so there is no
 * provider-specific routing anywhere in the app:
 *
 *   - a V2 tutorial conversion          → exact transferred Place Detail
 *   - a user with no saved places yet   → `/activate` (first-save activation)
 *   - an established user               → `/(tabs)/map`
 *
 * It never marks `first_save_completed` or re-resolves a tutorial place. The
 * V2 transition finalizes the existing row, then routes by its returned id.
 */
export async function resolvePostAuthRoute(userId: string): Promise<PostAuthRoute> {
  if (isOnboardingV2Enabled()) {
    const state = await getOnboardingV2State();
    if (state.tutorialSave && state.identityLifecycle !== 'permanent_account') {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session || session.user.id !== userId || session.user.is_anonymous === true) {
        throw new Error('permanent_onboarding_session_not_ready');
      }
      const transition = await finishOnboardingAccountTransition(session.user);
      return resolveOpenSavedPlaceRoute({
        savedPlaceId: transition.tutorialSavedPlaceId,
        source: 'onboarding_tutorial',
      });
    }
  }
  const status = await getOnboardingStatus(userId);
  if (isOnboardingV2Enabled() && status === 'complete') {
    // Signing into an established account must never layer a fresh-user tour
    // over an existing map. This migration is explicit and emits no false
    // behavioral-completion event.
    await bypassOnboardingV2ForExistingUser(userId);
  }
  return routeAfterAuthenticatedUser(status);
}

// ---------------------------------------------------------------------------
// In-flight latch
//
// A screen that signs a user in (Apple / Google / password) needs a moment to
// read the onboarding status before it can pick between `/activate` and the
// map. AuthGate reacts to the new session immediately and would otherwise pull
// the user to `/(tabs)/map` first, making a brand-new user flash past the
// first-save activation step.
//
// While this latch is raised, AuthGate leaves the auth/onboarding routes alone
// and lets the resolver above own the destination. Callers MUST pair every
// `begin` with an `end` in a `finally`.
// ---------------------------------------------------------------------------
let pendingPostAuthRoutes = 0;

export function beginPostAuthRouting(): void {
  pendingPostAuthRoutes += 1;
}

export function endPostAuthRouting(): void {
  pendingPostAuthRoutes = Math.max(0, pendingPostAuthRoutes - 1);
}

export function isPostAuthRoutingPending(): boolean {
  return pendingPostAuthRoutes > 0;
}
