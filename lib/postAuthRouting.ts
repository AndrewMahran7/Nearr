import { routeAfterAuthenticatedUser } from '@/lib/authDeepLinkCore';
import { getOnboardingStatus } from '@/lib/onboarding';

export type PostAuthRoute = '/activate' | '/(tabs)/map';

/**
 * THE post-authentication resolver.
 *
 * Apple, Google, magic link, password sign-in, password sign-up and password
 * recovery all funnel through this one function, so there is no
 * provider-specific routing anywhere in the app:
 *
 *   - a user with no saved places yet  → `/activate` (first-save activation)
 *   - an established user              → `/(tabs)/map`
 *
 * It only READS onboarding status — it never marks `first_save_completed` or
 * mutates saves/extraction state.
 */
export async function resolvePostAuthRoute(userId: string): Promise<PostAuthRoute> {
  const status = await getOnboardingStatus(userId);
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
