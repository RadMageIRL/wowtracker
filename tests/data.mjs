// Data rules and schedule checks against references that do not come from js/schedule.js: the game
// client's calendar rows decoded by a separate Python script with hand-written daylight-saving rules
// (tests/fixtures/client-calendar-12.1.5.json), Blizzard's published dates, and dated sightings.
// Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/schedule.js');
const DATA = require('../events-data.js');
const SOURCE = JSON.parse(readFileSync(new URL('../data/events.source.json', import.meta.url), 'utf8'));
const CLIENT = JSON.parse(readFileSync(new URL('./fixtures/client-calendar-12.1.5.json', import.meta.url), 'utf8')).rows;
const utc = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const copy = (v) => JSON.parse(JSON.stringify(v));
const HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
const EV = new Map(DATA.events.map((e) => [e.id, e]));
const ZONE = { us: 'America/Los_Angeles', eu: 'Europe/Paris' };

/** The client row ids an event's sources cite ("ID 324, Region 0, ..." in the source file). */
const clientIds = (e) => SOURCE.events.find((x) => x.id === e.id).sources.filter((s) => s.kind === 'client').flatMap((s) => [...s.quote.matchAll(/ID (\d+)/g)].map((m) => Number(m[1])));

/** WoW packed time, decoded here a second time: minute 6 bits, hour 5, weekday 3, day 6, month 4, year 5. */
function unpack(v) {
  return { mi: v & 63, h: (v >> 6) & 31, d: ((v >> 14) & 63) + 1, mo: ((v >> 20) & 15) + 1, y: (v >> 24) & 31 };
}

export async function dataTests(test) {
  const { buildData, validate, pageData } = await import('../tools/build-data.mjs');

  test('the dataset passes every rule and events-data.js is current', () => {
    const r = buildData({ check: true, log: () => {} });
    assert.ok(r.ok, r.errors.join('\n'));
  });

  test('the dataset holds 27 events: 22 confirmed (8 holidays, 8 small events, the Faire, 5 weekly events) and 5 predicted', () => {
    const by = (k) => DATA.events.filter((e) => e.category === k).length;
    assert.equal(DATA.events.length, 27);
    assert.deepEqual([by('holiday'), by('minor'), by('darkmoon'), by('timewalking'), by('bonus'), by('world-boss'), by('outdoor')], [8, 8, 1, 1, 4, 4, 1]);
    assert.deepEqual(DATA.events.filter((e) => e.status === 'predicted').map((e) => e.category).sort(), ['outdoor', 'world-boss', 'world-boss', 'world-boss', 'world-boss']);
  });

  test('the page data carries source links and check dates but no quotes', () => {
    const text = JSON.stringify(pageData(SOURCE));
    assert.ok(!text.includes('"quote"') && !text.includes('"retrieved"'));
    for (const e of DATA.events) {
      assert.ok(e.sources.length && e.sources.every((s) => s.url.startsWith('https://') && s.publisher), e.id);
      assert.match(e.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // ---- Against the game's calendar rows ----

  test('every dated window is a client calendar row of that event, start and end, in its region', () => {
    let checked = 0;
    for (const e of DATA.events) {
      const ids = clientIds(e);
      for (const [r, s] of Object.entries(e.schedules)) {
        if (s.type !== 'dates') continue;
        for (const w of s.windows) {
          const row = CLIENT.find((x) => ids.includes(x.holidayId) && x.region === r && x.startUtc === w.start);
          assert.ok(row, `${e.id} ${r} ${w.start}`);
          assert.equal(w.end, row.endUtc, `${e.id} ${r} end`);
          checked++;
        }
      }
    }
    assert.equal(checked, 44); // 16 holidays and small events, 2 Timewalking weeks and 4 bonus weeks, in two regions
  });

  test('the zone database agrees with the hand-written daylight-saving rules on every client row', () => {
    for (const row of CLIENT) {
      const [d, t] = row.wall.split(' ');
      const [y, mo, day] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
      assert.equal(iso(S.wallToUtc(ZONE[row.region], y, mo, day, h, mi)), row.startUtc, `${row.name} ${row.region} ${row.wall}`);
    }
  });

  test('the packed client dates decode to the wall times in the fixture (a second decoder)', () => {
    for (const row of CLIENT) {
      const u = unpack(row.packed);
      const [d, t] = row.wall.split(' ');
      const [y, mo, day] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
      assert.deepEqual([u.mo, u.d, u.h, u.mi], [mo, day, h, mi], `${row.name} ${row.packed}`);
      assert.ok(u.y === 31 || 2000 + u.y === y, `${row.name} year`);
    }
  });

  test('the Darkmoon Faire rule opens on the first Sunday exactly when the client rows do (48 h after their Friday), November to March', () => {
    const e = EV.get('darkmoon-faire');
    for (const r of ['us', 'eu']) {
      const want = CLIENT.filter((x) => x.holidayId === 479 && x.region === r && x.startUtc >= '2026-10-25')
        .map((x) => iso(utc(x.startUtc) + 48 * HOUR));
      const got = S.windows(e.schedules[r], utc('2026-10-25T00:00:00Z'), utc('2027-03-31T00:00:00Z')).map((w) => iso(w.start));
      assert.deepEqual(got, want, r);
      assert.equal(want.length, 5);
      for (const w of S.windows(e.schedules[r], utc('2026-10-25T00:00:00Z'), utc('2027-03-31T00:00:00Z'))) assert.equal(w.end - w.start, 168 * HOUR);
    }
  });

  test('every weekly bonus and Timewalking week starts at its region\'s weekly reset, and none starts on or after December 1', () => {
    for (const e of DATA.events.filter((x) => ['bonus', 'timewalking'].includes(x.category))) {
      for (const [r, s] of Object.entries(e.schedules)) {
        for (const w of s.windows) {
          const t = utc(w.start);
          assert.equal(S.previousReset(DATA.resets[r].weekly.rule, t), t, `${e.id} ${r} ${w.start}`);
          assert.ok(w.start < '2026-12-01', `${e.id} ${w.start}`);
        }
      }
    }
    assert.ok(DATA.untracked.some((u) => /December 1/.test(u.name)));
  });

  test('Timewalking names the expansion of each week, from the game\'s own description of that week', () => {
    const tw = EV.get('timewalking');
    assert.deepEqual(tw.schedules.us.windows.map((w) => `${w.start.slice(0, 10)} ${w.name}`), ['2026-10-27 Warlords of Draenor Timewalking', '2026-11-17 Legion Timewalking']);
    assert.deepEqual(tw.schedules.eu.windows.map((w) => `${w.start.slice(0, 10)} ${w.name}`), ['2026-10-28 Warlords of Draenor Timewalking', '2026-11-18 Legion Timewalking']);
  });

  // ---- Against Blizzard's published dates and statements ----

  test('Hallow\'s End 2026 runs October 19 to November 2 on the Americas\' Pacific calendar, as Blizzard published', () => {
    const w = EV.get('hallows-end').schedules.us.windows[0];
    assert.equal(S.dayKey(utc(w.start), ZONE.us), '2026-10-19');
    assert.equal(S.dayKey(utc(w.end), ZONE.us), '2026-11-02');
    const wall = S.wallClock(ZONE.us, utc(w.start));
    assert.deepEqual([wall.h, wall.mi], [10, 0]);
  });

  test('resets: Americas daily 15:00 UTC and Tuesday weekly; Europe daily 04:00 UTC and Wednesday weekly', () => {
    const r = DATA.resets;
    assert.deepEqual([r.us.daily.rule, r.us.weekly.rule], [{ type: 'daily', time: '15:00', zone: 'UTC' }, { type: 'weekly', weekday: 2, time: '15:00', zone: 'UTC' }]);
    assert.deepEqual([r.eu.daily.rule, r.eu.weekly.rule], [{ type: 'daily', time: '04:00', zone: 'UTC' }, { type: 'weekly', weekday: 3, time: '04:00', zone: 'UTC' }]);
    assert.equal(r.us.monthly.status, 'predicted');
    assert.equal(r.eu.monthly.status, 'predicted');
  });

  test('the Americas weekly reset is 8 a.m. PDT in summer and 7 a.m. PST in winter, as Blizzard\'s 2016 statement implies', () => {
    const rule = DATA.resets.us.weekly.rule;
    const summer = S.nextReset(rule, utc('2026-09-01T00:00:00Z')), winter = S.nextReset(rule, utc('2026-12-01T00:00:00Z'));
    assert.deepEqual([S.wallClock(ZONE.us, summer).h, S.wallClock(ZONE.us, summer).wd], [8, 2]);
    assert.deepEqual([S.wallClock(ZONE.us, winter).h, S.wallClock(ZONE.us, winter).wd], [7, 2]);
  });

  test('the Europe weekly reset is 05:00 CET in winter (Blizzard\'s 2022 post) and 06:00 CEST in summer (the 2024 game API example)', () => {
    const rule = DATA.resets.eu.weekly.rule;
    const winter = S.nextReset(rule, utc('2026-11-01T00:00:00Z'));
    assert.deepEqual([S.wallClock('Europe/Paris', winter).h, S.wallClock('Europe/Paris', winter).wd], [5, 3]);
    assert.equal(S.previousReset(rule, 1723608000 * 1000 + HOUR), 1723608000 * 1000);
    assert.equal(S.wallClock('Europe/Paris', 1723608000 * 1000).h, 6);
  });

  // ---- World bosses, against dated sightings ----

  const BOSSES = ['world-boss-luashal', 'world-boss-cragpine', 'world-boss-thormbelan', 'world-boss-predaxas'].map((id) => EV.get(id));
  const bossAt = (r, ms) => S.happening(BOSSES, r, ms).map((i) => i.event.name);

  test('exactly one world boss per reset week in each region, from Season 1 to the end of November', () => {
    for (const r of ['us', 'eu']) {
      const rule = DATA.resets[r].weekly.rule;
      for (let t = S.nextReset(rule, utc('2026-03-17T00:00:00Z')); t < utc('2026-12-01T00:00:00Z'); t += WEEK) {
        assert.equal(bossAt(r, t).length, 1, `${r} ${iso(t)}`);
        assert.equal(bossAt(r, t + WEEK - 1)[0], bossAt(r, t)[0], `${r} ${iso(t)} lasts the week`);
      }
    }
  });

  test('the world boss order matches every dated sighting (Icy Veins weekly posts, player posts, the Wowhead panel on 2026-10-28)', () => {
    const seen = [
      ['us', '2026-03-18T01:36:00Z', "Lu'ashal"], ['us', '2026-03-24T23:17:00Z', 'Cragpine'], ['us', '2026-03-31T22:40:00Z', "Thorm'belan"],
      ['us', '2026-04-14T20:00:00Z', "Lu'ashal"], ['us', '2026-04-23T12:00:00Z', 'Cragpine'], ['us', '2026-04-28T20:00:00Z', "Thorm'belan"],
      ['us', '2026-08-12T01:41:00Z', 'Cragpine'], ['us', '2026-10-12T02:17:00Z', 'Cragpine'],
      ['us', '2026-10-28T01:20:00Z', "Lu'ashal"], ['eu', '2026-10-28T01:20:00Z', 'Predaxas'],
    ];
    for (const [r, at, name] of seen) assert.deepEqual(bossAt(r, utc(at)), [name], `${r} ${at}`);
  });

  test('world bosses and Aqir Invasions stop at the December 1 reset, where the data was last checked against a patch', () => {
    assert.deepEqual(bossAt('us', utc('2026-12-01T15:00:00Z')), []);
    assert.deepEqual(bossAt('us', utc('2026-12-01T14:59:59Z')).length, 1);
    assert.equal(S.currentWindow(EV.get('aqir-invasion').schedules.us, utc('2026-12-01T16:05:00Z')), null);
  });

  test('Aqir Invasions: on the hour for ten minutes, only after 12.1.5 reached each region', () => {
    const a = EV.get('aqir-invasion');
    assert.ok(S.currentWindow(a.schedules.us, utc('2026-10-28T02:09:59Z')));
    assert.equal(S.currentWindow(a.schedules.us, utc('2026-10-28T02:10:00Z')), null);
    assert.equal(S.currentWindow(a.schedules.us, utc('2026-10-13T14:00:00Z')), null);
    assert.equal(S.currentWindow(a.schedules.eu, utc('2026-10-14T03:00:00Z')), null);
    assert.ok(S.currentWindow(a.schedules.eu, utc('2026-10-14T05:00:00Z')));
  });

  // ---- Overlap ----

  test('on 2026-11-01 at 18:30 UTC (Americas) five scheduled events overlap and all of them are happening', () => {
    const t = utc('2026-11-01T18:30:00Z'); // after the 18:00 Aqir Invasion closed at 18:10
    assert.deepEqual(S.happening(DATA.events, 'us', t).map((i) => i.event.id).sort(),
      ['darkmoon-faire', 'day-of-the-dead', 'hallows-end', 'timewalking', 'world-boss-luashal']);
  });

  // ---- The rules refuse bad data ----

  const refused = (mutate, pattern) => {
    const src = copy(SOURCE);
    mutate(src);
    const errors = validate(src);
    assert.ok(errors.some((x) => pattern.test(x)), `expected ${pattern}, got:\n${errors.join('\n') || '(nothing)'}`);
  };
  const ev = (src, id) => src.events.find((e) => e.id === id);

  test('the untouched source passes validation (the control for the refusals below)', () => {
    assert.deepEqual(validate(copy(SOURCE)), []);
  });
  test('confirmed with only a wiki or guide source is refused', () => {
    refused((s) => { ev(s, 'pilgrims-bounty').sources = ev(s, 'pilgrims-bounty').sources.filter((x) => x.kind === 'wiki' || x.kind === 'guide'); ev(s, 'pilgrims-bounty').sources.push({ url: 'https://warcraft.wiki.gg/wiki/X', publisher: 'Warcraft Wiki', kind: 'wiki', quote: 'a verbatim quote here', retrieved: '2026-10-27' }); }, /confirmed needs/);
  });
  test('predicted without a basis is refused', () => {
    refused((s) => { delete ev(s, 'aqir-invasion').basis; }, /predicted needs a basis/);
  });
  test('an "unverified" status is refused: such schedules are listed under untracked, never as times', () => {
    refused((s) => { ev(s, 'aqir-invasion').status = 'unverified'; }, /status must be one of/);
  });
  test('a source without its verbatim quote is refused', () => {
    refused((s) => { ev(s, 'hallows-end').sources[0].quote = ''; }, /verbatim quote/);
  });
  test('overlapping or out-of-order windows are refused', () => {
    refused((s) => { const w = ev(s, 'timewalking').schedules.us.windows; w.push(copy(w[0])); }, /overlap or are out of order/);
  });
  test('a window time without an offset is refused', () => {
    refused((s) => { ev(s, 'hallows-end').schedules.us.windows[0].start = '2026-10-19T10:00:00'; }, /date, time and offset/);
  });
  test('an unknown time zone is refused', () => {
    refused((s) => { ev(s, 'darkmoon-faire').schedules.us.zone = 'America/Atlantis'; }, /unknown time zone/);
  });
  test('a region that claims more certainty than its event is refused', () => {
    refused((s) => { ev(s, 'aqir-invasion').schedules.us.status = 'confirmed'; }, /cannot be more certain/);
  });
  test('a check date after the review date is refused', () => {
    refused((s) => { ev(s, 'noblegarden').lastVerified = '2026-12-01'; }, /after meta.reviewedOn/);
  });
  test('an unknown category is refused', () => {
    refused((s) => { ev(s, 'noblegarden').category = 'parties'; }, /unknown category/);
  });
  test('a reset without its daily or weekly rule is refused', () => {
    refused((s) => { delete s.resets.eu.weekly; }, /weekly missing/);
  });
  test("a dated window that starts after its category's knownUntil is refused", () => {
    refused((s) => { ev(s, 'timewalking').schedules.us.windows.push({ start: '2026-12-08T15:00:00Z', end: '2026-12-15T14:00:00Z', name: 'Unknown Timewalking' }); }, /after its category's knownUntil/);
  });
  test("a repeating schedule with no until, or one past its category's knownUntil, is refused", () => {
    refused((s) => { delete ev(s, 'darkmoon-faire').schedules.us.until; }, /needs an until/);
    refused((s) => { ev(s, 'world-boss-luashal').schedules.eu.until = '2027-01-01T04:00:00Z'; }, /needs an until/);
  });
  test('a category without knownUntil for a region, or without the reason it stops, is refused', () => {
    refused((s) => { delete s.categories[0].knownUntil.eu; }, /knownUntil\.eu/);
    refused((s) => { delete s.categories[0].gap; }, /gap/);
  });

  // ---- Coverage: where schedules stop being known ----

  test('weekly categories are known to the December 1 reset in each region; holidays, small events and the Faire to the end of March 2027', () => {
    const k = Object.fromEntries(DATA.categories.map((c) => [c.id, c.knownUntil]));
    for (const id of ['timewalking', 'bonus', 'world-boss', 'outdoor']) assert.deepEqual(k[id], { us: '2026-12-01T15:00:00Z', eu: '2026-12-02T04:00:00Z' }, id);
    for (const id of ['holiday', 'minor', 'darkmoon']) assert.deepEqual(k[id], { us: '2027-04-01T00:00:00Z', eu: '2027-04-01T00:00:00Z' }, id);
    // The weekly data stops exactly at a weekly reset in each region.
    assert.equal(S.previousReset(DATA.resets.us.weekly.rule, utc(k.bonus.us)), utc(k.bonus.us));
    assert.equal(S.previousReset(DATA.resets.eu.weekly.rule, utc(k.bonus.eu)), utc(k.bonus.eu));
  });

  test("no schedule produces a window at or after its category's knownUntil (checked by expanding every schedule to 2028)", () => {
    for (const e of DATA.events) {
      const c = DATA.categories.find((x) => x.id === e.category);
      for (const [r, s] of Object.entries(e.schedules)) {
        const late = S.windows(s, utc(c.knownUntil[r]), utc('2028-01-01T00:00:00Z')).filter((w) => w.start >= utc(c.knownUntil[r]));
        assert.deepEqual(late, [], `${e.id} ${r}`);
      }
    }
  });
}
