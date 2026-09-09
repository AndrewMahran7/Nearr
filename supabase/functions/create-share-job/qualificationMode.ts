export const DEV_QUALIFICATION_PROJECT_REF = 'qnfxnmvxpjzfydgudtvs';
export const FRESH_QUALIFICATION_MODE = 'fresh_media';
export const FRESH_RECOGNITION_RUN_MODE = 'qualification_fresh';

export type QualificationAuthorization =
  | { ok: true; requested: false }
  | { ok: true; requested: true }
  | { ok: false; status: 400 | 403; error: 'invalid_qualification_mode' | 'qualification_mode_forbidden' };

export function authorizeQualificationMode(args: {
  requestedMode: unknown;
  projectRef: string | null;
  appMetadata: unknown;
}): QualificationAuthorization {
  if (args.requestedMode == null) return { ok: true, requested: false };
  if (args.requestedMode !== FRESH_QUALIFICATION_MODE) {
    return { ok: false, status: 400, error: 'invalid_qualification_mode' };
  }
  const metadata = args.appMetadata && typeof args.appMetadata === 'object'
    ? args.appMetadata as Record<string, unknown>
    : {};
  const authorized =
    args.projectRef === DEV_QUALIFICATION_PROJECT_REF &&
    metadata.account_class === 'dedicated_dev_test' &&
    metadata.purpose === 'onb2_tutorial_qualification';
  return authorized
    ? { ok: true, requested: true }
    : { ok: false, status: 403, error: 'qualification_mode_forbidden' };
}
