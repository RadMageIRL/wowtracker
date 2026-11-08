// Reminders for starred events, worked out from the schedule engine's own windows. Pure, so the page
// and the Node tests share it. A reminder is due from (start - lead) until the start, and never after:
// an event that has started, or a reminder missed while the page was closed or asleep, is not shown
// late. Each one has a key (region, event, start, lead) so it is delivered once, in one tab.
(function (root) {
  'use strict';

  const MIN = 60000;
  const LEADS = [5, 15, 30, 60];
  /** Delivered keys are kept this long, long enough for any tab still waiting on one. */
  const KEEP_MS = 2 * 24 * 3600000;

  /** Off until the reader turns them on; 15 minutes; no browser notifications; no hourly events. */
  const defaults = () => ({ on: false, lead: 15, notify: false, hourly: false });

  /** Saved settings, checked: anything unexpected falls back to the default. */
  function sanitize(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
    return {
      on: raw.on === true,
      lead: LEADS.includes(raw.lead) ? raw.lead : d.lead,
      notify: raw.notify === true,
      hourly: raw.hourly === true,
    };
  }

  const key = (region, id, start, lead) => `${region}|${id}|${start}|${lead}`;

  /**
   * Reminders due at now: for each starred, not hidden event that runs in the region, every window
   * whose start is after now and at most lead minutes away. Hourly events only when asked for.
   * engine: { scheduleFor(event, region), windows(schedule, from, to), isFrequent(schedule) }.
   */
  function due({ events, region, now, settings, starred, hidden, engine }) {
    const s = sanitize(settings);
    if (!s.on) return [];
    const star = new Set(starred || []), hide = new Set(hidden || []), lead = s.lead * MIN, out = [];
    for (const e of events || []) {
      if (!star.has(e.id) || hide.has(e.id)) continue;
      const sch = engine.scheduleFor(e, region);
      if (!sch || (engine.isFrequent(sch) && !s.hourly)) continue;
      // Asking the engine only for windows that start by now + lead is the "lead minutes before" bound.
      for (const w of engine.windows(sch, now + 1, now + lead + 1)) {
        if (w.start > now) out.push({ key: key(region, e.id, w.start, s.lead), event: e, start: w.start, end: w.end, name: w.name || e.name });
      }
    }
    return out.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  }

  /** The delivered keys still worth keeping (younger than KEEP_MS, and well formed). */
  function prune(delivered, now) {
    const out = {};
    if (!delivered || typeof delivered !== 'object' || Array.isArray(delivered)) return out;
    for (const [k, t] of Object.entries(delivered)) if (typeof t === 'number' && t <= now + MIN && now - t < KEEP_MS && /^[a-z]+\|[a-z0-9-]+\|\d+\|\d+$/.test(k)) out[k] = t;
    return out;
  }

  /** True when the item is still worth showing: not started, starred, not hidden, in this region. */
  function stillDue(item, { region, now, starred, hidden }) {
    return item.start > now && item.key.startsWith(`${region}|`) && (starred || []).includes(item.event.id) && !(hidden || []).includes(item.event.id);
  }

  const Reminders = { LEADS, KEEP_MS, defaults, sanitize, key, due, prune, stillDue };
  if (typeof module === 'object' && module.exports) module.exports = Reminders;
  else root.WoWReminders = Reminders;
})(typeof globalThis !== 'undefined' ? globalThis : this);
