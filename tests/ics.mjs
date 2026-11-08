// Calendar files: the writer on its own, its refusals, and the engine's real windows through it in
// both regions and across daylight saving. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ics = require('../js/ics.js');
const S = require('../js/schedule.js');
const DATA = require('../events-data.js');

const T = Date.parse('2026-11-08T17:00:00Z');
const ev = (over) => Object.assign({ uid: Ics.uid('x'), start: Date.parse('2026-11-10T15:00:00Z'), end: Date.parse('2026-11-17T14:00:00Z'), summary: 'Arena Skirmish Bonus Event' }, over);

/** Unfolds a file into content lines, checking CRLF and the 75-octet limit on the way. */
export function unfold(text) {
  assert.ok(text.endsWith('\r\n'), 'ends with CRLF');
  const physical = text.slice(0, -2).split('\r\n');
  for (const l of physical) {
    assert.ok(!l.includes('\n') && !l.includes('\r'), 'only CRLF line breaks');
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `${Buffer.byteLength(l, 'utf8')} octets: ${l}`);
  }
  const lines = [];
  for (const l of physical) if (l.startsWith(' ')) lines[lines.length - 1] += l.slice(1); else lines.push(l);
  return lines;
}
/** The events of a file as { PROP: value }. */
export function events(text) {
  const out = [];
  let cur = null;
  for (const l of unfold(text)) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') { out.push(cur); cur = null; } else if (cur) { const i = l.indexOf(':'); cur[l.slice(0, i)] = l.slice(i + 1); }
  }
  return out;
}

export function icsTests(test) {
  test('calendar times are UTC with a Z, and a time that is not a number is refused', () => {
    assert.equal(Ics.stamp(Date.parse('2026-11-10T15:00:00Z')), '20261110T150000Z');
    assert.equal(Ics.stamp(Date.parse('2027-03-14T09:05:07Z')), '20270314T090507Z');
    for (const bad of [NaN, Infinity, '2026-11-10', null, undefined]) assert.throws(() => Ics.stamp(bad), /not a time/);
  });

  test('text is escaped (backslash, semicolon, comma, newline) and control characters are dropped', () => {
    assert.equal(Ics.escapeText('a\\b;c,d\ne\r\nf\rg'), 'a\\\\b\\;c\\,d\\ne\\nf\\ng');
    assert.equal(Ics.escapeText(`x${String.fromCharCode(0)}y${String.fromCharCode(27)}z\tw`), 'xyz\tw');
    assert.equal(Ics.escapeText("Lu'ashal: 10% (WoW)"), "Lu'ashal: 10% (WoW)");
  });

  test('lines fold at 75 octets with CRLF and a space, never inside a character', () => {
    assert.equal(Ics.fold('a'.repeat(75)), 'a'.repeat(75));
    assert.equal(Ics.fold('a'.repeat(76)), `${'a'.repeat(75)}\r\n a`);
    const long = `DESCRIPTION:${'é'.repeat(40)}\u{1F409}${'x'.repeat(100)}日本`;
    const folded = Ics.fold(long);
    const parts = folded.split('\r\n');
    for (const [i, p] of parts.entries()) {
      assert.ok(Buffer.byteLength(p, 'utf8') <= 75, `part ${i}`);
      assert.equal(Buffer.from(p, 'utf8').toString('utf8'), p, 'whole characters only');
      if (i) assert.ok(p.startsWith(' '));
    }
    assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long);
  });

  test('an occurrence has one stable, opaque identifier', () => {
    const a = Ics.uid('hallows-end|us|1792429200000');
    assert.match(a, /^[0-9a-f]{16}@radmagelabs\.com$/);
    assert.equal(Ics.uid('hallows-end|us|1792429200000'), a, 'the same occurrence, the same UID');
    assert.notEqual(Ics.uid('hallows-end|eu|1792429200000'), a);
    assert.notEqual(Ics.uid('hallows-end|us|1792429200001'), a);
    assert.ok(!a.includes('hallows'), 'nothing readable in it');
  });

  test('a calendar has VERSION, PRODID and no METHOD; each event has UID, DTSTAMP, DTSTART, DTEND and SUMMARY', () => {
    const text = Ics.calendar({ name: 'WoW Tracker (Americas)', stampMs: T, events: [ev({ description: 'A; b, c', location: 'World of Warcraft: Arena Skirmishes', url: 'https://warcraft.wiki.gg/wiki/Bonus_Event', categories: ['Bonus events', 'a,b'] }), ev({ uid: Ics.uid('y'), summary: "Thorm'belan (Predicted)", tentative: true })] });
    const lines = unfold(text);
    assert.deepEqual(lines.slice(0, 5), ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${Ics.PRODID}`, 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:WoW Tracker (Americas)']);
    assert.equal(lines.at(-1), 'END:VCALENDAR');
    assert.ok(!lines.some((l) => l.startsWith('METHOD')), 'no METHOD (PUBLISH would need an ORGANIZER)');
    const [a, b] = events(text);
    assert.deepEqual([a.UID, a.DTSTAMP, a.DTSTART, a.DTEND, a.SUMMARY], [Ics.uid('x'), '20261108T170000Z', '20261110T150000Z', '20261117T140000Z', 'Arena Skirmish Bonus Event']);
    assert.deepEqual([a.DESCRIPTION, a.LOCATION, a.URL, a.CATEGORIES, a.STATUS, a.TRANSP], ['A\\; b\\, c', 'World of Warcraft: Arena Skirmishes', 'https://warcraft.wiki.gg/wiki/Bonus_Event', 'Bonus events,a\\,b', 'CONFIRMED', 'TRANSPARENT']);
    assert.deepEqual([b.SUMMARY, b.STATUS], ["Thorm'belan (Predicted)", 'TENTATIVE']);
  });

  test('malformed or incomplete events are refused, with the reason', () => {
    const make = (list) => () => Ics.calendar({ stampMs: T, events: list });
    assert.throws(make([]), /no events/);
    assert.throws(make(null), /no events/);
    assert.throws(make(Array.from({ length: Ics.MAX_EVENTS + 1 }, (_, i) => ev({ uid: Ics.uid(`n${i}`) }))), /too many events/);
    assert.throws(make([null]), /not an event/);
    assert.throws(make([ev({ uid: 'x@evil.example' })]), /bad uid/);
    assert.throws(make([ev({ uid: undefined })]), /bad uid/);
    assert.throws(make([ev({ summary: '  ' })]), /no summary/);
    assert.throws(make([ev({ start: NaN })]), /must be times/);
    assert.throws(make([ev({ end: '2026-11-17' })]), /must be times/);
    assert.throws(make([ev({ end: Date.parse('2026-11-10T15:00:00Z') })]), /ends before it starts/);
    assert.throws(make([ev({ url: 'http://warcraft.wiki.gg/' })]), /url must be https/);
    assert.throws(make([ev({ url: 'javascript:alert(1)' })]), /url must be https/);
    assert.throws(make([ev(), ev()]), /the same event twice/);
    assert.throws(() => Ics.calendar({ stampMs: NaN, events: [ev()] }), /not a time/);
  });

  test('the engine\'s real windows go through unchanged: both regions, and across daylight saving', () => {
    const write = (id, region, from, to) => {
      const e = DATA.events.find((x) => x.id === id);
      const ws = S.windows(e.schedules[region], Date.parse(from), Date.parse(to));
      const text = Ics.calendar({ stampMs: T, events: ws.map((w) => ({ uid: Ics.uid(`${id}|${region}|${w.start}`), start: w.start, end: w.end, summary: e.name })) });
      return events(text).map((x) => `${x.DTSTART} ${x.DTEND}`);
    };
    // The Faire opens at midnight Pacific: 08:00 UTC in winter (PST), 07:00 UTC in summer (PDT).
    assert.deepEqual(write('darkmoon-faire', 'us', '2027-01-01T00:00:00Z', '2027-03-31T00:00:00Z'), ['20270103T080000Z 20270110T080000Z', '20270207T080000Z 20270214T080000Z', '20270307T080000Z 20270314T080000Z']);
    assert.deepEqual(write('darkmoon-faire', 'us', '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'), ['20261004T070000Z 20261011T070000Z']);
    // European holidays: 10:00 CEST (08:00 UTC) before the October change, 10:00 CET (09:00 UTC) after.
    assert.deepEqual(write('hallows-end', 'eu', '2026-10-01T00:00:00Z', '2026-11-30T00:00:00Z'), ['20261019T080000Z 20261102T090000Z']);
    assert.deepEqual(write('feast-of-winter-veil', 'eu', '2026-12-01T00:00:00Z', '2027-01-31T00:00:00Z'), ['20261215T090000Z 20270102T090000Z']);
    // The same week in both regions, each at its own weekly reset.
    assert.deepEqual(write('arena-skirmish-bonus', 'us', '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z'), ['20261110T150000Z 20261117T140000Z']);
    assert.deepEqual(write('arena-skirmish-bonus', 'eu', '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z'), ['20261111T040000Z 20261118T030000Z']);
  });
}
