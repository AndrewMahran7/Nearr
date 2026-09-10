import { NEARR_DEV_SUPABASE_REF } from './appEnvironmentCore';
import type {
  OnboardingInterest,
  OnboardingPainPoint,
  OnboardingPermissionResult,
  OnboardingPlatform,
  OnboardingV2Stage,
} from './onboardingV2Core';

export const ONBOARDING_V2_SECOND_HALF_STAGES = new Set<OnboardingV2Stage>([
  'why_nearr',
  'nearby_value',
  'location_education',
  'location_background_education',
  'notification_education',
  'growing_map',
  'account_required',
  'auth_success',
  'personalized_activation',
  'activation_challenge',
  'onboarding_complete',
]);

export function canRunOnboardingV2SecondHalf(input: {
  appEnv: string;
  backendEnv: string;
  appEnvWasDefaulted: boolean;
  backendEnvWasDefaulted: boolean;
  supabaseProjectRef: string | null;
}): boolean {
  return input.appEnv === 'development' && input.backendEnv === 'development' &&
    !input.appEnvWasDefaulted && !input.backendEnvWasDefaulted &&
    input.supabaseProjectRef === NEARR_DEV_SUPABASE_REF;
}

export function normalizeOnboardingPermission(input: {
  status?: string | null;
  canAskAgain?: boolean | null;
  provisional?: boolean;
}): OnboardingPermissionResult {
  if (input.provisional) return 'provisional';
  if (input.status === 'granted') return 'granted';
  if (input.status === 'denied') return input.canAskAgain === false ? 'restricted' : 'denied';
  return 'unavailable';
}

export function painPointValueCopy(painPoint: OnboardingPainPoint | null): string {
  switch (painPoint) {
    case 'cannot_find_place': return 'Nearr turns the post into an actual place you can visit.';
    case 'saved_posts_mess': return 'Your places now live on a map instead of in a pile of bookmarks.';
    case 'send_to_friends': return 'Keep the destination useful even after it disappears into a chat.';
    case 'screenshot': return 'A screenshot becomes a place with a name, map, and route back to the source.';
    default: return 'Nearr keeps the place useful after the post disappears into your saves.';
  }
}

export function interestExample(interests: readonly OnboardingInterest[]): string {
  if (interests.includes('outdoors') || interests.includes('beaches')) return 'viewpoints, trails, and beaches';
  if (interests.includes('food') || interests.includes('cafes')) return 'restaurants and cafes';
  if (interests.includes('travel')) return 'destinations, stays, and attractions';
  if (interests.includes('shopping')) return 'shops and markets';
  if (interests.includes('things_to_do')) return 'activities and places to explore';
  return 'anything interesting you find';
}

export function nearbyExample(interests: readonly OnboardingInterest[]): string {
  if (interests.includes('cafes')) return 'A saved cafe';
  if (interests.includes('food')) return 'A saved restaurant';
  if (interests.includes('outdoors') || interests.includes('beaches')) return 'A saved viewpoint';
  if (interests.includes('shopping')) return 'A saved shop';
  return 'A saved place';
}

export function personalizedActivationCopy(input: {
  platform: OnboardingPlatform | null;
  interest: OnboardingInterest | null;
}): string {
  const interest = input.interest;
  if (interest === 'outdoors' || interest === 'beaches') return 'Find another outdoor spot worth remembering.';
  if (interest === 'food' || interest === 'cafes') return 'Save a place you actually want to try.';
  if (interest === 'travel') return 'Add another place for your next trip.';
  if (interest === 'shopping') return 'Keep the next shop or market that catches your eye.';
  if (interest === 'things_to_do') return 'Turn your next idea into somewhere you can go.';
  return `Share one more find from ${platformName(input.platform)} when it catches your eye.`;
}

export function platformName(platform: OnboardingPlatform | null): string {
  switch (platform) {
    case 'instagram': return 'Instagram';
    case 'tiktok': return 'TikTok';
    case 'facebook': return 'Facebook';
    case 'youtube': return 'YouTube';
    default: return 'your feed';
  }
}

export function platformLaunchUrl(platform: OnboardingPlatform | null): string | null {
  switch (platform) {
    case 'instagram': return 'https://www.instagram.com/';
    case 'tiktok': return 'https://www.tiktok.com/';
    case 'facebook': return 'https://www.facebook.com/watch/';
    case 'youtube': return 'https://www.youtube.com/shorts/';
    default: return null;
  }
}

export function isSignedInOnboardingV2Continuation(stage: OnboardingV2Stage): boolean {
  return ['account_required', 'auth_success', 'personalized_activation', 'activation_challenge'].includes(stage);
}
