import type { Profile, RadiusUnit } from '@/types';

export type ReminderDisplayMode = 'default' | 'miles' | 'minutes';

function formatUnit(value: number, unit: RadiusUnit): string {
  const noun = unit === 'miles'
    ? value === 1 ? 'mile' : 'miles'
    : value === 1 ? 'minute' : 'minutes';
  return `${value} ${noun}`;
}

export function reminderStatusLabel(args: {
  enabled: boolean;
  mode: ReminderDisplayMode;
  profile: Pick<Profile, 'default_radius_value' | 'default_radius_unit'> | null;
  milesText: string;
  minutesText: string;
}): string {
  if (!args.enabled) return 'Off';
  if (args.mode === 'miles') {
    const value = Number.parseFloat(args.milesText);
    return Number.isFinite(value) && value > 0 ? `On · ${formatUnit(value, 'miles')}` : 'On';
  }
  if (args.mode === 'minutes') {
    const value = Number.parseInt(args.minutesText, 10);
    return Number.isFinite(value) && value > 0 ? `On · ${formatUnit(value, 'minutes')}` : 'On';
  }
  return args.profile
    ? `On · ${formatUnit(args.profile.default_radius_value, args.profile.default_radius_unit)}`
    : 'On';
}
