// Share links (js/share.js), the edition a link picks (js/store.js), the Weekly overview's order
// (js/schedule.js) and the moments an open reminder list changes (js/reminders.js). Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Share = require('../js/share.js');
const Store = require('../js/store.js');
const S = require('../js/schedule.js');
const Rem = require('../js/reminders.js');
const Config = require('../js/config.js');
const DATASETS = { retail: require('../events-data.js'), forever: require('../forever-data.js') };

const utc = (iso) => Date.parse(iso);
const EDITIONS = Config.editions.map((e) => e.id);
const REGIONS = ['us', 'eu'];
const parse = (hash) => Share.parse(hash, { editions: EDITIONS, regions: REGIONS });
const ENGINE = { scheduleFor: S.scheduleFor, windows: S.windows, isFrequent: (s) => s.type === 'every' && s.periodMin < 1440 };

export function shareTests(test) {
  test('a share link names the edition, the event, the region and the start in UTC, and reads back as exactly that', () => {
    const start = utc('2026-12-06T08:00:00Z');
    const hash = Share.make({ edition: 'retail', event: 'darkmoon-faire', region: 'us', start });
    assert.equal(hash, '#retail/darkmoon-faire/us/20261206T0800Z');
    assert.deepEqual(parse(hash), { ok: true, edition: 'retail', event: 'darkmoon-faire', region: 'us', start });
    assert.deepEqual(parse('#forever/stranglethorn-fishing-extravaganza/eu/20261115T1300Z'), { ok: true, edition: 'forever', event: 'stranglethorn-fishing-extravaganza', region: 'eu', start: utc('2026-11-15T13:00:00Z') });
    // Without a start, and without a region: the event now or next, in the reader's own region.
    assert.equal(Share.make({ edition: 'forever', event: 'darkmoon-faire', region: 'eu', start: null }), '#forever/darkmoon-faire/eu');
    assert.equal(Share.make({ edition: 'forever', event: 'darkmoon-faire' }), '#forever/darkmoon-faire');
    assert.equal(Share.make({ edition: 'retail', event: 'darkmoon-faire', start }), '#retail/darkmoon-faire', 'a start means nothing without its region');
    assert.deepEqual(parse('#forever/darkmoon-faire/eu'), { ok: true, edition: 'forever', event: 'darkmoon-faire', region: 'eu', start: null });
    assert.deepEqual(parse('#retail/darkmoon-faire'), { ok: true, edition: 'retail', event: 'darkmoon-faire', region: null, start: null });
    assert.deepEqual(parse('#retail/darkmoon-faire/'), parse('#retail/darkmoon-faire'), 'one trailing slash is forgiven');
    assert.deepEqual(parse('retail/darkmoon-faire/us/20261206t0800z'), parse(hash), 'without the "#", and with the stamp in small letters');
  });

  test('every window of every event in both editions and regions makes a link that reads back to that event, region and start, in under 90 characters', () => {
    let n = 0, longest = '';
    for (const [edition, data] of Object.entries(DATASETS)) {
      for (const e of data.events) for (const r of data.regions) {
        const s = S.scheduleFor(e, r.id);
        if (!s) continue;
        // A year of windows; an event that repeats within a day is sampled over two days.
        const span = ENGINE.isFrequent(s) ? 2 * S.DAY : 400 * S.DAY;
        for (const w of S.windows(s, utc('2026-10-20T00:00:00Z'), utc('2026-10-20T00:00:00Z') + span)) {
          const hash = Share.make({ edition, event: e.id, region: r.id, start: w.start });
          assert.deepEqual(Share.parse(hash, { editions: EDITIONS, regions: data.regions.map((x) => x.id) }), { ok: true, edition, event: e.id, region: r.id, start: w.start }, hash);
          assert.match(hash, /^#[a-z]+\/[a-z0-9-]+\/[a-z]+\/\d{8}T\d{4}Z$/, 'only letters, digits, hyphens and slashes: nothing a chat app or an email would break');
          if (hash.length > longest.length) longest = hash;
          n++;
        }
      }
    }
    assert.ok(n > 300, `${n} links`);
    assert.ok(`${Config.shareUrl}${longest}`.length < 90, `${Config.shareUrl}${longest}`);
    assert.ok(longest.length < Share.MAX_CHARS);
  });

  test('a start is written to the minute, with seconds only when it has any, and only real dates and times read back', () => {
    assert.equal(Share.stamp(utc('2027-03-14T19:00:00Z')), '20270314T1900Z');
    assert.equal(Share.stamp(utc('2027-03-14T19:00:30Z')), '20270314T190030Z');
    assert.equal(Share.parseStamp('20270314T190030Z'), utc('2027-03-14T19:00:30Z'));
    assert.equal(Share.parseStamp('20270314T190000Z'), utc('2027-03-14T19:00:00Z'), 'written-out zero seconds are the same minute');
    assert.equal(Share.parseStamp('20280229T2359Z'), utc('2028-02-29T23:59:00Z'), 'a leap day');
    for (const bad of [NaN, Infinity, null, undefined, '1796544000000', 1796544000500, utc('0999-01-01T00:00:00Z'), 8.64e15 + 1]) assert.equal(Share.stamp(bad), null, String(bad));
    for (const bad of ['', '20270229T0000Z', '20271301T0000Z', '20270100T0000Z', '20270314T2400Z', '20270314T1960Z', '20270314T190060Z', '20270314T1900', '2027-03-14T19:00Z', '20270314 1900Z',
      '20270314T1900+01', '1796544000', '00270314T1900Z', '20270314T19Z', '202703141900Z', '20270314T1900ZZ', ' 20270314T1900Z']) assert.equal(Share.parseStamp(bad), null, bad);
  });

  test('what is not a share link is left alone: an empty hash, an edition alone, the skip link', () => {
    for (const hash of ['', '#', '#forever', '#retail', '#forever/', '#coming-title', '#classic', undefined, null, 7]) assert.equal(parse(hash), null, String(hash));
  });

  test('a link that does not fit is refused as a whole, with the reason: another game version, or malformed', () => {
    const refused = (hash, reason) => assert.deepEqual(parse(hash), { ok: false, reason }, hash);
    refused('#classic/darkmoon-faire/us', 'edition');
    refused('#mists/darkmoon-faire', 'edition');
    for (const hash of [
      '#retail/darkmoon-faire/kr', '#retail/darkmoon-faire/US', '#retail/darkmoon-faire/us/yesterday', '#retail/darkmoon-faire/us/20261206T0800Z/more', '#retail/darkmoon-faire/us/20261206T0800Z//',
      '#retail//us', '#retail/Darkmoon-Faire/us', '#retail/darkmoon faire/us', '#retail/darkmoon_faire', '#retail/-faire', '#retail/%E0%A4%A/us', '#retail/%3Cscript%3E/us', '#retail/../us',
      '#retail/darkmoon-faire/20261206T0800Z', '#/darkmoon-faire/us', '#Retail/darkmoon-faire/us', '#retail forever/darkmoon-faire', '#retail/darkmoon-faire/us/20260230T0800Z',
      `#retail/${'a'.repeat(65)}/us`, `#retail/darkmoon-faire/us/${'1'.repeat(200)}`,
    ]) refused(hash, 'malformed');
    assert.deepEqual(parse('#retail/darkmoon%2Dfaire/us'), { ok: true, edition: 'retail', event: 'darkmoon-faire', region: 'us', start: null }, 'an encoded hyphen is still the id');
    // The page says which editions and regions it has; with none, nothing is a usable link.
    assert.deepEqual(Share.parse('#retail/darkmoon-faire/us'), { ok: false, reason: 'edition' });
    assert.deepEqual(Share.parse('#retail/darkmoon-faire/us', { editions: ['retail'] }), { ok: false, reason: 'malformed' });
    // Reading never throws, whatever the text.
    for (const junk of ['#%', '#a/%', '#retail/%', `#${'/'.repeat(300)}`, '#retail/\u0000/us', '#__proto__/constructor/us']) assert.doesNotThrow(() => parse(junk), junk);
  });

  test('the edition a share link shows is its first part, and it is not a saved choice; "#forever" and the skip link behave as before', () => {
    assert.equal(Store.pickEdition('#forever/darkmoon-faire/eu/20261115T1300Z', 'retail', EDITIONS), 'forever');
    assert.equal(Store.pickEdition('#retail/darkmoon-faire/us', 'forever', EDITIONS), 'retail');
    assert.equal(Store.pickEdition('#classic/darkmoon-faire/us', 'forever', EDITIONS), 'forever', 'an edition this page does not have: the saved choice');
    assert.equal(Store.pickEdition('#classic/darkmoon-faire/us', null, EDITIONS), 'retail');
    assert.equal(Store.pickEdition('#/forever', null, EDITIONS), 'retail');
    assert.equal(Store.pickEdition('#forever/', null, EDITIONS), 'forever');
    assert.equal(Store.pickEdition('#forever', null, EDITIONS), 'forever');
    assert.equal(Store.pickEdition('#coming-title', 'forever', EDITIONS), 'forever');
  });

  test('share links are read and made in one place: only js/share.js knows their shape, and the page takes the address from config.js', () => {
    const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
    assert.match(app, /return PAGE_URL \+ Share\.make\(\{ edition: EDITION, event: detailsOpen\.id, region: region\(\), start: detailsOpen\.shown \}\);/);
    assert.ok(!/parseStamp|T\$\{|\\d\{8\}T/.test(app), 'the page code holds no stamp format of its own');
    // A link is never written to storage: the visit's region is a variable, and the page code has one writer of the saved region per place it is chosen.
    assert.ok(!/Store\.write\([^)]*visitRegion/.test(app));
    assert.equal([...app.matchAll(/prefs\.region = /g)].length, 2, 'the region buttons and Keep, nowhere else');
  });

  // ---- Weekly overview order ----

  const item = (id, start, end, more = {}) => ({ event: { id, name: more.eventName || id }, start: utc(start), end: utc(end), ...more });
  const FROM = utc('2026-11-10T15:00:00Z'), TO = utc('2026-11-17T15:00:00Z');
  const order = (items) => S.weekOrder(items, FROM, TO).map((i) => i.name || i.event.name);

  test('the Weekly overview lists what runs all week first, then the rest by start, and the lines of hourly events last', () => {
    const items = [
      item('surge', '2026-11-10T15:00:00Z', '2026-11-17T15:00:00Z', { repeats: true }),
      item('contest', '2026-11-15T20:00:00Z', '2026-11-15T22:00:00Z'),
      item('boss', '2026-11-10T15:00:00Z', '2026-11-17T15:00:00Z'),
      item('faire', '2026-11-01T07:00:00Z', '2026-11-12T07:00:00Z'),
      item('holiday', '2026-11-02T17:00:00Z', '2026-11-24T17:00:00Z'),
      item('bonus', '2026-11-10T15:00:00Z', '2026-11-17T14:00:00Z'),
      item('anniversary', '2026-11-16T18:00:00Z', '2026-12-07T18:00:00Z'),
    ];
    assert.deepEqual(order(items), ['holiday', 'boss', 'faire', 'bonus', 'contest', 'anniversary', 'surge']);
    // The whole-week items are exactly the ones the overview words as "all week".
    const fmt = () => 'x';
    assert.deepEqual(S.weekOrder(items, FROM, TO).filter((i) => !i.repeats).map((i) => S.weekSpanText(i, FROM, TO, 'UTC', fmt) === 'all week'), [true, true, false, false, false, false]);
    assert.equal(items[0].event.id, 'surge', 'the list given is not changed');
  });

  test('the Weekly overview breaks ties by the name shown, then by the event id, the same whatever order the items arrive in', () => {
    const a = item('zz-first-id', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { name: 'Alpha' });
    const b = item('aa-second-id', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { name: 'Beta' });
    const twin1 = item('twin-a', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { name: 'Twin' }), twin2 = item('twin-b', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { name: 'Twin' });
    const early = item('late-name', '2026-11-11T10:00:00Z', '2026-11-11T12:00:00Z', { name: 'Zulu' });
    const all = [a, b, twin1, twin2, early];
    const want = ['late-name', 'zz-first-id', 'aa-second-id', 'twin-a', 'twin-b'];
    // Every order the five can arrive in gives the same list.
    const perms = (xs) => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    for (const p of perms(all)) assert.deepEqual(S.weekOrder(p, FROM, TO).map((i) => i.event.id), want);
    // The name shown is the window's own when it has one (a Timewalking expansion), else the event's.
    const named = [item('timewalking', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { eventName: 'Timewalking', name: 'Legion Timewalking' }), item('moonkin', '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z', { eventName: 'Moonkin Festival' })];
    assert.deepEqual(order(named), ['Legion Timewalking', 'Moonkin Festival']);
    // Whole-week items and hourly lines are ordered among themselves the same way.
    const weeks = [item('b', '2026-11-03T15:00:00Z', '2026-11-24T15:00:00Z'), item('a', '2026-11-03T15:00:00Z', '2026-11-24T15:00:00Z'), item('c', '2026-11-01T15:00:00Z', '2026-11-24T15:00:00Z')];
    assert.deepEqual(order(weeks), ['c', 'a', 'b']);
    assert.deepEqual(order([item('y', '2026-11-10T15:00:00Z', '2026-11-17T15:00:00Z', { repeats: true }), item('x', '2026-11-10T15:00:00Z', '2026-11-17T15:00:00Z', { repeats: true })]), ['x', 'y']);
    assert.deepEqual(S.weekOrder([], FROM, TO), []);
  });

  test('the real weeks: in the Americas reset week of November 10, 2026 the world boss comes first and the bonus week that ends an hour early follows by start', () => {
    const data = DATASETS.retail, from = utc('2026-11-10T15:00:00Z'), to = utc('2026-11-17T15:00:00Z');
    const items = [];
    for (const e of data.events) {
      const s = S.scheduleFor(e, 'us');
      if (!s || ENGINE.isFrequent(s)) continue;
      for (const w of S.windows(s, from, to)) items.push({ event: e, start: w.start, end: w.end, name: w.name });
    }
    const sorted = S.weekOrder(items, from, to);
    const whole = sorted.filter((i) => i.start <= from && i.end >= to).length;
    assert.ok(whole >= 1 && whole < sorted.length, `${whole} of ${sorted.length} run all week`);
    assert.ok(sorted.slice(0, whole).every((i) => i.start <= from && i.end >= to) && sorted.slice(whole).every((i) => !(i.start <= from && i.end >= to)), 'whole-week items are a block at the top');
    for (let k = whole + 1; k < sorted.length; k++) assert.ok(sorted[k - 1].start <= sorted[k].start, 'the rest are in start order');
    assert.deepEqual(S.weekOrder(items.slice().reverse(), from, to), sorted, 'the same from the opposite order');
  });

  // ---- The moments an open list of upcoming reminders changes ----

  test('an open reminder list changes by time alone only when a reminder comes due or an event starts: the next such moment, never one that has come', () => {
    const ON = { on: true, lead: 15, notify: false, hourly: false };
    const up = (iso, over = {}) => Rem.upcoming(Object.assign({ events: DATASETS.retail.events, region: 'us', now: utc(iso), settings: ON, leads: {}, starred: ['timewalking', 'world-boss-predaxas', 'darkmoon-faire'], hidden: [], engine: ENGINE }, over));
    const next = (iso, over) => new Date(Rem.nextChange(up(iso, over), utc(iso))).toISOString();
    // Predaxas and Legion Timewalking start 2026-11-17 15:00 UTC; Predaxas has a lead of 60 minutes, Timewalking the setting's 15.
    const own = { leads: { 'world-boss-predaxas': 60 } };
    assert.equal(next('2026-11-17T13:00:00Z', own), '2026-11-17T14:00:00.000Z', 'the first reminder to come due');
    assert.equal(next('2026-11-17T13:59:59.999Z', own), '2026-11-17T14:00:00.000Z');
    assert.equal(next('2026-11-17T14:00:00Z', own), '2026-11-17T14:45:00.000Z', 'at its own moment it has come: the next one is the other reminder');
    assert.equal(next('2026-11-17T14:45:00Z', own), '2026-11-17T15:00:00.000Z', 'both due: the next change is the start');
    assert.equal(next('2026-11-17T14:59:59.999Z', own), '2026-11-17T15:00:00.000Z');
    assert.equal(next('2026-11-17T15:00:00Z', own), '2026-12-06T07:45:00.000Z', 'started: the rows moved on, and the next change is the next reminder (the Faire of December 6)');
    // Whatever the state, the moments are the same: a list that says "off" still follows the clock.
    assert.equal(next('2026-11-17T13:00:00Z', { ...own, settings: { ...ON, on: false } }), '2026-11-17T14:00:00.000Z');
    // Each change it names really is one: just before it the list reads one way, at it another.
    for (const at of ['2026-11-17T13:00:00Z', '2026-11-17T14:00:00Z', '2026-11-17T14:45:00Z']) {
      const t = Rem.nextChange(up(at, own), utc(at)), brief = (ms) => JSON.stringify(up(new Date(ms).toISOString(), own).map((r) => [r.event.id, r.state, r.start]));
      assert.equal(brief(utc(at)), brief(t - 1), `nothing changes between ${at} and the moment named`);
      assert.notEqual(brief(t - 1), brief(t), `something changes at the moment named after ${at}`);
    }
    // Nothing scheduled, nothing starred, nothing at all: no moment to wait for.
    assert.equal(Rem.nextChange(up('2027-06-01T00:00:00Z', { starred: ['wow-anniversary'] }), utc('2027-06-01T00:00:00Z')), Infinity);
    assert.equal(Rem.nextChange([], 0), Infinity);
    assert.equal(Rem.nextChange(null, 0), Infinity);
    assert.equal(Rem.nextChange([{ trigger: 5, start: 10 }, { trigger: null, start: null }, { trigger: 7, start: 8 }], 5), 7);
  });
}
