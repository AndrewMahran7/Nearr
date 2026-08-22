import type { OnboardingV2Stage } from './onboardingV2Core';

export type OnboardingV2Route =
  | '/(onboarding)'
  | '/(onboarding)/account'
  | '/activate'
  | '/(tabs)/map';

export type PendingOnboardingNavigation = {
  from: string;
  to: OnboardingV2Route;
} | null;

/** Turn Expo Router's segment array into a stable, group-aware route key. */
export function onboardingRouteKey(segments: readonly string[]): string {
  if (segments.length === 0) return '/';
  if (segments[0] === '(onboarding)') {
    return segments[1] === 'account' ? '/(onboarding)/account' : '/(onboarding)';
  }
  if (segments[0] === '(tabs)' && segments[1] === 'map') return '/(tabs)/map';
  return `/${segments.join('/')}`;
}

/** The single route that owns each durable V2 stage. */
export function expectedOnboardingV2Route(
  stage: OnboardingV2Stage | null | undefined,
): OnboardingV2Route | null {
  if (!stage) return null;
  if (stage === 'account_required') return '/(onboarding)/account';
  if (stage.startsWith('tutorial_')) return '/activate';
  if (
    stage === 'place_tour' ||
    stage === 'phase1_complete' ||
    stage === 'practice_ready' ||
    stage === 'first_independent_external_video_opened' ||
    stage === 'first_independent_share_returned' ||
    stage === 'first_independent_save_complete' ||
    stage === 'second_independent_external_video_opened' ||
    stage === 'second_independent_share_returned' ||
    stage === 'graduated'
  ) return '/(tabs)/map';
  return '/(onboarding)';
}

/**
 * A route reconciliation is an edge, not a render side effect. Once an edge
 * has been dispatched it remains suppressed until the router reaches its
 * destination (or the semantic source/destination changes).
 */
export function shouldNavigateOnboarding(input: {
  currentRoute: string;
  expectedRoute: OnboardingV2Route | null;
  pendingNavigation?: PendingOnboardingNavigation;
}): boolean {
  if (!input.expectedRoute || input.currentRoute === input.expectedRoute) return false;
  return !(
    input.pendingNavigation?.from === input.currentRoute &&
    input.pendingNavigation.to === input.expectedRoute
  );
}
