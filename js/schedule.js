// WoW Tracker schedule engine. Every function is a pure function of epoch milliseconds, so the page
// and the Node tests share this file unchanged.
//
// A rule says when something happens in a named time zone ("Tuesday 15:00 UTC", "the first Sunday
// of the month at 00:01 America/Los_Angeles"). Wall times are turned into instants with the zone's
// own offset on that date, from the platform's time-zone database (Intl), so daylight saving is
// handled where it applies and nowhere else. Windows are half-open: [start, end).
(function (root) {
  'use strict';

  const MIN = 60000, HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // ---- Time zones ----

  const formatters = new Map();
  function partsFormatter(zone) {
    let f = formatters.get(zone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
      });
      formatters.set(zone, f);
    }
    return f;
  }

  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** The wall clock in `zone` at ms: { y, mo (1-12), d, h, mi, s, wd (0 = Sunday) }. */
  function wallClock(zone, ms) {
    const out = {};
    for (const p of partsFormatter(zone).formatToParts(ms)) out[p.type] = p.value;
    return {
      y: Number(out.year), mo: Number(out.month), d: Number(out.day),
      h: Number(out.hour) % 24, mi: Number(out.minute), s: Number(out.second), wd: SHORT_DAYS.indexOf(out.weekday),
    };
  }

  /** The zone's offset from UTC at ms, in minutes (UTC-7 is -420). */
  function offsetMin(zone, ms) {
    if (zone === 'UTC') return 0;
    const w = wallClock(zone, ms);
    return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / MIN);
  }

  /**
   * The instant a wall clock in `zone` shows y-mo-d h:mi. When the clock is set back and that time
   * happens twice, the first one; when it is skipped (clocks go forward), the instant the same
   * number of minutes after the jump, as clocks themselves read it.
   */
  function wallToUtc(zone, y, mo, d, h, mi) {
    const naive = Date.UTC(y, mo - 1, d, h, mi);
    if (zone === 'UTC') return naive;
    const before = offsetMin(zone, naive - DAY), after = offsetMin(zone, naive + DAY);
    const hits = [];
    for (const o of before === after ? [before] : [before, after]) {
      const t = naive - o * MIN;
      if (offsetMin(zone, t) === o) hits.push(t);
    }
    if (hits.length) return Math.min(...hits);
    return naive - before * MIN;
  }

  /** A calendar date moved by n days (pure date arithmetic, no zone). */
  function addDays(y, mo, d, n) {
    const t = new Date(Date.UTC(y, mo - 1, d + n));
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
  }
  const weekdayOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

  function hm(text) {
    const m = /^(\d{2}):(\d{2})$/.exec(text);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`bad time ${text}`);
    return [Number(m[1]), Number(m[2])];
  }

  // ---- Resets: instants that repeat ----

  /** Every instant of a reset rule in [fromMs, toMs). Rules: daily { time, zone }, weekly { weekday, time, zone }, monthly { day, time, zone }. */
  function resetInstants(rule, fromMs, toMs) {
    const [h, mi] = hm(rule.time), out = [];
    // Walk calendar days in the rule's zone from a day before the range to a day after it.
    const first = wallClock(rule.zone, fromMs - DAY);
    const span = Math.ceil((toMs - fromMs) / DAY) + 3;
    for (let i = 0; i <= span; i++) {
      const c = addDays(first.y, first.mo, first.d, i);
      if (rule.type === 'weekly' && c.wd !== rule.weekday) continue;
      if (rule.type === 'monthly' && c.d !== rule.day) continue;
      const t = wallToUtc(rule.zone, c.y, c.mo, c.d, h, mi);
      if (t >= fromMs && t < toMs) out.push(t);
    }
    return out;
  }

  const RESET_PERIOD = { daily: DAY, weekly: WEEK, monthly: 31 * DAY };

  /** The first reset strictly after nowMs. */
  function nextReset(rule, nowMs) {
    const p = RESET_PERIOD[rule.type];
    const found = resetInstants(rule, nowMs + 1, nowMs + p + DAY);
    return found[0];
  }

  /** The latest reset at or before nowMs. */
  function previousReset(rule, nowMs) {
    const p = RESET_PERIOD[rule.type];
    const found = resetInstants(rule, nowMs - p - DAY, nowMs + 1);
    return found[found.length - 1];
  }

  // ---- Event windows ----

  /**
   * Every window of a schedule that overlaps [fromMs, toMs), in start order: [{ start, end }].
   *   dates:      { windows: [{ start, end }] } with ISO 8601 instants (offset required)
   *   every:      { periodMin, offsetMin, durationMin } counted from the Unix epoch, optional from/until
   *   monthlyNth: { n, weekday, time, zone, durationMin } (n = 1 for the first weekday of the month), optional until
   */
  function windows(schedule, fromMs, toMs) {
    const out = [];
    if (schedule.type === 'dates') {
      for (const w of schedule.windows) {
        const start = Date.parse(w.start), end = Date.parse(w.end);
        if (end > fromMs && start < toMs) out.push(w.name ? { start, end, name: w.name } : { start, end });
      }
    } else if (schedule.type === 'every') {
      const p = schedule.periodMin * MIN, o = schedule.offsetMin * MIN, w = schedule.durationMin * MIN;
      const lo = schedule.from ? Math.max(fromMs, Date.parse(schedule.from)) : fromMs;
      const hi = schedule.until ? Math.min(toMs, Date.parse(schedule.until)) : toMs;
      const fromBound = schedule.from ? Date.parse(schedule.from) : -Infinity;
      // The first window still open at lo: start + w > lo.
      for (let s = o + (Math.floor((lo - w - o) / p) + 1) * p; s < hi; s += p) {
        if (s >= fromBound) out.push({ start: s, end: s + w });
      }
    } else if (schedule.type === 'monthlyNth') {
      const [h, mi] = hm(schedule.time), w = schedule.durationMin * MIN;
      const stop = schedule.until ? Math.min(toMs, Date.parse(schedule.until)) : toMs;
      const c = wallClock(schedule.zone, fromMs - w - DAY);
      for (let k = 0; ; k++) {
        const y = c.y + Math.floor((c.mo - 1 + k) / 12), mo = ((c.mo - 1 + k) % 12) + 1;
        const firstWd = weekdayOf(y, mo, 1);
        const d = 1 + ((schedule.weekday - firstWd + 7) % 7) + (schedule.n - 1) * 7;
        if (d > daysInMonth(y, mo)) continue;
        const start = wallToUtc(schedule.zone, y, mo, d, h, mi);
        if (start >= stop) break;
        if (start + w > fromMs) out.push({ start, end: start + w });
      }
    } else {
      throw new Error(`unknown schedule type ${schedule.type}`);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** The window containing nowMs, or null. */
  function currentWindow(schedule, nowMs) {
    const found = windows(schedule, nowMs, nowMs + 1).filter((w) => w.start <= nowMs && nowMs < w.end);
    return found.length ? found[found.length - 1] : null;
  }

  /** The schedule an event follows in a region, or null when the event does not run there. */
  const scheduleFor = (event, region) => (event.schedules && event.schedules[region]) || null;

  // A window can carry its own name ("Legion Timewalking" in the Timewalking event).
  const withName = (item, w) => (w.name ? Object.assign(item, { name: w.name }) : item);

  /** Events whose window contains nowMs in the region, soonest to end first. */
  function happening(events, region, nowMs) {
    const out = [];
    for (const e of events) {
      const s = scheduleFor(e, region);
      const win = s && currentWindow(s, nowMs);
      if (win) out.push(withName({ event: e, start: win.start, end: win.end }, win));
    }
    return out.sort((a, b) => a.end - b.end || a.event.name.localeCompare(b.event.name));
  }

  /** Every window starting in (nowMs, nowMs + spanMs] in the region, in time order. */
  function upcoming(events, region, nowMs, spanMs) {
    const out = [];
    for (const e of events) {
      const s = scheduleFor(e, region);
      if (!s) continue;
      for (const w of windows(s, nowMs + 1, nowMs + spanMs + 1)) {
        if (w.start > nowMs && w.start <= nowMs + spanMs) out.push(withName({ event: e, start: w.start, end: w.end }, w));
      }
    }
    return out.sort((a, b) => a.start - b.start || a.event.name.localeCompare(b.event.name));
  }

  /** The next window of each event that has not started by nowMs (one per event), soonest first. */
  function nextOf(events, region, nowMs, horizonMs) {
    const out = [];
    for (const e of events) {
      const s = scheduleFor(e, region);
      if (!s) continue;
      const w = windows(s, nowMs + 1, nowMs + horizonMs).find((x) => x.start > nowMs);
      if (w) out.push(withName({ event: e, start: w.start, end: w.end }, w));
    }
    return out.sort((a, b) => a.start - b.start || a.event.name.localeCompare(b.event.name));
  }

  // ---- Display helpers ----

  const pad = (n) => String(n).padStart(2, '0');

  /** "2d 4h", "1h 05m", "12m 05s", "45s". Rounds down; negative values count as zero. */
  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${pad(m)}m`;
    if (m) return `${m}m ${pad(sec)}s`;
    return `${sec}s`;
  }

  /** A sortable key for the calendar day of ms in `zone`. */
  function dayKey(ms, zone) {
    const w = wallClock(zone, ms);
    return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
  }

  /** Whole calendar days from nowMs's day to ms's day, both read in `zone`. */
  function dayDiff(ms, nowMs, zone) {
    const a = wallClock(zone, nowMs), b = wallClock(zone, ms);
    return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / DAY);
  }

  /** "Today", "Tomorrow", or the weekday and date for the day of ms in `zone`. */
  function dayLabel(ms, nowMs, zone, locale) {
    const days = dayDiff(ms, nowMs, zone);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: zone }).format(ms);
  }

  const Schedule = {
    MIN, HOUR, DAY, WEEK, WEEKDAYS,
    wallClock, offsetMin, wallToUtc, addDays,
    resetInstants, nextReset, previousReset,
    windows, currentWindow, scheduleFor, happening, upcoming, nextOf,
    duration, dayKey, dayDiff, dayLabel,
  };
  if (typeof module === 'object' && module.exports) module.exports = Schedule;
  else root.WoWSchedule = Schedule;
})(typeof globalThis !== 'undefined' ? globalThis : this);
