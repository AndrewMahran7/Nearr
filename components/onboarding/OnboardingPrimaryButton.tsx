import type { ComponentProps } from 'react';
import { Button } from '@/components/Button';

/** Fieldnotes utility action shared with the rest of the app. */
export function OnboardingPrimaryButton(props: ComponentProps<typeof Button>) {
  return <Button {...props} />;
}
