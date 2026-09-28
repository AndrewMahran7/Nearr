import { areDeveloperToolsVisible } from './appEnvironment';
import { recordBreadcrumb } from './breadcrumbs';
import type { BreadcrumbEvent, BreadcrumbFields } from './breadcrumbsCore';

/** Development-only, bounded route evidence. Never accepts URLs or tokens. */
type OnboardingV2DevelopmentEvent = Extract<
  BreadcrumbEvent,
  | 'route_request'
  | 'auth_route_decision'
  | 'screen_mounted'
  | 'practice_jobs_refreshed'
  | 'practice_share_matched'
  | 'practice_save_reconciled'
>;

export function recordOnboardingV2DevelopmentDiagnostic(
  event: OnboardingV2DevelopmentEvent,
  fields: BreadcrumbFields,
): void {
  if (!areDeveloperToolsVisible()) return;
  recordBreadcrumb(event, fields);
}

export const recordOnboardingV2RouteDiagnostic = recordOnboardingV2DevelopmentDiagnostic;

/** Exact render marker used to prove that durable stage changes do not remount a screen. */
export function recordOnboardingV2RenderDiagnostic(fields: {
  screen: string;
  mount_id: string;
  reason: string;
}): void {
  if (!areDeveloperToolsVisible()) return;
  console.log('[onboarding-render]', fields);
  recordBreadcrumb('screen_mounted', {
    route: fields.screen,
    result: `${fields.mount_id}:${fields.reason}`,
  });
}
