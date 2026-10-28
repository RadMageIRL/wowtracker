// Engine tests: the schedule math in js/schedule.js against instants worked out by hand from the
// published daylight-saving dates (US: 2026-03-08 and 2026-11-01; EU: 2026-03-29 and 2026-10-25),
// never against the engine's own output. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const S = createRequire(import.meta.url)('../js/schedule.js');
const utc = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

export function engineTests(test) {
  // ---- Zones ----

  test('wall times in Los Angeles map to UTC on both sides of the 2026 US changes', () => {
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 3, 7, 8, 0)), '2026-03-07T16:00:00Z'); // PST, UTC-8
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 3, 9, 8, 0)), '2026-03-09T15:00:00Z'); // PDT, UTC-7
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 10, 31, 8, 0)), '2026-10-31T15:00:00Z');
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 11, 2, 8, 0)), '2026-11-02T16:00:00Z');
  });

  test('a skipped wall time (02:30 on 2026-03-08 in Los Angeles) lands after the jump, at 03:30 PDT', () => {
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 3, 8, 2, 30)), '2026-03-08T10:30:00Z');
  });

  test('a repeated wall time (01:30 on 2026-11-01 in Los Angeles) is the first one, 01:30 PDT', () => {
    assert.equal(iso(S.wallToUtc('America/Los_Angeles', 2026, 11, 1, 1, 30)), '2026-11-01T08:30:00Z');
  });

  test('Paris wall times follow CET and CEST, including the repeated 02:30 on 2026-10-25', () => {
    assert.equal(iso(S.wallToUtc('Europe/Paris', 2026, 3, 28, 5, 0)), '2026-03-28T04:00:00Z');
    assert.equal(iso(S.wallToUtc('Europe/Paris', 2026, 3, 30, 5, 0)), '2026-03-30T03:00:00Z');
    assert.equal(iso(S.wallToUtc('Europe/Paris', 2026, 10, 25, 2, 30)), '2026-10-25T00:30:00Z');
  });

  test('offsets read from the zone database: -420/-480 in Los Angeles, +330 in Kolkata, +630/+660 at Lord Howe', () => {
    assert.equal(S.offsetMin('America/Los_Angeles', utc('2026-07-01T00:00:00Z')), -420);
    assert.equal(S.offsetMin('America/Los_Angeles', utc('2026-12-01T00:00:00Z')), -480);
    assert.equal(S.offsetMin('Asia/Kolkata', utc('2026-12-01T00:00:00Z')), 330);
    assert.equal(S.offsetMin('Australia/Lord_Howe', utc('2026-07-01T00:00:00Z')), 630);
    assert.equal(S.offsetMin('Australia/Lord_Howe', utc('2026-12-01T00:00:00Z')), 660);
    assert.equal(S.offsetMin('UTC', utc('2026-12-01T00:00:00Z')), 0);
  });

  // ---- Resets ----

  const weeklyUtc = { type: 'weekly', weekday: 2, time: '15:00', zone: 'UTC' };
  const dailyUtc = { type: 'daily', time: '15:00', zone: 'UTC' };
  const weeklyLa = { type: 'weekly', weekday: 2, time: '08:00', zone: 'America/Los_Angeles' };

  test('a weekly reset fixed in UTC stays at 15:00 UTC across the US change', () => {
    assert.equal(iso(S.nextReset(weeklyUtc, utc('2026-10-28T01:00:00Z'))), '2026-11-03T15:00:00Z');
    assert.equal(iso(S.nextReset(weeklyUtc, utc('2026-11-03T15:00:00Z'))), '2026-11-10T15:00:00Z');
    assert.equal(iso(S.previousReset(weeklyUtc, utc('2026-10-28T01:00:00Z'))), '2026-10-27T15:00:00Z');
  });

  test('a weekly reset fixed in Los Angeles time moves from 15:00 to 16:00 UTC when PDT ends', () => {
    assert.equal(iso(S.nextReset(weeklyLa, utc('2026-10-28T00:00:00Z'))), '2026-11-03T16:00:00Z');
    assert.equal(iso(S.previousReset(weeklyLa, utc('2026-10-28T00:00:00Z'))), '2026-10-27T15:00:00Z');
  });

  test('reset boundaries: one millisecond before is still "next", the instant itself is "previous"', () => {
    const t = utc('2026-10-27T15:00:00Z');
    assert.equal(iso(S.nextReset(weeklyUtc, t - 1)), '2026-10-27T15:00:00Z');
    assert.equal(iso(S.nextReset(weeklyUtc, t)), '2026-11-03T15:00:00Z');
    assert.equal(iso(S.previousReset(weeklyUtc, t)), '2026-10-27T15:00:00Z');
    assert.equal(iso(S.previousReset(weeklyUtc, t - 1)), '2026-10-20T15:00:00Z');
    assert.equal(iso(S.nextReset(dailyUtc, t)), '2026-10-28T15:00:00Z');
    assert.equal(iso(S.nextReset(dailyUtc, t - 1)), '2026-10-27T15:00:00Z');
  });

  test('every daily reset in a 400-day sweep is exactly one day after the last (UTC rule)', () => {
    let t = utc('2026-01-01T00:00:00Z');
    let prev = S.nextReset(dailyUtc, t);
    for (let i = 0; i < 400; i++) {
      const next = S.nextReset(dailyUtc, prev);
      assert.equal(next - prev, DAY, iso(prev));
      prev = next;
    }
  });

  test('a monthly reset on day 1 lands on the first of each month, including after a 31-day month', () => {
    const m = { type: 'monthly', day: 1, time: '15:00', zone: 'UTC' };
    assert.equal(iso(S.nextReset(m, utc('2026-10-28T00:00:00Z'))), '2026-11-01T15:00:00Z');
    assert.equal(iso(S.nextReset(m, utc('2026-12-01T15:00:00Z'))), '2027-01-01T15:00:00Z');
    assert.equal(iso(S.nextReset(m, utc('2027-01-31T23:00:00Z'))), '2027-02-01T15:00:00Z');
    assert.equal(iso(S.previousReset(m, utc('2026-10-28T00:00:00Z'))), '2026-10-01T15:00:00Z');
  });

  // ---- Windows ----

  const dates = { type: 'dates', windows: [
    { start: '2026-10-18T17:00:00Z', end: '2026-11-01T17:00:00Z' },
    { start: '2026-12-16T18:00:00Z', end: '2027-01-02T18:00:00Z' },
  ] };

  test('dated windows are half-open: on at the start instant, off at the end instant', () => {
    assert.equal(S.currentWindow(dates, utc('2026-10-18T17:00:00Z') - 1), null);
    assert.equal(iso(S.currentWindow(dates, utc('2026-10-18T17:00:00Z')).start), '2026-10-18T17:00:00Z');
    assert.ok(S.currentWindow(dates, utc('2026-11-01T17:00:00Z') - 1));
    assert.equal(S.currentWindow(dates, utc('2026-11-01T17:00:00Z')), null);
  });

  test('a window that ends exactly when a range starts is not in that range (a reset week does not list last week)', () => {
    assert.deepEqual(S.windows(dates, utc('2026-11-01T17:00:00Z'), utc('2026-11-08T17:00:00Z')), []);
    assert.equal(S.windows(dates, utc('2026-11-01T17:00:00Z') - 1, utc('2026-11-08T17:00:00Z')).length, 1);
  });

  test('dated windows overlapping a range are all returned in order, and none outside it', () => {
    assert.deepEqual(S.windows(dates, utc('2026-10-01T00:00:00Z'), utc('2027-02-01T00:00:00Z')).map((w) => iso(w.start)), ['2026-10-18T17:00:00Z', '2026-12-16T18:00:00Z']);
    assert.deepEqual(S.windows(dates, utc('2026-11-02T00:00:00Z'), utc('2026-12-01T00:00:00Z')), []);
  });

  const dmf = { type: 'monthlyNth', n: 1, weekday: 0, time: '00:01', zone: 'America/Los_Angeles', durationMin: 7 * 1440 };

  test('the first Sunday of each month, from November 2026 to March 2027', () => {
    const w = S.windows(dmf, utc('2026-10-28T00:00:00Z'), utc('2027-03-31T00:00:00Z'));
    assert.deepEqual(w.map((x) => iso(x.start)), [
      '2026-11-01T07:01:00Z', // Sun Nov 1, still PDT at 00:01
      '2026-12-06T08:01:00Z', // PST from here
      '2027-01-03T08:01:00Z',
      '2027-02-07T08:01:00Z',
      '2027-03-07T08:01:00Z', // the US change is a week later, on 2027-03-14
    ]);
    assert.ok(w.every((x) => x.end - x.start === 7 * DAY));
  });

  test('a month that starts on a Sunday uses the 1st; a first-Sunday window open across a month end is still found', () => {
    const feb = S.windows(dmf, utc('2026-02-01T00:00:00Z'), utc('2026-02-02T00:00:00Z'));
    assert.equal(iso(feb[0].start), '2026-02-01T08:01:00Z'); // 2026-02-01 is a Sunday
    const spanning = { type: 'monthlyNth', n: 1, weekday: 0, time: '00:01', zone: 'UTC', durationMin: 7 * 1440 };
    // 2026-03-01 is a Sunday; that window runs to 2026-03-08.
    assert.equal(iso(S.currentWindow(spanning, utc('2026-03-07T12:00:00Z')).start), '2026-03-01T00:01:00Z');
  });

  const every = { type: 'every', periodMin: 60, offsetMin: 0, durationMin: 15 };

  test('an hourly 15-minute window: open at :00, closed at :15, and the next one at the hour', () => {
    const t = utc('2026-10-28T10:00:00Z');
    assert.equal(S.currentWindow(every, t - 1), null);
    assert.equal(iso(S.currentWindow(every, t).start), '2026-10-28T10:00:00Z');
    assert.equal(S.currentWindow(every, t + 15 * MIN), null);
    assert.ok(S.currentWindow(every, t + 15 * MIN - 1));
    assert.deepEqual(S.windows(every, t + 20 * MIN, t + 3 * HOUR).map((w) => iso(w.start)), ['2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z']);
  });

  test('a first-Sunday rule respects until: no window starts at or after it', () => {
    const bounded = Object.assign({}, dmf, { until: '2027-01-03T08:01:00Z' });
    assert.deepEqual(S.windows(bounded, utc('2026-10-28T00:00:00Z'), utc('2027-06-01T00:00:00Z')).map((x) => iso(x.start)), ['2026-11-01T07:01:00Z', '2026-12-06T08:01:00Z']);
  });

  test('"every" respects from and until', () => {
    const bounded = Object.assign({}, every, { from: '2026-10-28T10:00:00Z', until: '2026-10-28T12:00:00Z' });
    assert.deepEqual(S.windows(bounded, utc('2026-10-28T00:00:00Z'), utc('2026-10-29T00:00:00Z')).map((w) => iso(w.start)), ['2026-10-28T10:00:00Z', '2026-10-28T11:00:00Z']);
  });

  // ---- Happening now and Coming up ----

  const ev = (id, schedules, name) => ({ id, name: name || id, schedules });
  const A = ev('a', { us: dates });
  const B = ev('b', { us: dmf, eu: Object.assign({}, dmf, { zone: 'Europe/Paris' }) });
  const C = ev('c', { eu: dates });

  test('overlapping events are all happening, soonest to end first, and only in their regions', () => {
    const t = utc('2026-11-01T12:00:00Z'); // inside A (ends 17:00 Nov 1) and B (Nov 1-8)
    assert.deepEqual(S.happening([B, A, C], 'us', t).map((i) => i.event.id), ['a', 'b']);
    assert.deepEqual(S.happening([B, A, C], 'eu', t).map((i) => i.event.id), ['c', 'b']);
  });

  test('Coming up lists starts strictly after now and up to the span, inclusive', () => {
    const start = utc('2026-11-01T07:01:00Z');
    assert.deepEqual(S.upcoming([B], 'us', start, DAY), []); // starting right now is Happening, not Coming up
    assert.deepEqual(S.upcoming([B], 'us', start - 1, DAY).map((i) => iso(i.start)), ['2026-11-01T07:01:00Z']);
    assert.deepEqual(S.upcoming([B], 'us', start - HOUR, HOUR).map((i) => iso(i.start)), ['2026-11-01T07:01:00Z']);
    assert.deepEqual(S.upcoming([B], 'us', start - HOUR - 1, HOUR), []);
  });

  test('the next window of each event, one per event, soonest first', () => {
    const t = utc('2026-10-28T00:00:00Z');
    assert.deepEqual(S.nextOf([A, B], 'us', t, 90 * DAY).map((i) => `${i.event.id} ${iso(i.start)}`), ['b 2026-11-01T07:01:00Z', 'a 2026-12-16T18:00:00Z']);
  });

  test('an event with no schedule in the region is never listed', () => {
    const t = utc('2026-10-20T00:00:00Z');
    assert.deepEqual(S.happening([C], 'us', t), []);
    assert.deepEqual(S.upcoming([C], 'us', t, 90 * DAY), []);
    assert.equal(S.scheduleFor(C, 'us'), null);
  });

  // ---- Display helpers ----

  test('durations read as seconds, minutes, hours or days and never go negative', () => {
    assert.equal(S.duration(45000), '45s');
    assert.equal(S.duration(12 * MIN + 5000), '12m 05s');
    assert.equal(S.duration(HOUR + 5 * MIN + 59000), '1h 05m');
    assert.equal(S.duration(2 * DAY + 4 * HOUR + 59 * MIN), '2d 4h');
    assert.equal(S.duration(-5000), '0s');
  });

  test('Today and Tomorrow follow the calendar of the display zone, not UTC', () => {
    const now = utc('2026-10-28T03:00:00Z'); // 8 PM Oct 27 in Los Angeles, 03:00 Oct 28 UTC
    assert.equal(S.dayLabel(utc('2026-10-28T06:00:00Z'), now, 'America/Los_Angeles'), 'Today');
    assert.equal(S.dayLabel(utc('2026-10-28T08:00:00Z'), now, 'America/Los_Angeles'), 'Tomorrow');
    assert.equal(S.dayLabel(utc('2026-10-28T08:00:00Z'), now, 'UTC'), 'Today');
    assert.equal(S.dayLabel(utc('2026-10-29T00:00:00Z'), now, 'UTC'), 'Tomorrow');
    assert.equal(S.dayLabel(utc('2026-10-29T07:00:00Z'), now, 'America/Los_Angeles', 'en-US'), 'Thursday, Oct 29'); // two days on: a weekday, not Tomorrow
    assert.equal(S.dayKey(utc('2026-10-28T06:59:59Z'), 'America/Los_Angeles'), '2026-10-27');
    assert.equal(S.dayKey(utc('2026-10-28T07:00:00Z'), 'America/Los_Angeles'), '2026-10-28');
  });
}
