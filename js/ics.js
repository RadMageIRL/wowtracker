// Calendar files (.ics, RFC 5545) made in the browser. This file only writes them: the windows come
// from the schedule engine, already as UTC instants for the chosen region, and nothing here repeats or
// recomputes a schedule. Times are written in UTC ("Z"), so daylight saving never enters the file and
// every calendar shows them in its own zone. Pure, so the page and the Node tests share it.
(function (root) {
  'use strict';

  const PRODID = '-//RadMage Labs//WoW Tracker//EN';
  /** More events than this in one file is a mistake somewhere (Google Calendar takes files up to 1 MB). */
  const MAX_EVENTS = 500;
  const CONTROL = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]', 'g');

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /** 2026-11-10T15:00:00Z as 20261110T150000Z. */
  function stamp(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new Error(`not a time: ${ms}`);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  /** TEXT values: backslash, semicolon, comma and newline escaped; other control characters dropped. */
  function escapeText(value) {
    return String(value).replace(/\r\n?/g, '\n').replace(CONTROL, '')
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /** One content line folded at 75 octets (CRLF and a space), never inside a character. */
  function fold(line) {
    const out = [];
    let cur = '', octets = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0), n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      // The first line holds 75 octets; each folded line starts with a space, so it holds 74 more.
      if (octets + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; octets = 0; }
      cur += ch;
      octets += n;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  /** A stable, opaque identifier from a key (event, region, start): the same occurrence, the same UID. */
  function uid(key) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
    for (const ch of String(key)) {
      const c = ch.codePointAt(0);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x01000193 + 0x2c) >>> 0;
    }
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}@radmagelabs.com`;
  }

  const httpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

  /** Refuses an event that would make a wrong or broken entry, saying why. */
  function check(e, i) {
    const where = `event ${i + 1}${e && e.summary ? ` (${e.summary})` : ''}`;
    if (!e || typeof e !== 'object') throw new Error(`${where}: not an event`);
    if (typeof e.uid !== 'string' || !/^[0-9a-f]{16}@radmagelabs\.com$/.test(e.uid)) throw new Error(`${where}: bad uid`);
    if (typeof e.summary !== 'string' || !e.summary.trim()) throw new Error(`${where}: no summary`);
    if (typeof e.start !== 'number' || !Number.isFinite(e.start) || typeof e.end !== 'number' || !Number.isFinite(e.end)) throw new Error(`${where}: start and end must be times`);
    if (e.end <= e.start) throw new Error(`${where}: ends before it starts`);
    if (e.url !== undefined && e.url !== null && !httpsUrl(e.url)) throw new Error(`${where}: url must be https`);
  }

  /**
   * A whole calendar: { name, stampMs, events: [{ uid, start, end, summary, description?, location?,
   * url?, tentative?, categories? }] }. Every event is checked first; one bad event refuses the file.
   */
  function calendar({ name, stampMs, events }) {
    if (!Array.isArray(events) || !events.length) throw new Error('no events');
    if (events.length > MAX_EVENTS) throw new Error(`too many events (${events.length})`);
    events.forEach(check);
    const uids = new Set();
    for (const e of events) { if (uids.has(e.uid)) throw new Error(`the same event twice: ${e.uid}`); uids.add(e.uid); }
    const now = stamp(stampMs);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'];
    if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
    for (const e of events) {
      lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${escapeText(e.summary.trim())}`);
      if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
      if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
      if (e.url) lines.push(`URL:${e.url}`);
      if (Array.isArray(e.categories) && e.categories.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
      // Predicted entries are tentative, and none of them block time in the calendar.
      lines.push(`STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
  }

  const Ics = { PRODID, MAX_EVENTS, stamp, escapeText, fold, uid, calendar };
  if (typeof module === 'object' && module.exports) module.exports = Ics;
  else root.WoWIcs = Ics;
})(typeof globalThis !== 'undefined' ? globalThis : this);
