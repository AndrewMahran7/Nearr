export function isOnboardingTransferNetworkError(error: unknown): boolean {
  const value = error as { message?: unknown; name?: unknown; code?: unknown } | null;
  const text = [value?.name, value?.code, value?.message, error]
    .filter((part) => part != null)
    .join(' ')
    .toLowerCase();
  return /network request failed|failed to fetch|networkerror|econn(reset|refused)|enotfound|timed?\s*out|offline/.test(text);
}

export function onboardingTransferErrorCopy(
  error: unknown,
  context: 'backup' | 'account_creation',
): string {
  if (isOnboardingTransferNetworkError(error)) {
    return context === 'backup'
      ? 'Nearr could not reach the backup service. Check your connection and try again.'
      : 'Nearr could not reach the account service. Check your connection and try again.';
  }
  return context === 'backup'
    ? 'Nearr could not prepare this backup. Your places are still safe. Try again, or contact support if it continues.'
    : 'Nearr could not prepare your saved places for sign-in. They are still safe; please try again.';
}
