/**
 * This worktree is the non-monetized onboarding QA product surface.
 * Environment flags cannot turn Premium UI or initiation back on here; the
 * monetization worktree owns that experiment independently.
 */
export function premiumRequestsEnabled(): boolean {
  return false;
}
