import { createContext, useContext } from 'react';

import type { AuthLinkStatus } from './authDeepLinkCore';

/**
 * Current magic-link handling status, published by the root layout
 * (`app/_layout.tsx`) and consumed by the `auth-callback` screen.
 *
 * The root layout performs the token exchange and sets the status; the
 * auth-callback screen is the single navigation authority and decides where to
 * go from the (sticky, terminal) status plus session presence — see
 * `decideAuthCallbackNavigation`. Using a terminal status instead of a
 * transient boolean means a callback screen that mounts AFTER a fast warm-link
 * failure still reads `failed` and resolves, rather than hanging on the loading
 * view because it missed the boolean's brief `true` window.
 */
export const AuthLinkStatusContext = createContext<AuthLinkStatus>('idle');

export function useAuthLinkStatus(): AuthLinkStatus {
  return useContext(AuthLinkStatusContext);
}
