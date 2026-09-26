export type ExistingAccountSignInIntent = { startedAt: string };
export type ExistingAccountEvidence = {
  profileCreatedAt: string | null;
  hasSavedPlace: boolean;
  hasCompletedOnboardingSession: boolean;
};

export function isQualifyingExistingAccount(
  intent: ExistingAccountSignInIntent,
  evidence: ExistingAccountEvidence,
): boolean {
  if (!evidence.profileCreatedAt) return false;
  const profileMs = Date.parse(evidence.profileCreatedAt);
  const attemptMs = Date.parse(intent.startedAt);
  const profilePredatesAttempt = Number.isFinite(profileMs) && Number.isFinite(attemptMs) && profileMs < attemptMs - 5_000;
  return profilePredatesAttempt || evidence.hasSavedPlace || evidence.hasCompletedOnboardingSession;
}
