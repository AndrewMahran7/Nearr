export type OnboardingAuthEntryIntent =
  | 'existing_account_sign_in'
  | 'backup_current_map'
  | 'account_creation';

export function resolveOnboardingAuthEntryIntent(input: {
  routeIntent?: string | string[];
  storedExistingAccountIntent: boolean;
  mapBackupContext: boolean;
}): OnboardingAuthEntryIntent {
  const routeIntent = Array.isArray(input.routeIntent) ? input.routeIntent[0] : input.routeIntent;
  if (routeIntent === 'existing' || input.storedExistingAccountIntent) return 'existing_account_sign_in';
  if (input.mapBackupContext) return 'backup_current_map';
  return 'account_creation';
}

export function requiresAnonymousTransferPreparation(intent: OnboardingAuthEntryIntent): boolean {
  return intent !== 'existing_account_sign_in';
}

export function onboardingAuthCopy(intent: OnboardingAuthEntryIntent): {
  headline: string;
  subtext: string;
} {
  if (intent === 'existing_account_sign_in') {
    return {
      headline: 'Sign in to Nearr',
      subtext: 'Use the sign-in method connected to your existing Nearr account.',
    };
  }
  if (intent === 'backup_current_map') {
    return {
      headline: 'Back up your map',
      subtext: 'Add a sign-in so you can recover your places and use your map on another device.',
    };
  }
  return {
    headline: 'Create your map',
    subtext: 'Sign in or create an account to start saving the places you find online.',
  };
}
