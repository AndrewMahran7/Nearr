type ForegroundNotificationInput = {
  appState: string | null | undefined;
  pathname: string | null | undefined;
  data: Record<string, unknown> | null | undefined;
};

let activePathname: string | null = null;

export function setNotificationForegroundPathname(pathname: string | null): void {
  activePathname = pathname;
}

function notificationJobId(data: Record<string, unknown> | null | undefined): string | null {
  const value = data?.jobId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isViewingNotificationJob(
  pathname: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  const jobId = notificationJobId(data);
  if (!jobId || !pathname) return false;
  const normalizedPath = pathname.replace(/\/+$/, '');
  return normalizedPath === `/share-jobs/${encodeURIComponent(jobId)}` ||
    normalizedPath === `/share-jobs/${jobId}`;
}

/**
 * Foreground pushes stay visible unless the user is already looking at the
 * exact share-job result represented by that push. Nearby reminders and a
 * result for any other job remain visible.
 */
export function shouldPresentNotificationInForeground(
  input: ForegroundNotificationInput,
): boolean {
  if (input.appState !== 'active') return true;
  return !isViewingNotificationJob(input.pathname, input.data);
}

export function shouldPresentCurrentForegroundNotification(
  appState: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  return shouldPresentNotificationInForeground({
    appState,
    pathname: activePathname,
    data,
  });
}
