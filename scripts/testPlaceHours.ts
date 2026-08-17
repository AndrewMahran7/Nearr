/**
 * scripts/testPlaceHours.ts
 *
 * Current-day opening hours must be TRUE or absent — never a confident guess.
 *
 * The load-bearing case: a user in California looking at a saved place in
 * Tokyo. Judging Tokyo against the phone's clock is the exact bug this module
 * exists to prevent, so the same instant is asserted against both venues and
 * must produce different answers.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlaceHours.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  describeTodayHours,
  describeTodaySchedule,
  formatClockTime,
  type PlaceOpeningHours,
} from '../lib/placeHours';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Build hours from a compact {day: [[open, close], ...]} description. */
function hours(spec: Record<number, [string, string][]>): PlaceOpeningHours {
  const periods = [];
  for (const [day, ranges] of Object.entries(spec)) {
    for (const [open, close] of ranges) {
      periods.push({
        open: { day: Number(day), time: open },
        close: { day: closeDay(Number(day), open, close), time: close },
      });
    }
  }
  return { periods, weekdayDescriptions: [] };
}

/** An interval whose close is <= its open rolls onto the next day. */
function closeDay(day: number, open: string, close: string): number {
  return close <= open ? (day + 1) % 7 : day;
}

/** A UTC instant, so every assertion below is anchored to a real timeline. */
const utc = (iso: string) => Date.parse(iso);

const PT = -7 * 60; // America/Los_Angeles in August (PDT)
const JST = 9 * 60; // Asia/Tokyo, no DST

// ---------------------------------------------------------------------------
// 1. Open, with a single interval
// ---------------------------------------------------------------------------
{
  // Sat 2026-08-15, 11 AM–9 PM. 19:00 UTC == 12:00 PDT → open.
  const h = hours({ 6: [['1100', '2100']] });
  const result = describeTodayHours({
    hours: h,
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T19:00:00Z'),
  });
  assert.ok(result);
  assert.equal(result!.kind, 'open');
  assert.equal(result!.label, 'Open');
  assert.equal(result!.detail, 'Closes 9 PM');
  assert.equal(result!.text, 'Open · Closes 9 PM');
  assert.equal(result!.todayText, '11 AM–9 PM');
}

// ---------------------------------------------------------------------------
// 2. Timezone correctness — the whole point
// ---------------------------------------------------------------------------
{
  // One instant: 2026-08-15T19:00Z.
  //   Los Angeles → Sat 12:00  (open, 11–21)
  //   Tokyo       → Sun 04:00  (closed; Tokyo's Sunday hours are 11–21)
  const instant = utc('2026-08-15T19:00:00Z');
  const weekly = hours({ 0: [['1100', '2100']], 6: [['1100', '2100']] });

  const california = describeTodayHours({ hours: weekly, utcOffsetMinutes: PT, now: instant });
  const tokyo = describeTodayHours({ hours: weekly, utcOffsetMinutes: JST, now: instant });

  assert.equal(california!.kind, 'open', 'the California venue really is open');
  assert.equal(
    tokyo!.kind,
    'closed',
    'the SAME instant must not report a Tokyo venue open on California time',
  );
  assert.equal(tokyo!.detail, 'Opens 11 AM', 'and it says when Tokyo actually opens');
  assert.notEqual(california!.text, tokyo!.text, 'two timezones, two truthful answers');
}

// A venue whose local day has already rolled over reports the NEXT local day.
{
  // 2026-08-15T16:00Z → Tokyo Sun 01:00. Sunday closed, Monday opens 9 AM.
  const result = describeTodayHours({
    hours: hours({ 1: [['0900', '1700']] }),
    utcOffsetMinutes: JST,
    now: utc('2026-08-15T16:00:00Z'),
  });
  assert.equal(result!.label, 'Closed today', 'Sunday has no interval at all in Tokyo');
  assert.equal(result!.detail, 'Opens tomorrow 9 AM', 'tomorrow is the VENUE’s tomorrow');
  assert.equal(result!.todayText, null);
}

// ---------------------------------------------------------------------------
// 3. Closed, with the next opening named by distance
// ---------------------------------------------------------------------------
{
  // Sat 2026-08-15 07:00 PDT (14:00Z), opens at 11.
  const result = describeTodayHours({
    hours: hours({ 6: [['1100', '2100']] }),
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T14:00:00Z'),
  });
  assert.equal(result!.kind, 'closed');
  assert.equal(result!.label, 'Closed', 'today does have hours, they just have not started');
  assert.equal(result!.text, 'Closed · Opens 11 AM');
  assert.equal(result!.todayText, '11 AM–9 PM');
}

{
  // Sat 22:00 PDT, next opening is Monday 8 AM → named by weekday, not "tomorrow".
  const result = describeTodayHours({
    hours: hours({ 1: [['0800', '1700']] }),
    utcOffsetMinutes: PT,
    now: utc('2026-08-16T05:00:00Z'),
  });
  assert.equal(result!.label, 'Closed today');
  assert.equal(result!.detail, 'Opens Mon 8 AM');
}

// ---------------------------------------------------------------------------
// 4. Multiple intervals in one day (lunch → dinner)
// ---------------------------------------------------------------------------
{
  const split = hours({ 6: [['1100', '1400'], ['1700', '2200']] });

  // 12:00 PDT → inside lunch, and the reopen is the useful next fact.
  const duringLunch = describeTodayHours({
    hours: split,
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T19:00:00Z'),
  });
  assert.equal(duringLunch!.kind, 'open');
  assert.equal(duringLunch!.detail, 'Closes 2 PM, reopens 5 PM');
  assert.equal(duringLunch!.todayText, '11 AM–2 PM, 5–10 PM', 'both intervals, cleanly');

  // 15:30 PDT → in the gap: closed, opening again at 5.
  const inTheGap = describeTodayHours({
    hours: split,
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T22:30:00Z'),
  });
  assert.equal(inTheGap!.kind, 'closed');
  assert.equal(inTheGap!.text, 'Closed · Opens 5 PM');
}

// ---------------------------------------------------------------------------
// 5. Overnight intervals
// ---------------------------------------------------------------------------
{
  // Fri 20:00 → Sat 02:00. At Sat 00:30 local the bar is still open.
  const overnight = hours({ 5: [['2000', '0200']] });
  const afterMidnight = describeTodayHours({
    hours: overnight,
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T07:30:00Z'), // Fri 2026-08-14 24:30 → Sat 00:30 PDT
  });
  assert.equal(afterMidnight!.kind, 'open', 'an interval past midnight is one interval');
  assert.equal(afterMidnight!.detail, 'Closes 2 AM');

  // And it belongs to FRIDAY, so Saturday shows no interval of its own.
  assert.equal(afterMidnight!.todayText, null, 'Saturday itself has no opening period');
}

{
  // Saturday 22:00 → Sunday 03:00 wraps the end of the week array.
  const wrapsTheWeek = hours({ 6: [['2200', '0300']] });
  const result = describeTodayHours({
    hours: wrapsTheWeek,
    utcOffsetMinutes: PT,
    now: utc('2026-08-16T08:00:00Z'), // Sun 01:00 PDT
  });
  assert.equal(result!.kind, 'open', 'Saturday night spilling into Sunday still counts');
  assert.equal(result!.detail, 'Closes 3 AM');
}

// ---------------------------------------------------------------------------
// 6. Open 24 hours
// ---------------------------------------------------------------------------
{
  const alwaysOpen: PlaceOpeningHours = {
    periods: [{ open: { day: 0, time: '0000' }, close: null }],
    weekdayDescriptions: ['Open 24 hours'],
  };
  const result = describeTodayHours({
    hours: alwaysOpen,
    utcOffsetMinutes: PT,
    now: utc('2026-08-15T10:00:00Z'),
  });
  assert.equal(result!.kind, 'open_24h');
  assert.equal(result!.text, 'Open 24 hours');
  assert.equal(result!.detail, null, 'no "closes at" for a place that never closes');
}

// ---------------------------------------------------------------------------
// 7. Missing / unusable data — omit, never invent
// ---------------------------------------------------------------------------
{
  const now = utc('2026-08-15T19:00:00Z');
  const some = hours({ 6: [['1100', '2100']] });

  assert.equal(describeTodayHours({ hours: null, utcOffsetMinutes: PT, now }), null);
  assert.equal(describeTodayHours({ hours: undefined, utcOffsetMinutes: PT, now }), null);
  assert.equal(
    describeTodayHours({ hours: { periods: [], weekdayDescriptions: [] }, utcOffsetMinutes: PT, now }),
    null,
    'a city / beach / island simply has no periods',
  );

  // No venue offset → we cannot know the venue's clock OR its weekday.
  assert.equal(
    describeTodayHours({ hours: some, utcOffsetMinutes: null, now }),
    null,
    'without utc_offset there is no truthful open/closed claim to make',
  );
  assert.equal(describeTodayHours({ hours: some, utcOffsetMinutes: undefined, now }), null);
  assert.equal(describeTodayHours({ hours: some, utcOffsetMinutes: Number.NaN, now }), null);

  // Malformed periods are dropped, not guessed at.
  const malformed: PlaceOpeningHours = {
    periods: [
      { open: { day: 9, time: '1100' }, close: { day: 9, time: '2100' } },
      { open: { day: 6, time: 'lunchtime' }, close: { day: 6, time: '2100' } },
    ],
    weekdayDescriptions: [],
  };
  assert.equal(describeTodayHours({ hours: malformed, utcOffsetMinutes: PT, now }), null);

  // One malformed period must not erase its valid siblings.
  const mixed: PlaceOpeningHours = {
    periods: [
      { open: { day: 6, time: '1100' }, close: { day: 6, time: '2100' } },
      { open: { day: 99, time: '9999' }, close: null },
    ],
    weekdayDescriptions: [],
  };
  assert.equal(describeTodayHours({ hours: mixed, utcOffsetMinutes: PT, now })!.kind, 'open');
}

// UTC itself is a valid offset (offset 0 is not "missing").
{
  const result = describeTodayHours({
    hours: hours({ 6: [['1100', '2100']] }),
    utcOffsetMinutes: 0,
    now: utc('2026-08-15T12:00:00Z'),
  });
  assert.equal(result!.kind, 'open', 'offset 0 is a real offset, not an absent one');
}

// ---------------------------------------------------------------------------
// 8. 12-hour formatting
// ---------------------------------------------------------------------------
{
  assert.equal(formatClockTime(0), '12 AM');
  assert.equal(formatClockTime(1), '12:01 AM');
  assert.equal(formatClockTime(9 * 60), '9 AM');
  assert.equal(formatClockTime(11 * 60 + 30), '11:30 AM');
  assert.equal(formatClockTime(12 * 60), '12 PM');
  assert.equal(formatClockTime(13 * 60), '1 PM');
  assert.equal(formatClockTime(21 * 60), '9 PM');
  assert.equal(formatClockTime(23 * 60 + 45), '11:45 PM');
  assert.equal(formatClockTime(24 * 60), '12 AM', 'midnight wraps rather than reading "24"');
}

// ---------------------------------------------------------------------------
// 9. The deliberate no-real-time-claim fallback
// ---------------------------------------------------------------------------
{
  const schedule = describeTodaySchedule('8 AM–9 PM');
  assert.equal(schedule!.kind, 'schedule');
  assert.equal(schedule!.text, 'Today · 8 AM–9 PM', 'shows the day without claiming a state');
  assert.ok(!/open now/i.test(schedule!.text), 'never says "Open now"');
  assert.equal(describeTodaySchedule(null), null);
}

// ---------------------------------------------------------------------------
// 10. Wiring: no "Open now", no phone clock, no extra provider request
// ---------------------------------------------------------------------------
{
  const module = read('lib/placeHours.ts');
  assert.ok(!/Open now/i.test(module), 'the phrase this module exists to avoid never appears');
  assert.ok(
    !/getTimezoneOffset|toLocaleTimeString|toLocaleDateString/.test(module),
    'no device-locale clock leaks into a venue-local calculation',
  );

  const service = read('services/placesService.ts');
  assert.ok(service.includes("'opening_hours',"), 'hours ride along on the rich-details fields');
  assert.ok(service.includes("'utc_offset',"), 'and so does the venue offset');
  assert.ok(
    !/\.open_now|openNow/.test(service),
    'the deprecated request-time snapshot is never read or surfaced through the cache',
  );
  // Exactly ONE rich-details request still exists — hours added no round trip.
  assert.equal(
    service.split('RICH_DETAILS_FIELDS').length - 1,
    2,
    'the fields list is declared once and used by one request',
  );

  const detail = read('components/map/SelectedPlaceDetails.tsx');
  assert.ok(detail.includes('describeTodayHours'), 'the sheet uses the tested helper');
  assert.ok(
    detail.includes('richDetails?.utcOffsetMinutes'),
    'and feeds it the VENUE offset, not the device timezone',
  );
  assert.ok(!/Open now/i.test(detail), 'the sheet never claims "Open now"');
  // The hours row renders ONLY from the helper's own result, so there is no
  // branch that can print "Unknown hours" or an invented schedule.
  const hoursStart = detail.indexOf('{todayHours ? (');
  const hoursEnd = detail.indexOf('{photoUrls.length > 0 ? (', hoursStart);
  assert.ok(hoursStart > -1 && hoursEnd > hoursStart, 'the hours row exists');
  assert.ok(
    hoursStart < detail.indexOf('Why this place is on'),
    'and sits above Saved because, as the reference lays it out',
  );
  const hoursBlock = detail.slice(hoursStart, hoursEnd);
  assert.ok(!/Unknown|unavailable/i.test(hoursBlock), 'no placeholder copy for absent hours');
  assert.ok(hoursBlock.includes('todayHours.label'), 'it prints the tested label');
  assert.ok(hoursBlock.includes('todayHours.detail'), 'and the tested detail');
}

console.log('PASS place hours: venue-local today, multiple/overnight intervals, honest omissions');
