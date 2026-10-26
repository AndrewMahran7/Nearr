import type { AgeBand, EligibilityDeclaration } from './globalEligibility';

/** Calendar components, never a UTC timestamp. Keep this value in screen memory only. */
export type Birthday = { year: number; month: number; day: number };
export function localCalendarDate(date: Date): Birthday {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}
export function birthdayAge(birthday: Birthday | null, today = localCalendarDate(new Date())): number | null {
  if (!birthday) return null;
  const { year, month, day } = birthday;
  if (![year, month, day].every(Number.isInteger) || year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
  // A Feb 29 birthday reaches its next age on March 1 in non-leap years.
  // Conservative at the boundary; the server still decides eligibility from the band.
  const age = today.year - year - (today.month < month || (today.month === month && today.day < day) ? 1 : 0);
  return age < 0 ? null : age;
}
export function ageBandForAge(age: number): AgeBand {
  return age < 13 ? 'under_13' : age < 16 ? String(age) as AgeBand : age < 18 ? '16_17' : '18_plus';
}
export function birthdayDeclaration(birthday: Birthday | null, countryCode: string | null, today?: Birthday): EligibilityDeclaration | null {
  const age = birthdayAge(birthday, today);
  return age === null || !countryCode || !/^[A-Z]{2}$/.test(countryCode) ? null : { ageBand: ageBandForAge(age), countryCode };
}
