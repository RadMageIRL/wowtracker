// The schedule comparison tool (tools/calendar): reading client tables, expanding rows on each region's
// clock, comparing builds, comparing with the published data, and the report. Synthetic rows (ids from 9000,
// made-up names) test each rule; the committed fixtures test it on the real data of both editions, against the
// independent Python decoder's windows. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HEADERS, parseCsv, pack, unpack, kindOf, describeDate, regionsOf, snapshotFromCsv, asSnapshot, occurrences, zonesFor,
  diffRows, diffOccurrences, impact, compare, crossCheck, citedRows, PAIR_WITHIN_MS, sha256,
} from '../tools/calendar/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const utc = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const HOUR = 3600000, DAY = 86400000;

const row = (id, o = {}) => ({ holidayId: id, name: o.name ?? `Test Festival ${id}`, regionMask: o.mask ?? 0, looping: Boolean(o.looping), durationsH: o.dur ?? [24], dates: o.dates, flags: 1, calendarFilterType: 3, calendarFlags: [3], descriptionId: 0, descriptionSha256: null });
const snap = (rows, product = 'wowf') => asSnapshot({ product, build: '9.9.9.1', table: rows });
const SUNDAY_14 = pack({ wd: 0, h: 14 });
/** A WoW: Forever-like source: Central and Central European clocks, both predicted; events given. */
const source = (events, known = '2028-01-01T00:00:00Z', edition = 'forever') => ({
  meta: { edition: edition === 'forever' ? 'forever' : undefined, game: 'Test game', datasetRevision: 1, reviewedOn: '2026-11-01', clientBuild: '9.9.9.1', coversUntil: '2027-12-31' },
  regions: [{ id: 'us', name: 'Americas', serverZone: { zone: 'America/Chicago', name: 'US Central time', status: 'predicted' } }, { id: 'eu', name: 'Europe', serverZone: { zone: 'Europe/Paris', name: 'Central European time', status: 'predicted' } }],
  categories: [{ id: 'holiday', name: 'Holidays', knownUntil: { us: known, eu: known } }],
  events,
});
const event = (id, rows, schedules, extra = {}) => ({ id: `ev-${id}`, name: `Test event ${id}`, category: 'holiday', status: 'confirmed', lastVerified: '2026-11-01',
  sources: rows.length ? [{ kind: 'client', publisher: 'Game calendar data (9.9.9.1)', url: 'https://example.com/', quote: rows.map((r) => `ID ${r}, Region 0, Duration 24 h, Date 1`).join('; ') }] : [{ kind: 'guide', publisher: 'A guide', url: 'https://example.com/g', quote: 'x' }],
  schedules, ...extra });
const dates = (...ws) => ({ type: 'dates', windows: ws.map(([s, e]) => ({ start: s, end: e })), status: 'predicted', part: 'time', basis: 'test' });
const FZ = zonesFor(source([]));

/** One Holidays CSV line from a few fields; every other column 0. */
function holidaysCsv(rows) {
  const lines = [HEADERS.holidays.join(',')];
  for (const r of rows) lines.push(HEADERS.holidays.map((h) => (r[h] ?? '0')).join(','));
  return lines.join('\n') + '\n';
}

export function calendarTests(test) {
  // ---- Reading the tables ----

  test('calendar tool: CSV fields with commas, doubled quotes, CRLF inside quotes, a byte order mark; a short line or an open quote is refused', () => {
    const t = parseCsv('﻿ID,Name_lang\n1,"A, ""quoted"" name\r\nsecond line"\r\n2,B\n');
    assert.deepEqual(t.header, ['ID', 'Name_lang']);
    assert.deepEqual(t.rows, [{ ID: '1', Name_lang: 'A, "quoted" name\r\nsecond line' }, { ID: '2', Name_lang: 'B' }]);
    assert.throws(() => parseCsv('ID,Name_lang\n1\n'), /1 fields, the header 2/);
    assert.throws(() => parseCsv('ID,Name_lang\n1,"open\n'), /inside a quoted field/);
  });

  test('calendar tool: packed dates decode and say what they mean: a weekday every week, every day, every year, one date', () => {
    for (const p of [{ mi: 1, h: 4, wd: 1, d: 9, mo: 11, y: 26 }, { mi: 0, h: 14, wd: 0, d: 64, mo: 16, y: 31 }, { mi: 59, h: 23, wd: 7, d: 31, mo: 12, y: 30 }]) assert.deepEqual(unpack(pack(p)), p);
    assert.equal(describeDate(SUNDAY_14), 'every Sunday 14:00');
    assert.equal(describeDate(pack({ h: 8 })), 'every day 08:00');
    assert.equal(describeDate(pack({ mo: 12, d: 15, h: 6 })), 'every year Dec 15 06:00');
    assert.equal(describeDate(pack({ y: 27, mo: 2, d: 2, h: 10, wd: 2 })), '2027-02-02 10:00');
    assert.equal(describeDate(536855424), 'every Sunday 14:00', 'the fishing contest row as the client has it');
    const k = (o) => kindOf({ looping: false, ...o });
    assert.deepEqual([k({ dates: [] }), k({ dates: [pack({ y: 26, mo: 4, d: 21 })], looping: true }), k({ dates: [pack({ h: 8 })] }), k({ dates: [SUNDAY_14] }), k({ dates: [pack({ mo: 6, d: 21 })] }), k({ dates: [pack({ y: 27, mo: 3, d: 29 })] })],
      ['none', 'looping', 'daily', 'weekly', 'annual', 'dated']);
  });

  test('calendar tool: region masks: 0 is both regions, bit 1 the Americas, bit 4 Europe, other bits are regions not tracked', () => {
    assert.deepEqual([0, 1, 4, 961, 1999, 2, 8].map(regionsOf), [['us', 'eu'], ['us'], ['eu'], ['us'], ['us', 'eu'], [], []]);
  });

  test('calendar tool: a snapshot from the three CSVs keeps rows sorted, durations and dates without zeros, and the description only as its fingerprint', () => {
    const text = 'A test festival.\r\nWith a second line, and "quotes".';
    const s = snapshotFromCsv({
      holidays: holidaysCsv([{ ID: 9002, Region: 4, Looping: 0, HolidayNameID: 2, HolidayDescriptionID: 7, Duration_0: 168, Date_0: SUNDAY_14 }, { ID: 9001, Region: 0, HolidayNameID: 1, Duration_0: 48, Duration_1: 168, Date_0: pack({ mo: 12, d: 15, h: 6 }), Date_1: pack({ y: 27, mo: 1, d: 4, h: 4 }), CalendarFlags_0: 3 }]),
      names: 'ID,Name_lang\n1,Test Festival\n2,"Test, Contest"\n', descriptions: `ID,Description_lang\n7,"${text.replace(/"/g, '""')}"\n`, product: 'wowf', build: '9.9.9.1',
    });
    assert.deepEqual(s.table.map((r) => [r.holidayId, r.name, r.kind, r.regionMask, r.durationsH, r.dates.length, r.calendarFlags]),
      [[9001, 'Test Festival', 'annual', 0, [48, 168], 2, [3]], [9002, 'Test, Contest', 'weekly', 4, [168], 1, []]]);
    assert.equal(s.table[1].descriptionSha256, createHash('sha256').update(text, 'utf8').digest('hex'));
    assert.equal(s.table[0].descriptionSha256, null);
    assert.ok(!JSON.stringify(s).includes('second line'), 'no description text in a snapshot');
    assert.equal(s.edition, 'forever');
  });

  test('calendar tool: a table whose columns changed, or an unknown product, is refused rather than read', () => {
    const ok = { holidays: holidaysCsv([]), names: 'ID,Name_lang\n', descriptions: 'ID,Description_lang\n', product: 'wow', build: '1' };
    assert.doesNotThrow(() => snapshotFromCsv(ok));
    assert.throws(() => snapshotFromCsv({ ...ok, holidays: ok.holidays.replace('Looping', 'Loop') }), /holidays table's columns changed/);
    assert.throws(() => snapshotFromCsv({ ...ok, names: 'ID,Name_lang,Extra\n' }), /names table's columns changed/);
    assert.throws(() => snapshotFromCsv({ ...ok, product: 'wowz' }), /unknown product/);
    assert.throws(() => asSnapshot({ product: 'wowf' }), /no table/);
  });

  // ---- Expanding rows ----

  test('calendar tool: a weekly row runs on each region\'s own clock across both daylight-saving changes (US March 14, EU March 28, 2027)', () => {
    const o = occurrences(snap([row(9001, { dates: [SUNDAY_14], dur: [2] })]), FZ, utc('2027-03-07T00:00:00Z'), utc('2027-04-05T00:00:00Z'));
    const at = (r) => o.filter((x) => x.region === r).map((x) => iso(x.start));
    assert.deepEqual(at('us'), ['2027-03-07T20:00:00Z', '2027-03-14T19:00:00Z', '2027-03-21T19:00:00Z', '2027-03-28T19:00:00Z', '2027-04-04T19:00:00Z']);
    assert.deepEqual(at('eu'), ['2027-03-07T13:00:00Z', '2027-03-14T13:00:00Z', '2027-03-21T13:00:00Z', '2027-03-28T12:00:00Z', '2027-04-04T12:00:00Z']);
    assert.ok(o.every((x) => x.end - x.start === 2 * HOUR && x.wall.endsWith(' 14:00')));
  });

  test('calendar tool: every-year rows repeat each year (Feb 29 only in leap years), dated rows only once, daily rows every day; masks pick the regions', () => {
    const s = snap([
      row(9001, { dates: [pack({ mo: 12, d: 15, h: 6 })], dur: [432] }), row(9002, { dates: [pack({ mo: 2, d: 29, h: 6 })] }),
      row(9003, { dates: [pack({ y: 27, mo: 2, d: 2, h: 10, wd: 2 })], mask: 1 }), row(9004, { dates: [pack({ h: 8 })], dur: [12], mask: 4 }),
    ]);
    const o = occurrences(s, FZ, utc('2026-01-01T00:00:00Z'), utc('2029-01-01T00:00:00Z'));
    const of = (id, r) => o.filter((x) => x.holidayId === id && x.region === r).map((x) => x.wall);
    assert.deepEqual(of(9001, 'us'), ['2026-12-15 06:00', '2027-12-15 06:00', '2028-12-15 06:00']);
    assert.deepEqual(of(9002, 'eu'), ['2028-02-29 06:00']);
    assert.deepEqual([of(9003, 'us'), of(9003, 'eu')], [['2027-02-02 10:00'], []]);
    assert.equal(of(9004, 'eu').length, 1096);
    assert.equal(of(9004, 'us').length, 0);
  });

  test('calendar tool: several durations are phases one after another (the Darkmoon Faire\'s 48 h, then its 168 h); no duration means no end', () => {
    const o = occurrences(snap([row(9001, { dates: [pack({ y: 26, mo: 10, d: 2 })], dur: [48, 168], mask: 1 }), row(9002, { dates: [pack({ y: 27, mo: 3, d: 29, h: 10 })], dur: [], mask: 1 })], 'wow'),
      zonesFor(source([], undefined, 'retail')), utc('2026-01-01T00:00:00Z'), utc('2028-01-01T00:00:00Z'));
    const f = o.find((x) => x.holidayId === 9001);
    assert.deepEqual([iso(f.start), iso(f.end), f.phases.map(([a, b]) => [iso(a), iso(b)])],
      ['2026-10-02T07:00:00Z', '2026-10-11T07:00:00Z', [['2026-10-02T07:00:00Z', '2026-10-04T07:00:00Z'], ['2026-10-04T07:00:00Z', '2026-10-11T07:00:00Z']]]);
    const n = o.find((x) => x.holidayId === 9002);
    assert.deepEqual([n.end, n.phases], [null, []]);
  });

  test('calendar tool: looping rows (an unverified reading) are left out unless asked for; then on for the first duration, again every sum of durations', () => {
    const s = snap([row(1842, { looping: true, dates: [pack({ y: 26, mo: 5, d: 5, h: 8, wd: 2 })], dur: [168, 336] })]);
    assert.deepEqual(occurrences(s, FZ, utc('2026-11-01T00:00:00Z'), utc('2026-12-01T00:00:00Z')), []);
    const o = occurrences(s, FZ, utc('2026-11-01T00:00:00Z'), utc('2026-12-15T00:00:00Z'), { looping: true }).filter((x) => x.region === 'us');
    assert.deepEqual(o.map((x) => [iso(x.start), (x.end - x.start) / HOUR]), [['2026-11-10T13:00:00Z', 168], ['2026-12-01T13:00:00Z', 168]]);
  });

  // ---- Two builds ----

  test('calendar tool: rows added, removed, renamed, re-timed and re-dated are each reported; a new row with an old row\'s name replaces it', () => {
    const a = snap([row(9001, { name: 'Old Name', dates: [pack({ y: 27, mo: 1, d: 4 }), pack({ y: 27, mo: 2, d: 8 })] }), row(9002, { name: 'Contest', dates: [SUNDAY_14] }), row(9005, { dates: [SUNDAY_14] })]);
    const b = snap([row(9001, { name: 'New Name', dur: [48], dates: [pack({ y: 27, mo: 1, d: 4 }), pack({ y: 27, mo: 3, d: 8 })] }), row(9003, { name: 'Contest', dates: [SUNDAY_14] }), row(9005, { dates: [SUNDAY_14] })]);
    const d = diffRows(a, b);
    assert.deepEqual([d.added.map((r) => r.holidayId), d.removed.map((r) => r.holidayId), d.replaced], [[9003], [9002], [{ from: 9002, to: 9003, name: 'Contest' }]]);
    assert.equal(d.changed.length, 1);
    const c = d.changed[0];
    assert.deepEqual([c.holidayId, c.oldName, c.name, c.fields.map((f) => f.field), c.datesAdded, c.datesRemoved], [9001, 'Old Name', 'New Name', ['name', 'durationsH'], ['2027-03-08 00:00'], ['2027-02-08 00:00']]);
    assert.deepEqual(diffRows(a, a), { added: [], removed: [], changed: [], replaced: [] });
  });

  test(`calendar tool: an occurrence that moves up to ${PAIR_WITHIN_MS / DAY} days is "moved", the nearest pairs first; further is a removal and an addition; the same start with a new end is a new length`, () => {
    const one = (start, end) => ({ region: 'us', holidayId: 9001, name: 'T', start: utc(start), end: utc(end) });
    const d1 = diffOccurrences([one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z')], [one('2027-01-18T00:00:00Z', '2027-01-19T00:00:00Z')]);
    assert.deepEqual([d1.moved.length, d1.added.length, d1.removed.length], [1, 0, 0], 'exactly 14 days still pairs');
    const d2 = diffOccurrences([one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z')], [one('2027-01-18T01:00:00Z', '2027-01-19T01:00:00Z')]);
    assert.deepEqual([d2.moved.length, d2.added.length, d2.removed.length], [0, 1, 1], 'an hour more does not');
    const d3 = diffOccurrences([one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z'), one('2027-01-11T00:00:00Z', '2027-01-12T00:00:00Z')],
      [one('2027-01-05T00:00:00Z', '2027-01-06T00:00:00Z'), one('2027-01-12T00:00:00Z', '2027-01-13T00:00:00Z')]);
    assert.deepEqual(d3.moved.map((m) => [iso(m.old[0]), iso(m.new[0])]), [['2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z'], ['2027-01-11T00:00:00Z', '2027-01-12T00:00:00Z']]);
    const d4 = diffOccurrences([one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z')], [one('2027-01-04T00:00:00Z', '2027-01-06T00:00:00Z'), one('2027-02-01T00:00:00Z', '2027-02-02T00:00:00Z')]);
    assert.deepEqual([d4.resized.length, d4.moved.length, d4.added.length, d4.unchanged], [1, 0, 1, 0]);
    assert.equal(diffOccurrences([one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z')], [one('2027-01-04T00:00:00Z', '2027-01-05T00:00:00Z')]).unchanged, 1);
  });

  // ---- The published data ----

  test('calendar tool: published windows are matched to the rows their sources cite, whole or as one phase; a window an hour off is reported both ways', () => {
    const s = snap([row(9001, { dates: [pack({ y: 27, mo: 1, d: 4, h: 4, wd: 1 })], dur: [168] }), row(9002, { dates: [pack({ y: 27, mo: 2, d: 5 })], dur: [48, 168] })]);
    const ok = source([event(1, [9001], { us: dates(['2027-01-04T10:00:00Z', '2027-01-11T10:00:00Z']), eu: dates(['2027-01-04T03:00:00Z', '2027-01-11T03:00:00Z']) }),
      event(2, [9002], { us: dates(['2027-02-07T06:00:00Z', '2027-02-14T06:00:00Z']), eu: dates(['2027-02-06T23:00:00Z', '2027-02-13T23:00:00Z']) })]);
    const i = impact(s, ok, utc('2026-12-01T00:00:00Z'));
    assert.deepEqual(i.events.map((e) => [e.regions.us.result, e.regions.eu.result, e.regions.us.phases]), [['matches', 'matches', []], ['matches', 'matches', [2]]]);
    const off = source([event(1, [9001], { us: dates(['2027-01-04T11:00:00Z', '2027-01-11T11:00:00Z']), eu: dates(['2027-01-04T03:00:00Z', '2027-01-11T03:00:00Z']) })]);
    const u = impact(s, off, utc('2026-12-01T00:00:00Z')).events[0].regions.us;
    assert.deepEqual([u.result, u.notInClient.map((w) => iso(w.start)), u.notPublished.map((o) => iso(o.start))], ['differs', ['2027-01-04T11:00:00Z'], ['2027-01-04T10:00:00Z']]);
    assert.equal(compare({ newSnap: s, source: off, fromMs: utc('2026-12-01T00:00:00Z'), untilMs: utc('2028-01-01T00:00:00Z') }).code, 1);
  });

  test('calendar tool: coverage per event: a yearly row "repeats with no end", a dated row names its last date, otherwise "nothing later"; confidence in the data\'s words', () => {
    const s = snap([row(9001, { dates: [pack({ mo: 12, d: 15, h: 6 })], dur: [432] }), row(9002, { dates: [pack({ y: 27, mo: 1, d: 4 }), pack({ y: 28, mo: 3, d: 6 })] }), row(9003, { dates: [pack({ y: 27, mo: 1, d: 5 })] })]);
    const known = '2027-06-01T00:00:00Z';
    const ev = [9001, 9002, 9003].map((id, k) => event(k, [id], { us: { type: 'dates', windows: occurrences(s, FZ, utc('2026-11-01T00:00:00Z'), utc(known)).filter((o) => o.holidayId === id && o.region === 'us').map((o) => ({ start: iso(o.start), end: iso(o.end) })) }, eu: null }));
    const i = impact(s, source(ev, known), utc('2026-11-01T00:00:00Z'));
    assert.deepEqual(i.events.map((e) => [e.regions.us.result, e.regions.us.clientAfterKnown, e.regions.us.confidence]),
      [['matches', 'repeats with no end', 'Confirmed'], ['matches', 'to 2028-03-06 06:00Z', 'Confirmed'], ['matches', 'nothing later', 'Confirmed']]);
    assert.equal(i.events[0].regions.eu.result, 'differs', 'Europe publishes nothing while the row covers it');
  });

  test('calendar tool: an event with no client rows says so; a cited row missing from the build and rows no event cites are listed', () => {
    const s = snap([row(9001, { dates: [SUNDAY_14], dur: [2] }), row(9009, { name: '', dates: [pack({ h: 8 })], dur: [12] })]);
    const i = impact(s, source([event(1, [], { us: null, eu: null }), event(2, [9001, 9004], { us: null, eu: null })]), utc('2027-01-01T00:00:00Z'));
    assert.deepEqual([i.events[0].regions.us.result, i.events[1].missingRows], ['no client rows', [9004]]);
    assert.deepEqual(i.uncited.map((u) => [u.holidayId, u.kind, u.inRange]), [[9009, 'daily', ['us', 'eu']]]);
    assert.deepEqual(citedRows({ sources: [{ kind: 'client', quote: 'ID 141, Region 0; ID 263 and ID 264' }, { kind: 'guide', quote: 'ID 9' }] }), [141, 263, 264]);
  });

  test('calendar tool: the report changes nothing, names each region\'s clock and its status, and is the same bytes every time; another edition\'s build is refused', () => {
    const s = snap([row(9001, { dates: [SUNDAY_14], dur: [2] })]);
    const ws = occurrences(s, FZ, utc('2027-01-01T00:00:00Z'), utc('2027-02-01T00:00:00Z'));
    const src = source([event(1, [9001], { us: dates(...ws.filter((o) => o.region === 'us').map((o) => [iso(o.start), iso(o.end)])), eu: dates(...ws.filter((o) => o.region === 'eu').map((o) => [iso(o.start), iso(o.end)])) })], '2027-02-01T00:00:00Z');
    const args = { oldSnap: s, newSnap: s, source: src, fromMs: utc('2027-01-01T00:00:00Z'), untilMs: utc('2027-03-01T00:00:00Z') };
    const r = compare(args), again = compare(args);
    assert.equal(r.code, 0);
    assert.equal(r.markdown, again.markdown);
    assert.equal(JSON.stringify(r.json), JSON.stringify(again.json));
    assert.match(r.markdown, /^This report changes nothing\./m);
    assert.match(r.markdown, /- Americas: US Central time \(America\/Chicago\), predicted/);
    assert.match(r.markdown, /never an instant on a clock that is not known/);
    assert.match(r.markdown, /\| Test event 1 \| 9001 \| us \| Predicted time \| 5 \| matches \|/);
    assert.match(r.markdown, /Result: nothing published is affected\. Nothing was changed\.$/m);
    const moved = snap([row(9001, { dates: [pack({ wd: 0, h: 15 })], dur: [2] })]);
    const m = compare({ ...args, newSnap: moved });
    assert.equal(m.code, 1);
    assert.match(m.markdown, /- moved us 9001 "Test Festival 9001": 2027-01-03 20:00Z to 2027-01-03 21:00Z \(\+1 h\)/);
    // A new build that touches nothing published still asks for a look: here, a row no event cites yet.
    const grown = compare({ ...args, newSnap: snap([row(9001, { dates: [SUNDAY_14], dur: [2] }), row(9002, { name: 'Brand New Row', dates: [pack({ y: 27, mo: 6, d: 1 })] })]) });
    assert.deepEqual([grown.code, grown.json.impact.events[0].regions.us.result], [1, 'matches']);
    assert.match(grown.markdown, /- added 9002 "Brand New Row" dated, 24 h, 2027-06-01 00:00/);
    assert.match(grown.markdown, /Result: something to review\. Nothing was changed\.$/m);
    assert.throws(() => compare({ ...args, newSnap: snap([row(9001, { dates: [SUNDAY_14] })], 'wow') }), /the snapshot is wow \(retail\), the data is forever/);
    const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    assert.ok(!dashes.test(r.markdown + m.markdown), 'no em or en dashes in a report');
  });

  // ---- The real data of both editions ----

  for (const [label, fixture, data, agree] of [
    ['WoW: Forever 1.60.1.70862', 'tests/fixtures/client-calendar-forever-1.60.1.json', 'data/forever.source.json', 145],
    ['Retail 12.1.5.70783', 'tests/fixtures/client-calendar-12.1.5.json', 'data/events.source.json', 68],
  ]) {
    test(`calendar tool on the real ${label} data: it agrees with the independent decoder's ${agree} windows, and every published window matches its client rows`, () => {
      const fix = json(fixture), src = json(data), s = asSnapshot(fix);
      const from = Math.min(...src.events.flatMap((e) => Object.values(e.schedules).filter((x) => x && x.type === 'dates').flatMap((x) => x.windows.map((w) => utc(w.start)))));
      const r = compare({ newSnap: s, source: src, fromMs: from, untilMs: utc('2028-12-01T00:00:00Z'), crossCheckFixture: fix });
      assert.deepEqual([r.json.crossCheck.agree, r.json.crossCheck.onlyTool, r.json.crossCheck.onlyFixture], [agree, [], []]);
      assert.equal(r.code, 0, r.markdown);
      const cited = r.json.impact.events.filter((e) => e.rows.length);
      assert.ok(cited.length === src.events.filter((e) => citedRows(e).length).length && cited.length >= 9);
      for (const e of cited) for (const reg of ['us', 'eu']) assert.equal(e.regions[reg].result, 'matches', `${e.id} ${reg}`);
      if (fix.product === 'wow') assert.deepEqual(r.json.impact.events.find((e) => e.id === 'darkmoon-faire').regions.us.phases, [2], 'the Faire is the row\'s second phase');
    });
  }

  test('calendar tool on real data: the 12.1.7 test realm\'s Battleground week (15:00 UTC in the Americas, an hour before the live row) is reported as a date change against the published week', () => {
    const fix = json('tests/fixtures/client-calendar-12.1.5.json'), src = json('data/events.source.json');
    const ptr = asSnapshot({ ...fix, table: fix.table.map((r) => (r.holidayId === 563 ? { ...r, dates: r.dates.map((v) => (describeDate(v) === '2026-12-01 08:00' ? pack({ ...unpack(v), h: 7 }) : v)) } : r)) });
    const r = compare({ oldSnap: asSnapshot(fix), newSnap: ptr, source: src, fromMs: utc('2026-11-01T00:00:00Z'), untilMs: utc('2027-04-01T00:00:00Z') });
    assert.equal(r.code, 1);
    assert.deepEqual(r.json.rows.changed.map((c) => [c.holidayId, c.datesAdded, c.datesRemoved]), [[563, ['2026-12-01 07:00'], ['2026-12-01 08:00']]]);
    assert.deepEqual(r.json.occurrences.moved.map((m) => [m.region, iso(m.old[0]), iso(m.new[0])]), [['us', '2026-12-01T16:00:00Z', '2026-12-01T15:00:00Z']]);
    const bg = r.json.impact.events.find((e) => e.id === 'battleground-bonus').regions.us;
    assert.deepEqual([bg.result, bg.confidence, bg.notInClient.map((w) => iso(w.start)), bg.notPublished.map((o) => iso(o.start))], ['differs', 'Predicted time', ['2026-12-01T16:00:00Z'], ['2026-12-01T15:00:00Z']]);
  });

  // ---- The command line ----

  test('calendar tool from the command line: extract gives the same snapshot twice and refuses a file the manifest did not record; compare writes its report, exits 0, 1 or 2, and leaves data/ untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wowtracker-calendar-'));
    try {
      const csv = { 'Holidays.csv': holidaysCsv([{ ID: 9001, HolidayNameID: 1, Duration_0: 2, Date_0: SUNDAY_14 }]), 'HolidayNames.csv': 'ID,Name_lang\n1,Test Contest\n', 'HolidayDescriptions.csv': 'ID,Description_lang\n' };
      for (const [n, t] of Object.entries(csv)) writeFileSync(join(dir, n), t);
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ product: 'wowf', build: '9.9.9.1', retrieved: '2026-11-09T00:00:00Z', files: Object.entries(csv).map(([name, t]) => ({ name, sha256: sha256(t) })) }));
      const node = (...a) => spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });
      const x1 = node('tools/calendar/extract.mjs', dir, '--out', join(dir, 'a.json')), x2 = node('tools/calendar/extract.mjs', dir, '--out', join(dir, 'b.json'));
      assert.deepEqual([x1.status, x2.status], [0, 0], x1.stderr);
      assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), readFileSync(join(dir, 'b.json'), 'utf8'));
      writeFileSync(join(dir, 'HolidayNames.csv'), 'ID,Name_lang\n1,Changed\n');
      const x3 = node('tools/calendar/extract.mjs', dir, '--out', join(dir, 'c.json'));
      assert.equal(x3.status, 2);
      assert.match(x3.stderr, /HolidayNames\.csv is not the file the manifest recorded/);

      const before = ['data/forever.source.json', 'data/events.source.json'].map((p) => sha256(read(p)));
      const ok = node('tools/calendar/compare.mjs', '--quiet', '--new', 'tests/fixtures/client-calendar-forever-1.60.1.json', '--data', 'data/forever.source.json', '--cross-check', 'tests/fixtures/client-calendar-forever-1.60.1.json', '--out', join(dir, 'report'));
      assert.equal(ok.status, 0, ok.stderr + ok.stdout);
      assert.ok(existsSync(join(dir, 'report.md')) && JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).result === 'unaffected');
      const review = node('tools/calendar/compare.mjs', '--quiet', '--new', join(dir, 'a.json'), '--data', 'data/forever.source.json', '--out', join(dir, 'review'));
      assert.equal(review.status, 1, review.stderr);
      const wrong = node('tools/calendar/compare.mjs', '--quiet', '--new', 'tests/fixtures/client-calendar-12.1.5.json', '--data', 'data/forever.source.json', '--out', join(dir, 'wrong'));
      assert.equal(wrong.status, 2);
      assert.match(wrong.stderr, /^Refused: the snapshot is wow \(retail\), the data is forever/);
      assert.deepEqual(['data/forever.source.json', 'data/events.source.json'].map((p) => sha256(read(p))), before, 'data/ is never written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('calendar tool: the logic reads no files and makes no requests; only fetch.mjs reaches the network, and it saves game data under local/ only', () => {
    const lib = read('tools/calendar/lib.mjs');
    assert.deepEqual([...lib.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['node:crypto', 'node:module']);
    assert.ok(!/\bfetch\(|writeFileSync|readFileSync/.test(lib));
    for (const f of ['extract.mjs', 'compare.mjs']) assert.ok(!/\bfetch\(/.test(read(`tools/calendar/${f}`)), f);
    assert.match(read('tools/calendar/fetch.mjs'), /const OUT = opt\('out'\) \|\| join\(ROOT, 'local', 'calendar'\);/, 'downloads go under local/');
  });
}
