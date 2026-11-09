// WoW: Forever schedule data against references that do not come from js/schedule.js: the game client's
// calendar rows (product wowf, build 1.60.1.70862) decoded by a separate Python script with daylight-saving
// rules written out by hand (tests/fixtures/client-calendar-forever-1.60.1.json, from
// local/scripts/forever_windows.py), and the November 8, 2026 sighting of the weekly fishing contest.
// Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/schedule.js');
const DATA = require('../forever-data.js');
const RETAIL = require('../events-data.js');
const SOURCE = JSON.parse(readFileSync(new URL('../data/forever.source.json', import.meta.url), 'utf8'));
const FIX = JSON.parse(readFileSync(new URL('./fixtures/client-calendar-forever-1.60.1.json', import.meta.url), 'utf8'));
const ROWS = FIX.rows, TABLE = new Map(FIX.table.map((r) => [r.holidayId, r]));
const utc = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const copy = (v) => JSON.parse(JSON.stringify(v));
const HOUR = 3600000, DAY = 86400000;
const EV = new Map(DATA.events.map((e) => [e.id, e]));
const ZONE = Object.fromEntries(DATA.regions.map((r) => [r.id, r.serverZone.zone]));
const KNOWN = utc('2027-11-08T00:00:00Z');

/** The client row ids an event's sources cite ("ID 301, Region 0, ..."). */
const clientIds = (e) => SOURCE.events.find((x) => x.id === e.id).sources.filter((s) => s.kind === 'client').flatMap((s) => [...s.quote.matchAll(/ID (\d+)/g)].map((m) => Number(m[1])));
/** WoW packed time, decoded here a second time: minute 6 bits, hour 5, weekday 3, day - 1 6, month - 1 4, year - 2000 5. */
const unpack = (v) => ({ mi: v & 63, h: (v >> 6) & 31, wd: (v >> 11) & 7, d: ((v >> 14) & 63) + 1, mo: ((v >> 20) & 15) + 1, y: (v >> 24) & 31 });
const wallOf = (row) => { const [d, t] = row.wall.split(' '); const [y, mo, day] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number); return { y, mo, d: day, h, mi }; };
const windowsOf = (e, r) => (e.schedules[r] ? e.schedules[r].windows : []);
const pad = (n) => String(n).padStart(2, '0');

export async function foreverTests(test) {
  const { validate, pageData } = await import('../tools/build-data.mjs');

  test('Forever data r1: nine events from the game\'s calendar (six holidays, the Darkmoon Faire, the fishing contest, one small event), covering dates through November 7, 2027', () => {
    assert.equal(DATA.meta.datasetRevision, 1);
    assert.deepEqual([DATA.meta.edition, DATA.meta.product, DATA.meta.clientBuild, DATA.meta.coversUntil], ['forever', 'wowf', FIX.build, '2027-11-07']);
    assert.deepEqual(DATA.events.map((e) => [e.id, e.category]), [
      ['darkmoon-faire', 'darkmoon'], ['stranglethorn-fishing-extravaganza', 'outdoor'], ['feast-of-winter-veil', 'holiday'], ['lunar-festival', 'holiday'],
      ['love-is-in-the-air', 'holiday'], ['midsummer-fire-festival', 'holiday'], ['fireworks-spectacular', 'minor'], ['harvest-festival', 'holiday'], ['hallows-end', 'holiday']]);
    const count = (r) => Object.fromEntries(DATA.events.map((e) => [e.id, windowsOf(e, r).length]));
    assert.deepEqual(count('us'), { 'darkmoon-faire': 12, 'stranglethorn-fishing-extravaganza': 53, 'feast-of-winter-veil': 1, 'lunar-festival': 1, 'love-is-in-the-air': 1, 'midsummer-fire-festival': 1, 'fireworks-spectacular': 1, 'harvest-festival': 1, 'hallows-end': 1 });
    assert.deepEqual(count('eu'), { ...count('us'), 'fireworks-spectacular': 0 }, 'the July 4 fireworks are an Americas row (Region 1)');
    for (const c of DATA.categories) for (const r of ['us', 'eu']) assert.equal(utc(c.knownUntil[r]), KNOWN, `${c.id} ${r}`);
  });

  // ---- Decoding the client calendar ----

  test('the client calendar decodes the same way twice: every packed date gives the fixture\'s wall time and weekday', () => {
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const row of ROWS) {
      const u = unpack(row.packed), w = wallOf(row);
      assert.deepEqual([u.h, u.mi], [w.h, w.mi], `${row.name} ${row.packed}`);
      if (u.mo === 16 && u.d === 64) assert.equal(WD[u.wd], row.weekday, `${row.name}: a weekly row names its weekday`);
      else {
        assert.deepEqual([u.mo, u.d], [w.mo, w.d], `${row.name} ${row.packed}`);
        assert.ok(u.y === 31 || 2000 + u.y === w.y, `${row.name} year`);
      }
      assert.equal(WD[new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay()], row.weekday, `${row.name} ${row.wall}`);
    }
    // The fishing contest is "any year, any month, any day, Sunday 14:00"; Winter Veil is "any year, December 15, 06:00".
    assert.deepEqual(unpack(TABLE.get(301).dates[0]), { mi: 0, h: 14, wd: 0, d: 64, mo: 16, y: 31 });
    assert.deepEqual(unpack(TABLE.get(141).dates[0]), { mi: 0, h: 6, wd: 7, d: 15, mo: 12, y: 31 });
    assert.equal(FIX.table.length, 23);
    assert.equal(FIX.sources[0], `https://wago.tools/db2/Holidays/csv?build=${DATA.meta.clientBuild}`);
  });

  test('every Forever window is a client calendar row of that event, start and end, in its region, and every row of those events in the coverage is shown', () => {
    let checked = 0;
    for (const e of DATA.events) {
      const ids = clientIds(e);
      assert.ok(ids.length, `${e.id} cites its row`);
      for (const r of ['us', 'eu']) {
        const want = ROWS.filter((x) => ids.includes(x.holidayId) && x.region === r && utc(x.startUtc) < KNOWN).map((x) => [x.startUtc, x.endUtc]);
        assert.deepEqual(windowsOf(e, r).map((w) => [w.start, w.end]), want, `${e.id} ${r}`);
        checked += want.length;
      }
    }
    assert.equal(checked, 143);
  });

  // ---- Regional times: each region's own server clock, never Retail's ----

  test('the zone database agrees with the hand-written US Central and Central European rules on every client row', () => {
    for (const row of ROWS) {
      const w = wallOf(row);
      assert.equal(iso(S.wallToUtc(ZONE[row.region], w.y, w.mo, w.d, w.h, w.mi)), row.startUtc, `${row.name} ${row.region} ${row.wall}`);
    }
    assert.deepEqual(ZONE, { us: 'America/Chicago', eu: 'Europe/Paris' });
  });

  test('UTC conversions: the fishing contest of November 8, 2026 lands where it was seen (Americas 20:00 UTC, Europe 13:00 UTC); Americas times are US Central, never Retail\'s Pacific', () => {
    const at = (id, r, day) => windowsOf(EV.get(id), r).find((w) => w.start.startsWith(day)).start;
    assert.deepEqual(['us', 'eu'].map((r) => at('stranglethorn-fishing-extravaganza', r, '2026-11-08')), ['2026-11-08T20:00:00Z', '2026-11-08T13:00:00Z']);
    assert.deepEqual(['us', 'eu'].map((r) => at('darkmoon-faire', r, '2026-11-09')), ['2026-11-09T10:00:00Z', '2026-11-09T03:00:00Z']);
    assert.deepEqual(['us', 'eu'].map((r) => at('feast-of-winter-veil', r, '2026-12-15')), ['2026-12-15T12:00:00Z', '2026-12-15T05:00:00Z']);
    assert.deepEqual(['us', 'eu'].map((r) => at('lunar-festival', r, '2027-02-02')), ['2027-02-02T16:00:00Z', '2027-02-02T09:00:00Z']);
    // The same server wall time read on Retail's Americas clock would be two hours later (one in the weeks Pacific and Central change apart: none here).
    for (const e of DATA.events) for (const w of windowsOf(e, 'us')) {
      const c = S.wallClock('America/Chicago', utc(w.start));
      assert.equal(S.wallToUtc('America/Los_Angeles', c.y, c.mo, c.d, c.h, c.mi) - utc(w.start), 2 * HOUR, `${e.id} ${w.start}`);
    }
  });

  test('the two regions start the same server time 7 hours apart, 6 in the weeks when only one clock has changed (from March 14 to 28 and from October 31 to November 7, 2027)', () => {
    const gaps = new Map();
    for (const e of DATA.events) {
      const eu = windowsOf(e, 'eu');
      windowsOf(e, 'us').forEach((w) => {
        const o = eu.find((x) => S.wallClock('Europe/Paris', utc(x.start)).d === S.wallClock('America/Chicago', utc(w.start)).d && Math.abs(utc(x.start) - utc(w.start)) < DAY);
        if (!o) return;
        const h = (utc(w.start) - utc(o.start)) / HOUR;
        gaps.set(h, [...(gaps.get(h) || []), w.start.slice(0, 10)]);
      });
    }
    assert.deepEqual([...gaps.keys()].sort(), [6, 7]);
    // November 7 is back to 7: the US clock changes at 02:00 that morning, before the contest.
    assert.deepEqual(gaps.get(6), ['2027-03-14', '2027-03-21', '2027-10-31']);
  });

  test('daylight-saving boundaries: the contest moves with each server clock (Americas March 14 and November 7, Europe March 28 and October 31, 2027) and always lasts 2 hours', () => {
    const f = EV.get('stranglethorn-fishing-extravaganza');
    const on = (r, day) => { const w = windowsOf(f, r).find((x) => x.start.startsWith(day)); assert.equal(utc(w.end) - utc(w.start), 2 * HOUR, `${r} ${day}`); return w.start.slice(11, 16); };
    assert.deepEqual(['2027-03-07', '2027-03-14', '2027-10-31', '2027-11-07'].map((d) => on('us', d)), ['20:00', '19:00', '19:00', '20:00']);
    assert.deepEqual(['2027-03-21', '2027-03-28', '2027-10-24', '2027-10-31'].map((d) => on('eu', d)), ['13:00', '12:00', '12:00', '13:00']);
    // A window across a change keeps its hours (elapsed time, as the game data and Retail's data count them): it ends an hour off the start's server time.
    const dmf = windowsOf(EV.get('darkmoon-faire'), 'us').find((w) => w.start.startsWith('2027-03-08'));
    assert.deepEqual([dmf.start, dmf.end], ['2027-03-08T10:00:00Z', '2027-03-15T10:00:00Z']);
    assert.equal(S.wallClock('America/Chicago', utc(dmf.end)).h, 5);
    const he = windowsOf(EV.get('hallows-end'), 'eu')[0];
    assert.deepEqual([he.start, he.end], ['2027-10-18T02:00:00Z', '2027-11-02T02:00:00Z']);
    assert.equal(S.wallClock('Europe/Paris', utc(he.end)).h, 3);
  });

  // ---- Recurrence and length ----

  test('recurrence: the contest every Sunday at 14:00 server time with no week missing; the Faire on Mondays at 04:00 for 7 days, alternating Elwynn Forest and Thunder Bluff; yearly holidays on the client\'s day and hour', () => {
    for (const r of ['us', 'eu']) {
      const fish = windowsOf(EV.get('stranglethorn-fishing-extravaganza'), r);
      fish.forEach((w, i) => {
        const c = S.wallClock(ZONE[r], utc(w.start));
        assert.deepEqual([c.wd, c.h, c.mi], [0, 14, 0], `${r} ${w.start}`);
        if (i) assert.equal(Math.round((utc(w.start) - utc(fish[i - 1].start)) / DAY), 7, `${r} ${w.start}`);
      });
      assert.deepEqual([fish[0].start.slice(0, 10), fish[fish.length - 1].start.slice(0, 10)], ['2026-11-08', '2027-11-07']);
      const dmf = windowsOf(EV.get('darkmoon-faire'), r);
      dmf.forEach((w, i) => {
        const c = S.wallClock(ZONE[r], utc(w.start));
        assert.deepEqual([c.wd, c.h, c.mi], [1, 4, 0], `${r} ${w.start}`);
        assert.equal(w.name, i % 2 ? 'Darkmoon Faire: Thunder Bluff' : 'Darkmoon Faire: Elwynn Forest', `${r} ${w.start}`);
      });
      for (const [id, mo, d, h] of [['feast-of-winter-veil', 12, 15, 6], ['love-is-in-the-air', 2, 11, 6], ['midsummer-fire-festival', 6, 21, 4], ['hallows-end', 10, 18, 4]]) {
        const u = unpack(TABLE.get(clientIds(EV.get(id))[0]).dates[0]);
        assert.deepEqual([u.y, u.mo, u.d, u.h], [31, mo, d, h], `${id}: a yearly row`);
        const c = S.wallClock(ZONE[r], utc(windowsOf(EV.get(id), r)[0].start));
        assert.deepEqual([c.mo, c.d, c.h], [mo, d, h], `${id} ${r}`);
      }
    }
  });

  test('the Repeats line of every event names the server time its windows start at', () => {
    for (const e of DATA.events) {
      assert.ok(e.repeats, e.id);
      const c = S.wallClock(ZONE.us, utc(windowsOf(e, 'us')[0].start));
      assert.match(e.repeats, new RegExp(`(at |from |, )${pad(c.h)}:${pad(c.mi)}( to \\d\\d:\\d\\d)? server time`), `${e.id}: ${e.repeats}`);
      assert.doesNotMatch(e.repeats, /\b(UTC|Pacific|PST|CET|CST)\b/, `${e.id}: in server time only`);
    }
    assert.equal(EV.get('stranglethorn-fishing-extravaganza').repeats, 'Every Sunday, 14:00 to 16:00 server time.');
  });

  test('holiday lengths are the client\'s hours: Winter Veil 18 days, Hallow\'s End 15, Lunar Festival and Midsummer 14, the Faire and Harvest Festival 7, Love is in the Air 5, the fireworks 18 hours, the contest 2', () => {
    const want = { 'feast-of-winter-veil': 432, 'hallows-end': 360, 'lunar-festival': 336, 'midsummer-fire-festival': 336, 'darkmoon-faire': 168, 'harvest-festival': 168, 'love-is-in-the-air': 120, 'fireworks-spectacular': 18, 'stranglethorn-fishing-extravaganza': 2 };
    for (const e of DATA.events) {
      for (const id of clientIds(e)) assert.deepEqual(TABLE.get(id).durationsH, [want[e.id]], `${e.id} row ${id}`);
      for (const r of ['us', 'eu']) for (const w of windowsOf(e, r)) assert.equal((utc(w.end) - utc(w.start)) / HOUR, want[e.id], `${e.id} ${r} ${w.start}`);
    }
  });

  // ---- Labels, sources and places ----

  test('Predicted time: every Forever time is labeled, in each region, with the reason (its server clock, seen once, Blizzard silent, daylight saving unseen); the page gets the reason', () => {
    const page = pageData(SOURCE);
    for (const e of page.events) {
      assert.equal(e.status, 'confirmed', `${e.id}: the dates are the game's own`);
      for (const [r, s] of Object.entries(e.schedules)) {
        assert.deepEqual([s.status, s.part], ['predicted', 'time'], `${e.id} ${r}`);
        assert.match(s.basis, r === 'us' ? /read as US Central time/ : /read as Central European time/);
        assert.match(s.basis, /Seen once; Blizzard has not said\. Whether these servers change their clocks/);
      }
    }
    assert.deepEqual(DATA.regions.map((r) => [r.serverZone.name, r.serverZone.status]), [['US Central time', 'predicted'], ['Central European time', 'predicted']]);
    // A time labeled confirmed in a region whose clock is predicted is refused.
    const s = copy(SOURCE); delete s.events[0].schedules.us.status; delete s.events[0].schedules.us.part; delete s.events[0].schedules.us.basis;
    assert.ok(validate(s, 'forever').some((x) => x.includes("server clock is predicted, so its times must be labeled predicted")));
  });

  test('missing source information is refused: no source, no quote, no check date, no server clock name, an empty place, a Repeats line out of bounds', () => {
    const refused = (mutate, part) => { const s = copy(SOURCE); mutate(s); const errors = validate(s, 'forever'); assert.ok(errors.some((e) => e.includes(part)), `${part}: ${errors.join(' | ') || 'no error'}`); };
    refused((s) => { s.events[1].sources = []; }, 'at least one source is required');
    refused((s) => { delete s.events[1].sources[0].quote; }, 'verbatim quote');
    refused((s) => { delete s.events[1].sources[0].retrieved; }, 'retrieved date');
    refused((s) => { s.events[1].sources[0].url = 'http://wago.tools/db2/Holidays?build=1.60.1.70862'; }, 'must be https');
    refused((s) => { delete s.events[1].lastVerified; }, 'lastVerified');
    refused((s) => { s.events[2].sources[0].url = 'https://wago.tools/db2/Holidays?build=12.1.5.70783'; }, 'must cite a 1.60.x build');
    refused((s) => { delete s.regions[0].serverZone.name; }, 'serverZone.name');
    refused((s) => { s.events[3].zone = ' '; }, 'zone (where it happens) is required');
    refused((s) => { delete s.events[3].zone; }, 'zone (where it happens) is required');
    refused((s) => { s.events[3].repeats = 'yearly'; }, 'repeats (how it recurs');
    // A place nobody names may be said to be unknown: null, never a guess.
    assert.equal(EV.get('midsummer-fire-festival').zone, null);
    assert.deepEqual(validate(SOURCE, 'forever'), []);
  });

  test('places come from the game\'s own calendar text: every quoted line is in the client\'s descriptions, and every word of a place is in its quote', () => {
    const descriptions = FIX.table.map((r) => r.description.replace(/\s+/g, ' '));
    for (const e of SOURCE.events) {
      const texts = e.sources.filter((s) => s.publisher.startsWith('Game calendar text'));
      assert.equal(texts.length, 1, e.id);
      for (const part of texts[0].quote.split(' / ')) assert.ok(descriptions.some((d) => d.includes(part)), `${e.id}: ${part}`);
      if (e.zone === null) continue;
      for (const word of e.zone.match(/[A-Za-z']{4,}/g)) if (!['across', 'alternates'].includes(word)) assert.ok(texts[0].quote.toLowerCase().includes(word.toLowerCase()), `${e.id}: ${word}`);
    }
  });

  // ---- Coverage and what is left out ----

  test('coverage expiry: nothing starts at or after November 8, 2027, though the client repeats the contest and the yearly holidays forever; a later window is refused', () => {
    for (const e of DATA.events) for (const r of ['us', 'eu']) {
      for (const w of windowsOf(e, r)) assert.ok(utc(w.start) < KNOWN, `${e.id} ${r} ${w.start}`);
      if (e.schedules[r]) assert.deepEqual(S.windows(e.schedules[r], KNOWN, KNOWN + 400 * DAY), [], `${e.id} ${r}`);
    }
    assert.ok(ROWS.some((x) => x.holidayId === 263 && x.wall === '2027-11-08 04:00') === false, 'the fixture stops at coverage too');
    assert.ok(TABLE.get(263).dates.length > 12 && TABLE.get(264).dates.length > 12, 'the client lists Faire dates past the coverage');
    const s = copy(SOURCE);
    s.events[1].schedules.us.windows.push({ start: '2027-11-14T20:00:00Z', end: '2027-11-14T22:00:00Z' });
    assert.ok(validate(s, 'forever').some((x) => x.includes("window starts after its category's knownUntil")));
  });

  test('no unsupported entries: only named, non-looping client rows with a length and a date in the coverage are events; the battleground rotation, unnamed rows and Noblegarden (no length) are not, and are listed as not shown', () => {
    const used = new Set(DATA.events.flatMap(clientIds));
    for (const id of used) {
      const t = TABLE.get(id);
      assert.ok(t.name && !t.looping && t.durationsH.length && t.calendarFlags.includes(3) && ['weekly', 'annual', 'dated'].includes(t.kind), `row ${id}`);
    }
    assert.deepEqual([...used].sort((a, b) => a - b), [62, 141, 263, 264, 301, 321, 324, 327, 335, 341]);
    const unused = FIX.table.filter((t) => !used.has(t.holidayId));
    const why = Object.fromEntries(unused.map((t) => [t.holidayId,
      !t.name ? 'no name' : t.looping ? 'looping' : !t.durationsH.length ? 'no length' : ROWS.some((x) => x.holidayId === t.holidayId) ? 'UNEXPLAINED' : 'no date in coverage']));
    assert.deepEqual(why, { 1: 'no name', 161: 'no name', 181: 'no length', 201: 'no date in coverage', 281: 'no name', 283: 'no date in coverage', 284: 'no date in coverage', 285: 'no date in coverage', 1840: 'looping', 1841: 'looping', 1842: 'looping', 1879: 'no name', 1896: 'no name' });
    assert.deepEqual(DATA.untracked.map((u) => u.name), ['Daily and weekly resets', 'Call to Arms battleground weeks', 'Noblegarden', 'Raids opening', 'WoW: Forever Launch Celebration', "Children's Week"]);
    assert.match(DATA.untracked.find((u) => u.name === 'Raids opening').reason, /December 9, 2026, without a time/);
  });

  test('no Retail schedule in Forever: the only Forever window that is also a Retail window is the Lunar Festival in Europe (the same client row read on the same clock); Retail-only events are absent', () => {
    const retail = new Set(RETAIL.events.flatMap((e) => Object.entries(e.schedules).flatMap(([r, s]) => (s.windows || []).map((w) => `${r} ${w.start} ${w.end}`))));
    const same = DATA.events.flatMap((e) => ['us', 'eu'].flatMap((r) => windowsOf(e, r).filter((w) => retail.has(`${r} ${w.start} ${w.end}`)).map((w) => `${e.id} ${r} ${w.start}`)));
    assert.deepEqual(same, ['lunar-festival eu 2027-02-02T09:00:00Z']);
    for (const id of ['timewalking', 'pilgrims-bounty', 'day-of-the-dead', 'wow-anniversary', 'curse-surge', 'aqir-invasion', 'world-boss-luashal', 'delves-bonus']) assert.ok(!EV.has(id), id);
    assert.ok(!DATA.categories.some((c) => ['timewalking', 'bonus', 'world-boss'].includes(c.id)));
    // And Retail's own data has none of Forever's new fields, so its page is as it was.
    assert.ok(RETAIL.events.every((e) => e.repeats === undefined && typeof e.zone === 'string' && e.zone));
  });
}
