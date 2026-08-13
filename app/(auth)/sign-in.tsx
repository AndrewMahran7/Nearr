import { Redirect } from 'expo-router';

/**
 * Legacy sign-in route, now only a redirect.
 *
 * The unified gateway is `/(onboarding)/account` (Apple / Google / magic link
 * / password). This stub stays so any stale back-stack entry or older route
 * string still lands there instead of on the removed screen, which exposed a
 * hardcoded test-account password path in production builds.
 */
export default function SignInRedirect() {
  return <Redirect href="/(onboarding)/account" />;
}
