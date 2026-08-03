/**
 * lib/diagnosticContext.ts
 *
 * A tiny synchronous, module-scoped store of the CURRENT app context that the
 * global error boundary includes in its "Copy diagnostic" export. Values are
 * updated from the relevant owners (root layout, map screen, share-job screen)
 * as the app runs, and read synchronously when a crash is caught.
 *
 * All values are safe/low-cardinality (classifications + ids), never tokens or
 * signed URLs. Nothing here throws.
 */

export type InitialUrlClassification =
  | 'none'
  | 'auth_callback'
  | 'share_jobs'
  | 'other';

export type LocationWatcherState = 'idle' | 'watching' | 'stopped';

type DiagnosticContext = {
  route: string | null;
  initialUrlClassification: InitialUrlClassification;
  lastNotificationId: string | null;
  currentShareJobId: string | null;
  appState: string;
  locationWatcherState: LocationWatcherState;
};

const ctx: DiagnosticContext = {
  route: null,
  initialUrlClassification: 'none',
  lastNotificationId: null,
  currentShareJobId: null,
  appState: 'active',
  locationWatcherState: 'idle',
};

export function setDiagnosticRoute(route: string | null): void {
  ctx.route = route ? route.slice(0, 120) : null;
}

export function setInitialUrlClassification(c: InitialUrlClassification): void {
  ctx.initialUrlClassification = c;
}

export function setLastNotificationId(id: string | null): void {
  ctx.lastNotificationId = id ? id.slice(0, 80) : null;
}

export function setCurrentShareJobId(id: string | null): void {
  ctx.currentShareJobId = id ? id.slice(0, 80) : null;
}

export function setDiagnosticAppState(state: string): void {
  ctx.appState = String(state).slice(0, 24);
}

export function setLocationWatcherState(state: LocationWatcherState): void {
  ctx.locationWatcherState = state;
}

/** Classify a deep-link URL for the diagnostic (no query/secret retained). */
export function classifyInitialUrl(url: string | null | undefined): InitialUrlClassification {
  if (!url) return 'none';
  const lower = url.toLowerCase();
  if (lower.includes('auth-callback') || lower.includes('access_token') || lower.includes('code='))
    return 'auth_callback';
  if (lower.includes('share-jobs')) return 'share_jobs';
  return 'other';
}

/** Read a snapshot of the current context (for the error boundary). */
export function getDiagnosticContext(): DiagnosticContext {
  return { ...ctx };
}
