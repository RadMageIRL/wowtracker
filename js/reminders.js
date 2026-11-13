// Reminders for starred events, worked out from the schedule engine's own windows. Pure, so the page
// and the Node tests share it. A reminder is due from (start - lead) until the start, and never after:
// an event that has started, or a reminder missed while the page was closed or asleep, is not shown
// late. Each one has a key (region, event, start, lead) so it is delivered once, in one tab. Retail's
// keys are as they have always been; any other edition's start with its id ("forever|us|..."), so the
// same event at the same moment in two editions is two reminders, each delivered once.
//
// The lead is the reader's one setting (5 to 60 minutes) unless an event has a lead of its own (v0.5).
// Those are kept apart from the settings, per edition, as { [event id]: minutes }: an event without an
// entry follows the setting. One occurrence (region, event, start) is delivered once whatever its lead,
// so changing a lead never brings a reminder back.
(function (root) {
  'use strict';

  const MIN = 60000;
  const LEADS = [5, 15, 30, 60];
  /** What one event can be given instead: the same, and two longer ones for events that do not repeat within a day. */
  const LONG_LEADS = [120, 1440];
  const EVENT_LEADS = LEADS.concat(LONG_LEADS);
  /** Delivered keys are kept this long, long enough for any tab still waiting on one. */
  const KEEP_MS = 2 * 24 * 3600000;

  /** Off until the reader turns them on; 15 minutes; no browser notifications; no hourly events. */
  const defaults = () => ({ on: false, lead: 15, notify: false, hourly: false });
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** Saved settings, checked: anything unexpected falls back to the default. */
  function sanitize(raw) {
    const d = defaults();
    if (!isObj(raw)) return d;
    return {
      on: raw.on === true,
      lead: LEADS.includes(raw.lead) ? raw.lead : d.lead,
      notify: raw.notify === true,
      hourly: raw.hourly === true,
    };
  }

  /**
   * Saved leads of single events, checked against an edition's event ids: an event the data no longer has,
   * a lead that is not offered, or anything that is not a plain { id: minutes } is left out, and the event
   * then follows the setting.
   */
  function sanitizeLeads(raw, eventIds) {
    const out = {};
    if (!isObj(raw)) return out;
    for (const id of eventIds || []) if (has(raw, id) && EVENT_LEADS.includes(raw[id])) out[id] = raw[id];
    return out;
  }

  /** The leads one event can be given: an event that repeats every hour or more often only the short ones. */
  const choices = (frequent) => (frequent ? LEADS.slice() : EVENT_LEADS.slice());

  /** The lead in force for an event: its own when it has one that is offered for it, else the setting. { minutes, own }. */
  function leadFor(id, settings, leads, frequent) {
    const own = isObj(leads) && has(leads, id) ? leads[id] : null;
    return choices(frequent).includes(own) ? { minutes: own, own: true } : { minutes: sanitize(settings).lead, own: false };
  }

  /** "15 minutes", "2 hours", "1 day". */
  function leadText(minutes) {
    const [n, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 && minutes > 60 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }

  /** Retail (the default edition, or none named) keeps the v0.2 key; another edition is named first. */
  const prefix = (region, edition) => (!edition || edition === 'retail' ? `${region}|` : `${edition}|${region}|`);
  const key = (region, id, start, lead, edition) => `${prefix(region, edition)}${id}|${start}|${lead}`;
  /** A delivered key of this edition: Retail's has four parts, another edition's five, its id first. */
  const keyPattern = (edition) => (!edition || edition === 'retail' ? /^[a-z]+\|[a-z0-9-]+\|\d+\|\d+$/ : new RegExp(`^${edition}\\|[a-z]+\\|[a-z0-9-]+\\|\\d+\\|\\d+$`));

  /** The occurrence a key is for: the key without its lead (region, event and start; the edition first where named). */
  const occurrence = (k) => String(k).slice(0, String(k).lastIndexOf('|'));
  /** True when this key's occurrence is in the delivery records, under this lead or any other. */
  function wasDelivered(delivered, k) {
    if (!isObj(delivered)) return false;
    const o = occurrence(k);
    return Object.keys(delivered).some((d) => occurrence(d) === o);
  }

  const byId = (a, b) => (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0);

  /**
   * Reminders due at now: for each starred, not hidden event that runs in the region, every window
   * whose start is after now and at most its lead away. Hourly events only when asked for.
   * engine: { scheduleFor(event, region), windows(schedule, from, to), isFrequent(schedule) }.
   * leads: the edition's single-event leads, if any.
   */
  function due({ events, region, now, settings, leads, starred, hidden, engine, edition }) {
    const s = sanitize(settings);
    if (!s.on) return [];
    const star = new Set(starred || []), hide = new Set(hidden || []), out = [];
    for (const e of events || []) {
      if (!star.has(e.id) || hide.has(e.id)) continue;
      const sch = engine.scheduleFor(e, region);
      if (!sch || (engine.isFrequent(sch) && !s.hourly)) continue;
      const lead = leadFor(e.id, s, leads, engine.isFrequent(sch)).minutes;
      // Asking the engine only for windows that start by now + lead is the "lead minutes before" bound.
      for (const w of engine.windows(sch, now + 1, now + lead * MIN + 1)) {
        if (w.start > now) out.push({ key: key(region, e.id, w.start, lead, edition), event: e, start: w.start, end: w.end, name: w.name || e.name, lead });
      }
    }
    return out.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name) || byId(a, b));
  }

  /** How far ahead the list of upcoming reminders looks for an event's next start. */
  const LOOK_AHEAD_MS = 400 * 24 * 3600000;

  /**
   * What is coming for each starred event, for the list in the Reminders dialog: its next start in the
   * region, when its reminder comes (start minus its lead), the lead and whether it is the event's own,
   * and a state:
   *   'on'       a reminder will be shown at `trigger` (if the page is open then)
   *   'due'      the reminder time has come and the event has not started
   *   'off'      reminders are turned off
   *   'hourly'   the event repeats every hour or more often and those are not asked for
   *   'hidden'   the event is hidden
   *   'none'     nothing more of it is scheduled in this region (start and trigger are null)
   * In order of reminder time, then start, name and id, so two at one moment always come the same way
   * round; events with nothing scheduled come last, by name. Same arguments as due().
   */
  function upcoming({ events, region, now, settings, leads, starred, hidden, engine, edition }) {
    const s = sanitize(settings), star = new Set(starred || []), hide = new Set(hidden || []), out = [];
    for (const e of events || []) {
      if (!star.has(e.id)) continue;
      const sch = engine.scheduleFor(e, region), frequent = Boolean(sch && engine.isFrequent(sch));
      const lead = leadFor(e.id, s, leads, frequent);
      const w = sch ? engine.windows(sch, now + 1, now + LOOK_AHEAD_MS).find((x) => x.start > now) : null;
      const row = { event: e, name: (w && w.name) || e.name, frequent, lead: lead.minutes, own: lead.own, start: null, end: null, trigger: null, key: null, state: 'none' };
      if (w) {
        Object.assign(row, { start: w.start, end: w.end, trigger: w.start - lead.minutes * MIN, key: key(region, e.id, w.start, lead.minutes, edition) });
        row.state = hide.has(e.id) ? 'hidden' : !s.on ? 'off' : frequent && !s.hourly ? 'hourly' : row.trigger <= now ? 'due' : 'on';
      }
      out.push(row);
    }
    return out.sort((a, b) => (a.trigger === null) - (b.trigger === null) || (a.trigger === null ? 0 : a.trigger - b.trigger || a.start - b.start)
      || a.name.localeCompare(b.name, 'en') || byId(a, b));
  }

  /**
   * The next moment after now at which time alone changes a row of upcoming(): a reminder coming due (its
   * trigger) or an event starting (the row then moves on to the event's next start). Infinity when nothing will.
   * A list on screen needs working out again only then, not every second.
   */
  function nextChange(rows, now) {
    let next = Infinity;
    for (const r of rows || []) for (const t of [r.trigger, r.start]) if (typeof t === 'number' && t > now && t < next) next = t;
    return next;
  }

  /** The delivered keys still worth keeping (younger than KEEP_MS, well formed, and this edition's). */
  function prune(delivered, now, edition) {
    const out = {}, pattern = keyPattern(edition);
    if (!isObj(delivered)) return out;
    for (const [k, t] of Object.entries(delivered)) if (typeof t === 'number' && t <= now + MIN && now - t < KEEP_MS && pattern.test(k)) out[k] = t;
    return out;
  }

  /** True when the item is still worth showing: not started, starred, not hidden, in this region and edition. */
  function stillDue(item, { region, now, starred, hidden, edition }) {
    return item.start > now && item.key.startsWith(prefix(region, edition)) && (starred || []).includes(item.event.id) && !(hidden || []).includes(item.event.id);
  }

  const Reminders = { LEADS, LONG_LEADS, EVENT_LEADS, KEEP_MS, defaults, sanitize, sanitizeLeads, choices, leadFor, leadText, key, occurrence, wasDelivered, due, upcoming, nextChange, prune, stillDue };
  if (typeof module === 'object' && module.exports) module.exports = Reminders;
  else root.WoWReminders = Reminders;
})(typeof globalThis !== 'undefined' ? globalThis : this);
