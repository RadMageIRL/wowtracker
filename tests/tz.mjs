// Time-zone checks, run by tests/run.mjs once per zone (TZ set in the environment). Schedules carry
// their own zone, so nothing may change with the device zone except the display helpers, which are
// given the zone they should read.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/schedule.js');
const DATA = require('../events-data.js');
const tz = process.env.TZ;
const utc = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
let failed = 0;
function test(name, fn) { try { fn(); } catch (e) { failed++; console.log(`FAIL [${tz}] ${name}\n  ${e.message}`); } }

test('the zone the platform reports has the same offsets as the device clock (the zone may be reported by an alias)', () => {
  for (const t of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) assert.equal(S.offsetMin(local, utc(t)), 0 - new Date(utc(t)).getTimezoneOffset() || 0, t);
});

test('resets are the same instants in every device zone', () => {
  const now = utc('2026-10-28T01:00:00Z');
  assert.equal(iso(S.nextReset(DATA.resets.us.daily.rule, now)), '2026-10-28T15:00:00Z');
  assert.equal(iso(S.nextReset(DATA.resets.us.weekly.rule, now)), '2026-11-03T15:00:00Z');
  assert.equal(iso(S.nextReset(DATA.resets.eu.daily.rule, now)), '2026-10-28T04:00:00Z');
  assert.equal(iso(S.nextReset(DATA.resets.eu.weekly.rule, now)), '2026-10-28T04:00:00Z');
  assert.equal(iso(S.nextReset(DATA.resets.us.monthly.rule, now)), '2026-11-01T15:00:00Z');
});

test('the Darkmoon Faire opens at the same instants in every device zone', () => {
  const e = DATA.events.find((x) => x.id === 'darkmoon-faire');
  const us = S.windows(e.schedules.us, utc('2026-10-28T00:00:00Z'), utc('2027-01-31T00:00:00Z')).map((w) => iso(w.start));
  assert.deepEqual(us, ['2026-11-01T07:00:00Z', '2026-12-06T08:00:00Z', '2027-01-03T08:00:00Z']);
});

test('Today and Tomorrow follow the device calendar, across both 2026 daylight-saving changes', () => {
  for (const nowIso of ['2026-10-24T22:00:00Z', '2026-10-31T23:00:00Z', '2026-11-01T05:30:00Z', '2026-03-08T07:30:00Z', '2026-03-29T00:30:00Z']) {
    const now = utc(nowIso), n = new Date(now);
    // Local midnight from the platform's own Date, independent of schedule.js.
    const endOfDay = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0).getTime();
    assert.equal(S.dayLabel(endOfDay - 1, now, local), 'Today', nowIso);
    assert.equal(S.dayLabel(endOfDay, now, local), 'Tomorrow', nowIso);
    assert.ok(S.dayKey(endOfDay - 1, local) < S.dayKey(endOfDay, local), nowIso);
  }
});

test('a wall clock read in the device zone matches the platform\'s own local clock', () => {
  for (const t of ['2026-03-08T10:30:00Z', '2026-10-25T00:30:00Z', '2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z']) {
    const d = new Date(utc(t)), w = S.wallClock(local, utc(t));
    assert.deepEqual([w.y, w.mo, w.d, w.h, w.mi], [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], t);
  }
});

if (failed) process.exit(1);
