// Calendar subscription feeds (tools/feeds.mjs, written into calendar/ by tools/build-data.mjs): what each
// holds and leaves out, how it is written (CRLF, folding, escaping, UTC), that it is the same on every build,
// and what a subscriber's calendar sees when the data changes. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FEEDS, feeds, feedText, feedUid, LOOKBACK_DAYS, WORDS } from '../tools/feeds.mjs';
import { pageData } from '../tools/build-data.mjs';
import { unfold, events } from './ics.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = require('../js/schedule.js');
const Ics = require('../js/ics.js');
const CE = require('../js/calendar-entry.js');
const CONFIG = require('../js/config.js');
const SOURCES = { retail: 'events', forever: 'forever' };
const source = (ed) => JSON.parse(readFileSync(join(ROOT, 'data', `${SOURCES[ed]}.source.json`), 'utf8'));
const PAGES = { retail: pageData(source('retail')), forever: pageData(source('forever')) };
const EDITION = Object.fromEntries(CONFIG.editions.map((e) => [e.id, e]));
const committed = (f) => readFileSync(join(ROOT, f), 'utf8');
/** RFC 5545 TEXT back to plain text. */
const plain = (v) => v.replace(/\\n/g, '\n').replace(/\\([\\;,])/g, '$1');
const DAY = S.DAY;

/** The calendar-level lines of a feed (before the first event), unfolded. */
const head = (text) => { const l = unfold(text); return l.slice(0, l.indexOf('BEGIN:VEVENT')); };

export function feedTests(test) {
  test('four feeds with fixed names, one per edition and region, each current with the data and published with the site', () => {
    assert.deepEqual(FEEDS.map((f) => f.file), ['calendar/retail-americas.ics', 'calendar/retail-europe.ics', 'calendar/forever-americas.ics', 'calendar/forever-europe.ics']);
    for (const f of feeds(PAGES)) assert.equal(committed(f.file), f.text, `${f.file} is what the data makes (run node tools/build-data.mjs)`);
  });

  test('a feed is a subscription: its name, description, own canonical address and a daily refresh; no METHOD, no alarms', () => {
    for (const f of FEEDS) {
      const text = committed(f.file), h = head(text), reg = PAGES[f.edition].regions.find((r) => r.id === f.region);
      const name = Ics.escapeText(CE.calendarName(f.edition, EDITION[f.edition].short, reg.name));
      assert.deepEqual(h.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${Ics.PRODID}`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${name}`, `NAME:${name}`], f.file);
      assert.ok(h.includes('REFRESH-INTERVAL;VALUE=DURATION:P1D') && h.includes('X-PUBLISHED-TTL:P1D'), f.file);
      assert.ok(h.includes(`SOURCE;VALUE=URI:https://radmagelabs.com/wow/${f.file}`), `${f.file}: its address on the canonical host`);
      const desc = plain(h.find((l) => l.startsWith('X-WR-CALDESC:')).slice(13));
      assert.match(desc, new RegExp(`^${PAGES[f.edition].meta.game.replace(/[()]/g, '\\$&')} holidays and events for the ${reg.name} region`));
      assert.match(desc, /\(Predicted\) or \(Predicted time\) is a prediction\./);
      assert.ok(!/^METHOD|VALARM/m.test(text), f.file);
    }
    assert.equal(CE.calendarName('forever', 'WoW: Forever', 'Americas'), 'WoW Tracker, WoW: Forever (Americas)', 'the same calendar name as the downloads');
  });

  test('feed files use CRLF on every line, fold at 75 octets inside long text, and unfold to the same content', () => {
    for (const f of FEEDS) {
      const text = committed(f.file);
      assert.equal(text.replace(/\r\n/g, '').search(/[\r\n]/), -1, `${f.file}: no lone CR or LF`);
      const physical = text.slice(0, -2).split('\r\n');
      assert.ok(physical.every((l) => Buffer.byteLength(l, 'utf8') <= 75), f.file);
      assert.ok(physical.filter((l) => l.startsWith(' ')).length > 100, `${f.file}: long lines are folded`);
      const lines = unfold(text);
      assert.equal(lines.map(Ics.fold).join('\r\n') + '\r\n', text, `${f.file}: folding the unfolded lines gives the file back`);
    }
  });

  test('text is escaped and comes back word for word: each entry says exactly what the shared entry module says', () => {
    const f = FEEDS[2], data = PAGES.forever, text = committed(f.file);
    const got = events(text).filter((x) => !x['DTSTART;VALUE=DATE']);
    for (const x of got) {
      for (const k of ['SUMMARY', 'DESCRIPTION', 'LOCATION']) assert.doesNotMatch(x[k].replace(/\\[\\;,n]/g, ''), /[;,\\]/, `${k} escaped: ${x[k].slice(0, 60)}`);
    }
    const fish = data.events.find((e) => e.id === 'stranglethorn-fishing-extravaganza');
    const start = Date.parse('2026-11-15T20:00:00Z');
    const x = got.find((e) => e.DTSTART === Ics.stamp(start) && e.SUMMARY.startsWith('Stranglethorn'));
    const want = CE.entry({ event: fish, window: { start, end: start + 2 * 3600000 }, region: 'us', data, edition: 'forever', pageUrl: CONFIG.shareUrl, coverage: CE.coverageText(data.categories.find((c) => c.id === fish.category), 'us', WORDS), form: 'feed' });
    assert.deepEqual([plain(x.SUMMARY), plain(x.DESCRIPTION), plain(x.LOCATION), x.URL, x.CATEGORIES], [want.summary, want.description, want.location, want.url, want.categories[0]]);
    assert.match(plain(x.DESCRIPTION), /\nKnown through Nov 7, 2027\. After that: not known yet/, 'coverage in the same words as an English download');
    assert.match(plain(x.DESCRIPTION), /\nDetails and sources: https:\/\/radmagelabs\.com\/wow\/#forever$/);
  });

  test('only what a calendar can show honestly: every engine window of each event that is not hourly, from two weeks before the review to the end of the data, and nothing else', () => {
    for (const f of FEEDS) {
      const data = PAGES[f.edition], from = Date.parse(`${data.meta.reviewedOn}T00:00:00Z`) - LOOKBACK_DAYS * DAY, to = Date.parse(`${data.meta.coversUntil}T23:59:59Z`);
      const want = [];
      for (const e of data.events) {
        const s = e.schedules[f.region];
        if (!s || (s.type === 'every' && s.periodMin < 1440)) continue;
        for (const w of S.windows(s, from, to)) want.push(`${Ics.stamp(w.start)} ${Ics.stamp(w.end)} ${feedUid(Ics.uidInput(e.id, f.region, w.start, f.edition))}`);
      }
      const got = events(committed(f.file)).filter((x) => x.DTSTART).map((x) => `${x.DTSTART} ${x.DTEND} ${x.UID}`);
      assert.deepEqual(got.sort(), want.sort(), f.file);
      assert.ok(got.length >= 30, `${f.file}: ${got.length} entries`);
      assert.ok(!/SUMMARY:(Aqir Invasion|Curse Surge|Daily reset|Weekly reset|Trading Post)/.test(committed(f.file)), `${f.file}: no hourly event, no reset`);
    }
  });

  test('coverage: nothing past a category\'s limit in that region, even if the data had it, and a whole-day entry where each limit falls', () => {
    // A window past its category's limit, put into a copy of the data behind the data rules' back, never reaches a feed.
    const data = structuredClone(PAGES.retail);
    const tw = data.events.find((e) => e.id === 'timewalking');
    tw.schedules.us.windows.push({ start: '2026-12-08T15:00:00Z', end: '2026-12-15T14:00:00Z', name: 'Late Timewalking' });
    const text = feedText(data, EDITION.retail, 'us');
    assert.ok(!text.includes('Late Timewalking') && !text.includes('DTSTART:20261208T150000Z'), 'past the Dec 1 limit: left out');
    const markers = events(committed('calendar/retail-americas.ics')).filter((x) => x['DTSTART;VALUE=DATE']);
    assert.deepEqual(markers.map((x) => [x['DTSTART;VALUE=DATE'], x['DTEND;VALUE=DATE'], plain(x.SUMMARY)]), [
      ['20261201', '20261202', 'Not known yet from here: Timewalking, World bosses'],
      ['20270105', '20270106', 'Not known yet from here: Bonus events'],
      ['20270401', '20270402', 'Not known yet from here: Holidays, Darkmoon Faire, Small events'],
    ]);
    assert.match(plain(markers[0].DESCRIPTION), /^Timewalking: Known until Tue, Dec 1, 2026, 3:00 PM UTC\. After that: not known yet \(/);
    assert.match(plain(markers[2].DESCRIPTION), /^Holidays, Darkmoon Faire, Small events: Known through Mar 31, 2027\. After that: not known yet \([^\n]+\)\.\nThis calendar gains entries/, 'one sentence for categories that stop alike');
    // Europe's limits are its own reset's; Forever's whole year ends on one day.
    assert.deepEqual(events(committed('calendar/retail-europe.ics')).filter((x) => x['DTSTART;VALUE=DATE']).map((x) => x['DTSTART;VALUE=DATE']), ['20261202', '20270106', '20270401']);
    for (const f of FEEDS.slice(2)) assert.deepEqual(events(committed(f.file)).filter((x) => x['DTSTART;VALUE=DATE']).map((x) => x['DTSTART;VALUE=DATE']), ['20271108'], f.file);
  });

  test('predicted times say so in the title, as tentative, and first in the description; every WoW: Forever time is "Predicted time"', () => {
    for (const f of FEEDS) {
      const got = events(committed(f.file)).filter((x) => x.DTSTART);
      for (const x of got) {
        const p = / \((Predicted|Predicted time)\)$/.exec(plain(x.SUMMARY));
        assert.equal(x.STATUS, p ? 'TENTATIVE' : 'CONFIRMED', x.SUMMARY);
        assert.ok(plain(x.DESCRIPTION).startsWith(p ? `${p[1]}:` : 'Confirmed:'), x.SUMMARY);
      }
      if (f.edition === 'forever') assert.ok(got.every((x) => x.SUMMARY.endsWith(' (Predicted time)')), f.file);
    }
    const eu = events(committed('calendar/retail-europe.ics')).map((x) => plain(x.SUMMARY));
    assert.ok(eu.includes("Hallow's End (Predicted time)") && eu.includes("Lu'ashal (Predicted)") && eu.includes('Delves Bonus Event'), eu.join(' | '));
  });

  test('feed UIDs: 32 hex digits without a domain, from the downloads\' input; never a download\'s UID; one per entry; the same in every feed build', () => {
    const start = Date.parse('2026-12-06T08:00:00Z');
    assert.equal(feedUid(Ics.uidInput('darkmoon-faire', 'us', start)), feedUid(`darkmoon-faire|us|${start}`));
    assert.match(feedUid('x'), /^[0-9a-f]{32}$/);
    assert.notEqual(feedUid(Ics.uidInput('darkmoon-faire', 'us', start, 'forever')), feedUid(Ics.uidInput('darkmoon-faire', 'us', start)), 'Forever names itself, as in downloads');
    const all = FEEDS.flatMap((f) => events(committed(f.file)).map((x) => x.UID));
    assert.ok(all.every((u) => /^[0-9a-f]{32}$/.test(u)));
    assert.equal(new Set(all).size, all.length, 'no UID in two places');
    assert.ok(all.includes(feedUid(Ics.uidInput('darkmoon-faire', 'us', start))), 'the December 6 Faire');
    assert.ok(!all.includes(Ics.eventUid('darkmoon-faire', 'us', start)) && !all.some((u) => u.includes('@')), 'never a download\'s UID');
  });

  test('the same bytes on every build: no build clock, machine zone or locale; DTSTAMP is the data\'s review date', () => {
    const before = feeds(PAGES).map((f) => f.text);
    const realNow = Date.now, RealDate = Date;
    try {
      Date.now = () => realNow() + 400 * DAY;
      assert.deepEqual(feeds(PAGES).map((f) => f.text), before, 'a year later');
    } finally { Date.now = realNow; globalThis.Date = RealDate; }
    for (const f of FEEDS) {
      const stamps = new Set(events(committed(f.file)).map((x) => x.DTSTAMP));
      assert.deepEqual([...stamps], [`${PAGES[f.edition].meta.reviewedOn.replace(/-/g, '')}T000000Z`], f.file);
    }
    // Every time is UTC: no TZID, no floating time (whole-day entries aside).
    for (const f of FEEDS) for (const l of unfold(committed(f.file))) if (/^DT(START|END)[:;]/.test(l)) assert.match(l, /^DT(START|END)(:\d{8}T\d{6}Z|;VALUE=DATE:\d{8})$/, l);
  });

  test('when the data changes a subscriber\'s calendar mirrors it: a moved time is a new entry and the old one goes, new text keeps the entry, a removed event leaves, more coverage adds entries and moves the line', () => {
    const v1 = PAGES.retail, v2 = structuredClone(v1);
    v2.meta.datasetRevision = 3; v2.meta.reviewedOn = '2026-11-20';
    const wv = v2.events.find((e) => e.id === 'feast-of-winter-veil');
    wv.schedules.us.windows[0].start = '2026-12-15T19:00:00Z'; // moved an hour
    v2.events.find((e) => e.id === 'pilgrims-bounty').name = "Pilgrim's Bounty (renamed)";
    v2.events = v2.events.filter((e) => e.id !== 'lunar-festival');
    const bonus = v2.categories.find((c) => c.id === 'bonus');
    bonus.knownUntil.us = '2027-01-12T15:00:00Z';
    v2.events.find((e) => e.id === 'delves-bonus').schedules.us.windows.push({ start: '2027-01-05T15:00:00Z', end: '2027-01-12T14:00:00Z' });
    const map = (text) => new Map(events(text).map((x) => [x.UID, x]));
    const a = map(feedText(v1, EDITION.retail, 'us')), b = map(feedText(v2, EDITION.retail, 'us'));
    const only = (x, y) => [...x.keys()].filter((k) => !y.has(k));
    // A later review starts the feed two weeks before it: what ended before then leaves, and nothing else of the past.
    const start2 = Ics.stamp(Date.parse('2026-11-20T00:00:00Z') - LOOKBACK_DAYS * DAY);
    const aged = only(a, b).filter((k) => a.get(k).DTEND && a.get(k).DTEND <= start2);
    assert.ok(aged.length >= 3 && [...b.values()].every((x) => !x.DTEND || x.DTEND > start2), `${aged.length} aged out`);
    const gone = only(a, b).filter((k) => !aged.includes(k)).map((k) => plain(a.get(k).SUMMARY)), added = only(b, a).map((k) => plain(b.get(k).SUMMARY));
    assert.deepEqual(gone.sort(), ['Feast of Winter Veil', 'Lunar Festival', 'Not known yet from here: Bonus events']);
    assert.deepEqual(added.sort(), ['Delves Bonus Event', 'Feast of Winter Veil', 'Not known yet from here: Bonus events']);
    const veil = [...b.values()].find((x) => x.SUMMARY === 'Feast of Winter Veil');
    assert.equal(veil.DTSTART, '20261215T190000Z', 'the moved time');
    const pb = (m) => [...m.values()].find((x) => plain(x.SUMMARY).startsWith("Pilgrim's Bounty"));
    assert.equal(pb(a).UID, pb(b).UID, 'renamed in place, the same entry');
    assert.deepEqual([plain(pb(b).SUMMARY), pb(b).DTSTAMP], ["Pilgrim's Bounty (renamed)", '20261120T000000Z'], 'with the new title and a newer stamp');
    assert.match(plain(pb(b).DESCRIPTION), /schedule data r3, checked/);
    assert.equal([...b.values()].find((x) => plain(x.SUMMARY) === 'Not known yet from here: Bonus events')['DTSTART;VALUE=DATE'], '20270112');
    // Everything not touched keeps its UID and its times; only its stamp and revision moved on.
    const kept = [...a.keys()].filter((k) => b.has(k));
    assert.equal(kept.length, a.size - aged.length - gone.length);
    assert.ok(kept.length >= 30, `${kept.length} kept`);
    for (const k of kept) assert.deepEqual([b.get(k).DTSTART, b.get(k).DTEND], [a.get(k).DTSTART, a.get(k).DTEND], k);
  });
}
