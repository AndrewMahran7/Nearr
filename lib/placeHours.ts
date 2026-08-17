/**
 * lib/placeHours.ts
 *
 * "Is it open right now, and when does that change?" — answered for ONE day,
 * in the VENUE's local time, or not answered at all.
 *
 * Why the timezone rule is load-bearing: a saved place in Tokyo viewed from
 * California must never be judged against California's clock. Google's Place
 * Details response carries `utc_offset` (minutes east of UTC, evaluated for the
 * place at request time, so DST is already folded in) alongside `opening_hours`.
 * Every calculation here runs in that offset. When the offset is missing we
 * cannot even name the venue's current weekday, so the caller gets `null` and
 * omits the hours line entirely — an omission is honest, a fabricated
 * open-right-now claim is not.
 *
 * Google models the week as periods keyed by the day the interval OPENS, with
 * overnight intervals closing on the following day. That is reproduced exactly:
 * everything is projected into "minutes since Sunday 00:00" so an interval that
 * runs past midnight (or past Saturday into Sunday) is a single continuous
 * range rather than two half-answers.
 *
 * PURE — no React Native, no I/O, no Date-locale dependence. Unit-tested from
 * ts-node (scripts/testPlaceHours.ts).
 */

/** One edge of an opening period. `time` is "HHMM" in the venue's local time. */
export type OpeningHoursPoint = { day: number; time: string };

export type OpeningHoursPeriod = {
  open: OpeningHoursPoint;
  /** Absent only for the always-open sentinel Google returns for 24/7 places. */
  close?: OpeningHoursPoint | null;
};

export type PlaceOpeningHours = {
  periods: OpeningHoursPeriod[];
  /** Google's `weekday_text`. Kept for provenance; not used for the status. */
  weekdayDescriptions: string[];
};

export type TodayHoursKind = 'open' | 'closed' | 'open_24h' | 'schedule';

export type TodayHours = {
  kind: TodayHoursKind;
  /** Leading status word: "Open", "Closed", "Closed today", "Today". */
  label: string;
  /** Trailing detail: "Closes 9 PM", "Opens 8 AM", "8 AM–9 PM". */
  detail: string | null;
  /** Ready to render: "Open · Closes 9 PM". */
  text: string;
  /** Today's own intervals, e.g. "11 AM–2 PM, 5–10 PM". Null when closed today. */
  todayText: string | null;
};

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** An opening interval flattened into minutes-since-Sunday-00:00. */
type Interval = {
  /** Weekday the interval opens on (0 = Sunday), i.e. the day it "belongs" to. */
  day: number;
  start: number;
  /** Always > start. May exceed MINUTES_PER_WEEK for intervals that wrap. */
  end: number;
};

function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const hours = Number(trimmed.slice(0, 2));
  const minutes = Number(trimmed.slice(2, 4));
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDay(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 6) return null;
  return value;
}

function minuteOfWeek(day: number, minuteOfDay: number): number {
  return (day * MINUTES_PER_DAY + minuteOfDay) % MINUTES_PER_WEEK;
}

/**
 * True when the periods are Google's "open 24/7" sentinel: a single period
 * opening Sunday at 0000 with no close at all.
 */
function isAlwaysOpen(periods: readonly OpeningHoursPeriod[]): boolean {
  if (periods.length !== 1) return false;
  const only = periods[0];
  if (only?.close) return false;
  return parseDay(only?.open?.day) === 0 && parseHHMM(only?.open?.time) === 0;
}

/** Flatten the provider periods into continuous, sorted week intervals. */
function toIntervals(periods: readonly OpeningHoursPeriod[]): Interval[] {
  const intervals: Interval[] = [];
  for (const period of periods) {
    const openDay = parseDay(period?.open?.day);
    const openMinute = parseHHMM(period?.open?.time);
    if (openDay === null || openMinute === null) continue; // malformed → skipped
    const start = minuteOfWeek(openDay, openMinute);

    const closeDay = parseDay(period?.close?.day);
    const closeMinute = parseHHMM(period?.close?.time);
    if (closeDay === null || closeMinute === null) {
      // No usable close: treat as a full day open from `start` rather than
      // inventing a closing time we were never told.
      intervals.push({ day: openDay, start, end: start + MINUTES_PER_DAY });
      continue;
    }
    let end = minuteOfWeek(closeDay, closeMinute);
    if (end <= start) end += MINUTES_PER_WEEK; // overnight / wraps the week
    intervals.push({ day: openDay, start, end });
  }
  intervals.sort((a, b) => a.start - b.start);
  return intervals;
}

/** 12-hour clock, minutes dropped when zero: "9 PM", "8:30 AM", "12 AM". */
export function formatClockTime(minuteOfDay: number): string {
  const normalized = ((Math.round(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** True when a minute-of-day falls in the afternoon half of the clock. */
function isPm(minuteOfDay: number): boolean {
  return Math.floor((((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60) >= 12;
}

/**
 * "11 AM–2 PM" for one interval, using an en dash. When both ends share a
 * meridiem the leading one is dropped ("5–10 PM") — the same convention menus
 * and opening-hours signs use, and it keeps a two-interval day on one line.
 */
function formatInterval(interval: Interval): string {
  const spansFullDay = interval.end - interval.start >= MINUTES_PER_DAY;
  if (spansFullDay) return 'Open 24 hours';
  const startMinute = interval.start % MINUTES_PER_DAY;
  const endMinute = interval.end % MINUTES_PER_DAY;
  const start = formatClockTime(startMinute);
  const end = formatClockTime(endMinute);
  const sharedMeridiem = isPm(startMinute) === isPm(endMinute);
  return `${sharedMeridiem ? start.replace(/ (AM|PM)$/, '') : start}–${end}`;
}

/**
 * The venue's local wall clock, as {day, minuteOfDay, minuteOfWeek}.
 * `utcOffsetMinutes` is minutes east of UTC for the PLACE, not the device.
 */
function venueLocalNow(nowMs: number, utcOffsetMinutes: number) {
  const shifted = new Date(nowMs + utcOffsetMinutes * 60_000);
  const day = shifted.getUTCDay();
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { day, minuteOfDay, mow: minuteOfWeek(day, minuteOfDay) };
}

/** Distance forward (in minutes) from `from` to `to` around the week. */
function forwardDistance(from: number, to: number): number {
  return ((to - from) % MINUTES_PER_WEEK + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
}

function normalizePeriods(hours: PlaceOpeningHours | null | undefined): OpeningHoursPeriod[] {
  if (!hours || !Array.isArray(hours.periods)) return [];
  return hours.periods.filter((period): period is OpeningHoursPeriod => !!period?.open);
}

/**
 * Describe today for this place, or return null when there is nothing truthful
 * to say. Null means "omit the hours treatment entirely" — never render
 * "Unknown", never render a guess.
 *
 * Returns null when:
 *   - no opening-hours payload / no usable periods (a city, a beach, an island
 *     and plenty of real businesses simply have none), or
 *   - `utcOffsetMinutes` is missing, because without it the venue's own
 *     weekday and clock are both unknowable.
 */
export function describeTodayHours(args: {
  hours: PlaceOpeningHours | null | undefined;
  utcOffsetMinutes: number | null | undefined;
  /** Defaults to Date.now(). Injected by the tests. */
  now?: number;
}): TodayHours | null {
  const periods = normalizePeriods(args.hours);
  if (periods.length === 0) return null;

  const offset = args.utcOffsetMinutes;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;

  if (isAlwaysOpen(periods)) {
    return {
      kind: 'open_24h',
      label: 'Open 24 hours',
      detail: null,
      text: 'Open 24 hours',
      todayText: 'Open 24 hours',
    };
  }

  const intervals = toIntervals(periods);
  if (intervals.length === 0) return null;

  const nowMs = typeof args.now === 'number' && Number.isFinite(args.now) ? args.now : Date.now();
  const local = venueLocalNow(nowMs, offset);

  const todayIntervals = intervals.filter((interval) => interval.day === local.day);
  const todayText =
    todayIntervals.length > 0 ? todayIntervals.map(formatInterval).join(', ') : null;

  // Currently open? An interval covers `now` if now — or now one week later,
  // for ranges that spill past Saturday — falls inside it.
  const current = intervals.find(
    (interval) =>
      (local.mow >= interval.start && local.mow < interval.end) ||
      (local.mow + MINUTES_PER_WEEK >= interval.start && local.mow + MINUTES_PER_WEEK < interval.end),
  );

  if (current) {
    const closesAt = current.end % MINUTES_PER_WEEK;
    // A second interval later today (lunch → dinner) is the useful next fact.
    const reopens = intervals.find(
      (interval) => interval.day === local.day && interval.start > current.start,
    );
    const closesText = `Closes ${formatClockTime(closesAt % MINUTES_PER_DAY)}`;
    const detail = reopens
      ? `${closesText}, reopens ${formatClockTime(reopens.start % MINUTES_PER_DAY)}`
      : closesText;
    return {
      kind: 'open',
      label: 'Open',
      detail,
      text: `Open · ${detail}`,
      todayText,
    };
  }

  // Closed. The next opening is the soonest interval start ahead of now.
  let nextOpen: Interval | null = null;
  let nextDistance = Number.POSITIVE_INFINITY;
  for (const interval of intervals) {
    const distance = forwardDistance(local.mow, interval.start % MINUTES_PER_WEEK);
    if (distance < nextDistance) {
      nextDistance = distance;
      nextOpen = interval;
    }
  }

  const label = todayIntervals.length > 0 ? 'Closed' : 'Closed today';
  if (!nextOpen) {
    return { kind: 'closed', label, detail: null, text: label, todayText };
  }

  const nextTime = formatClockTime(nextOpen.start % MINUTES_PER_DAY);
  // Day distance in the venue's own calendar, so "tomorrow" is the venue's
  // tomorrow rather than the phone's.
  const daysAhead = Math.floor((local.minuteOfDay + nextDistance) / MINUTES_PER_DAY);
  const detail =
    daysAhead === 0
      ? `Opens ${nextTime}`
      : daysAhead === 1
        ? `Opens tomorrow ${nextTime}`
        : `Opens ${SHORT_DAY_NAMES[nextOpen.day]} ${nextTime}`;

  return { kind: 'closed', label, detail, text: `${label} · ${detail}`, todayText };
}

/**
 * The fallback shape for callers that know today's schedule but deliberately
 * refuse to claim a real-time state: "Today · 11 AM–2 PM, 5–10 PM".
 * Exported so the decision stays testable rather than inlined in a component.
 */
export function describeTodaySchedule(today: string | null): TodayHours | null {
  if (!today) return null;
  return {
    kind: 'schedule',
    label: 'Today',
    detail: today,
    text: `Today · ${today}`,
    todayText: today,
  };
}
