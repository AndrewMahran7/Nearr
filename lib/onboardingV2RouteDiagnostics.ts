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
