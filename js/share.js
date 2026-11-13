// Share links: an address that opens one event's details, in one edition of the game, for one region, at one
// of its times. The part after "#" is
//   <edition>/<event>/<region>/<start>        retail/darkmoon-faire/us/20261206T0800Z
// The region and the start may be left off from the right ("forever/darkmoon-faire" is the event in the
// reader's own region, now or next). The start is the occurrence's first instant in UTC, so the same link
// names the same occurrence in every time zone; it and the event id are what calendar UIDs are made of too.
// Pure, so the page and the Node tests share it. Reading a link never trusts it: anything that is not exactly
// this shape is refused as a whole, and the page then shows what it would have shown without it.
(function (root) {
  'use strict';

  /** Longer than any real link by a wide margin; more than this is not read at all. */
  const MAX_CHARS = 120;
  const EVENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const pad = (n, width) => String(n).padStart(width || 2, '0');

  /** An instant as a link writes it, in UTC: "20261206T0800Z", with seconds only when it has any. Null when it cannot be written. */
  function stamp(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms % 1000 !== 0) return null;
    const d = new Date(ms), y = d.getUTCFullYear();
    if (Number.isNaN(d.getTime()) || y < 1000 || y > 9999) return null;
    const s = d.getUTCSeconds();
    return `${pad(y, 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${s ? pad(s) : ''}Z`;
  }

  /** The instant a stamp names, or null: the shape must be exact and the date and time must exist (no February 30, no 24:00). */
  function parseStamp(text) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/.exec(String(text).toUpperCase());
    if (!m) return null;
    const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x || 0));
    const ms = Date.UTC(y, mo - 1, d, h, mi, s), back = new Date(ms);
    const same = back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s;
    return same && y >= 1000 ? ms : null;
  }

  /** The part after "#" for an event: its edition and id, the region when given, and the start when given with a region. */
  function make({ edition, event, region, start }) {
    const parts = [edition, encodeURIComponent(event)];
    if (region) {
      parts.push(region);
      const at = start === null || start === undefined ? null : stamp(start);
      if (at) parts.push(at);
    }
    return `#${parts.join('/')}`;
  }

  /**
   * What an address's hash asks for, given the edition ids and region ids this page has:
   *   null                                   not a share link ("", "#forever", "#forever/", "#coming-title")
   *   { ok: false, reason }                  a share link that cannot be used: 'edition' (a game version this page
   *                                          does not have) or 'malformed' (anything else that does not fit)
   *   { ok: true, edition, event, region, start }   region and start are null when left off
   * Whether the event exists, runs in that region or has that start is for the page to say: it has the data.
   */
  function parse(hash, { editions, regions } = {}) {
    const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
    if (!raw.includes('/')) return null;
    const parts = raw.split('/');
    if (parts[parts.length - 1] === '') parts.pop(); // one trailing slash
    if (parts.length < 2) return null; // the edition alone, as "#forever" is
    const bad = (reason) => ({ ok: false, reason });
    if (raw.length > MAX_CHARS || parts.length > 4) return bad('malformed');
    const [edition, id, region, start] = parts;
    if (!(editions || []).includes(edition)) return bad(/^[a-z][a-z0-9-]{0,31}$/.test(edition) ? 'edition' : 'malformed');
    let event = '';
    try { event = decodeURIComponent(id); } catch (e) { return bad('malformed'); }
    if (!EVENT_ID.test(event)) return bad('malformed');
    if (region !== undefined && !(regions || []).includes(region)) return bad('malformed');
    const at = start === undefined ? null : parseStamp(start);
    if (start !== undefined && at === null) return bad('malformed');
    return { ok: true, edition, event, region: region === undefined ? null : region, start: at };
  }

  const Share = { MAX_CHARS, stamp, parseStamp, make, parse };
  if (typeof module === 'object' && module.exports) module.exports = Share;
  else root.WoWShare = Share;
})(typeof globalThis !== 'undefined' ? globalThis : this);
