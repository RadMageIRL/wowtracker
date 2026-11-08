// WoW Tracker page. Reads the generated dataset (events-data.js), the links in config.js and the pure
// helpers in schedule.js, store.js, news.js and clock.js; everything here is display and input. The
// DOM is built with createElement only: no outside text is ever parsed as HTML.
(function () {
  'use strict';

  const S = window.WoWSchedule, Store = window.WoWStore, News = window.WoWNews, Clock = window.WoWClock;
  const DATA = window.WOW_DATA, CONFIG = window.WoWConfig;
  /** The edition of the game this page shows. Retail keeps the storage keys it has always had. */
  const EDITION = 'retail';
  /** This page's version, from its own script address (app.js?v=0.2.0), for backups. */
  const APP_VERSION = (() => { try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; } })();
  const $ = (id) => document.getElementById(id);
  // Without the schedule data there is nothing to count down: say so instead of showing a broken page.
  if (!DATA || !Array.isArray(DATA.events) || !DATA.resets) {
    const n = $('clock-notice');
    n.textContent = 'The schedule data did not load. Reload the page; if this stays, the site is missing events-data.js.';
    n.hidden = false;
    return;
  }
  const storage = (() => { try { return window.localStorage; } catch (e) { return null; } })();

  const EVENTS = DATA.events;
  const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
  const CATEGORIES = DATA.categories;
  const CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c]));
  const REGION = new Map(DATA.regions.map((r) => [r.id, r]));
  /** How far ahead "Next event" looks. The calendar runs to the end of the dataset. */
  const HORIZON_MS = 120 * S.DAY;
  const COVERS_UNTIL = Date.parse(DATA.meta.coversUntil + 'T23:59:59Z');
  // Where the calendar's closing line takes over from the month-by-month notes.
  const DATA_END = Date.parse(DATA.meta.coversUntil + 'T00:00:00Z');

  const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let prefs = Store.sanitizePrefs(Store.read(storage, 'prefs'), EVENTS.map((e) => e.id), CATEGORIES.map((c) => c.id), deviceZone());
  let clockOffset = 0;
  const nowMs = () => Date.now() + clockOffset;
  const savePrefs = () => Store.write(storage, 'prefs', prefs);

  // ---- Small DOM helper ----

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  // ---- Time formatting: the display zone is the device's, or UTC (rebuilt when either changes) ----

  let fmt = null;
  function formats() {
    const local = deviceZone();
    const zone = prefs.timeMode === 'utc' ? 'UTC' : local;
    if (!fmt || fmt.local !== local || fmt.zone !== zone) {
      const make = (zoneId, opts) => (zoneId === 'UTC'
        ? new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC', hourCycle: 'h23' }, opts, opts.hour ? { hour: '2-digit' } : {}))
        : new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: zoneId }, opts)));
      const set = (zoneId) => ({
        time: make(zoneId, { hour: 'numeric', minute: '2-digit' }),
        clock: make(zoneId, { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
        wday: make(zoneId, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
        date: make(zoneId, { month: 'short', day: 'numeric' }),
        wdate: make(zoneId, { weekday: 'short', month: 'short', day: 'numeric' }),
        full: make(zoneId, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        month: make(zoneId, { month: 'long', year: 'numeric' }),
      });
      fmt = { local, zone, main: set(zone), utc: set('UTC'), newsDay: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: local }) };
    }
    return fmt;
  }
  const TIMED = new Set(['time', 'clock', 'wday', 'full']);
  /** An instant in the display zone; times read in UTC say so. */
  function at(ms, kind) {
    const f = formats(), s = f.main[kind].format(ms);
    return f.zone === 'UTC' && TIMED.has(kind) ? `${s} UTC` : s;
  }
  /** The same instant in UTC, when Local + UTC is chosen. */
  const utcToo = (ms, kind) => (prefs.timeMode === 'both' ? `${formats().utc[kind].format(ms)} UTC` : null);
  const zoneName = () => (formats().zone === 'UTC' ? 'UTC' : formats().local);
  // A dataset date ("2026-10-27") shown as a calendar date, the same in every time zone.
  const isoDay = (iso) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

  // ---- Which events show ----

  // Search narrows what the filters show. It is not saved: categories, stars and hiding stay as saved.
  const Search = window.WoWSearch;
  let query = '';
  const SEARCH_INDEX = new Map(EVENTS.map((e) => {
    const c = CATEGORY.get(e.category);
    const windowNames = Object.values(e.schedules || {}).flatMap((s) => (s && s.windows ? s.windows.map((w) => w.name).filter(Boolean) : []));
    return [e.id, Search.index([e.name, ...(e.aliases || []), ...windowNames, e.zone, c.name, c.short || ''])];
  }));
  const found = (e) => Search.matches(SEARCH_INDEX.get(e.id), query);

  function shown() {
    const cats = new Set(prefs.categories), hidden = new Set(prefs.hidden), starred = new Set(prefs.starred);
    return EVENTS.filter((e) => !hidden.has(e.id) && cats.has(e.category) && (prefs.filter === 'all' || starred.has(e.id)) && found(e));
  }
  const region = () => prefs.region;
  const resets = () => DATA.resets[region()];

  // ---- Pieces shared by cards, rows and the calendar ----

  /** How sure the schedule is in the chosen region: a region can be less certain than the event (its start time). */
  function statusFor(e) {
    const s = S.scheduleFor(e, region());
    if (s && s.status) return { status: s.status, part: s.part || null, basis: s.basis };
    return { status: e.status, part: null, basis: e.basis };
  }
  function predictedBadge(st) {
    if (st.status !== 'predicted') return null;
    const text = st.part === 'time' ? 'Predicted time' : 'Predicted';
    return h('span', { class: 'badge predicted', title: `${text}: ${st.basis}`, text });
  }
  /** "every hour" for something that repeats within a day, else null. */
  function repeatText(e) {
    const s = S.scheduleFor(e, region());
    if (!s || s.type !== 'every' || s.periodMin >= 1440) return null;
    return s.periodMin === 60 ? 'every hour' : s.periodMin % 60 === 0 ? `every ${s.periodMin / 60} hours` : `every ${s.periodMin} min`;
  }
  const isFrequent = (e) => { const s = S.scheduleFor(e, region()); return Boolean(s && s.type === 'every' && s.periodMin < 1440); };
  const nameOf = (item) => item.name || item.event.name;

  /** An event's name, as the button that opens its details at this occurrence. */
  function nameButton(item, key) {
    const name = nameOf(item);
    return h('button', { type: 'button', class: 'name name-btn', 'data-details': item.event.id, 'data-start': item.start, 'data-fkey': `${key}:details`, 'aria-haspopup': 'dialog', 'aria-label': `${name}: details`, text: name });
  }

  function badges(e) {
    return [h('span', { class: 'badge cat', text: CATEGORY.get(e.category).short || CATEGORY.get(e.category).name }), predictedBadge(statusFor(e))];
  }

  function star(e, key) {
    const on = prefs.starred.includes(e.id);
    return h('button', { type: 'button', class: 'star-btn' + (on ? ' on' : ''), 'data-star': e.id, 'data-fkey': `${key}:star`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Star ${e.name}`, title: on ? 'Starred' : 'Star', text: on ? '★' : '☆' });
  }

  function actions(e, key) {
    const out = [];
    if (e.link) out.push(h('a', { class: 'btn small', href: e.link.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${e.name}: ${e.link.label} (opens a new tab)`, text: e.link.label }));
    out.push(h('button', { type: 'button', class: 'btn small', 'data-hide': e.id, 'data-fkey': `${key}:hide`, 'aria-label': `Hide ${e.name}`, text: 'Hide' }));
    return h('div', { class: 'actions' }, out);
  }

  function sourceLine(e) {
    const first = e.sources[0];
    return h('p', { class: 'src' }, 'Source: ', h('a', { href: first.url, target: '_blank', rel: 'noopener noreferrer', text: first.publisher }),
      e.sources.length > 1 ? ` and ${e.sources.length - 1} more` : '', ` · checked ${isoDay(e.lastVerified)}`);
  }

  /** "Oct 18 - Nov 1" in the display zone; one date when it starts and ends the same day. */
  function span(start, end) {
    const last = end - 1;
    const z = formats().zone;
    return S.dayKey(start, z) === S.dayKey(last, z) ? at(start, 'wdate') : `${at(start, 'date')} - ${at(last, 'date')}`;
  }

  // ---- Where schedules stop being known: never shown as "nothing happens" ----

  /** The categories the viewer follows: the chosen ones, or with Starred, those of the starred events. */
  function followedCategories() {
    if (prefs.filter !== 'starred' && !query) return new Set(prefs.categories);
    // With Starred or a search: the categories of what is shown.
    return new Set(shown().map((e) => e.category));
  }

  /** Followed categories whose schedules stop being known before toMs, grouped by when: [{ until, cats }]. */
  function gaps(toMs) {
    const followed = followedCategories(), by = new Map();
    for (const c of CATEGORIES) {
      const until = c.knownUntil ? Date.parse(c.knownUntil[region()]) : Infinity;
      if (!followed.has(c.id) || !(until < toMs)) continue;
      if (!by.has(until)) by.set(until, []);
      by.get(until).push(c);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([until, cats]) => ({ until, cats }));
  }

  /** A quiet line: "Not known yet from Tue, Dec 1, 9:00 AM: Timewalking, Bonus events." Null when everything is known. */
  function gapNote(toMs) {
    const g = gaps(toMs);
    if (!g.length) return null;
    return h('p', { class: 'gap' }, g.flatMap((x, i) => [i ? ' ' : '', `Not known yet from ${at(x.until, 'full')}: `,
      h('span', { class: 'gap-cats', title: x.cats.map((c) => `${c.name}: ${c.gap}.`).join(' '), text: x.cats.map((c) => c.name).join(', ') }), '.']));
  }

  /** Puts gapNote's line into a page element, or hides the element. */
  function showGap(id, toMs) {
    const note = gapNote(toMs), el = $(id);
    el.hidden = !note;
    el.replaceChildren(...(note ? [...note.childNodes] : []));
    return Boolean(note);
  }

  // ---- Summary: time, resets, next event ----

  function summaryItems(now, nextItem) {
    const rs = resets(), f = formats();
    const daily = S.nextReset(rs.daily.rule, now), weekly = S.nextReset(rs.weekly.rule, now);
    const items = [
      h('li', { class: 'clock' },
        h('span', { class: 'label', text: prefs.timeMode === 'utc' ? 'Time (UTC)' : 'Your time' }),
        h('span', { class: 'value', id: 'clock-now', text: at(now, 'clock') }),
        h('span', { class: 'sub', id: 'clock-sub', text: prefs.timeMode === 'both' ? `${f.utc.clock.format(now)} UTC` : zoneName() })),
      h('li', { class: 'reset', 'data-reset': 'daily' },
        h('span', { class: 'label', text: 'Daily reset' }),
        h('span', { class: 'value', 'data-until': daily, 'data-prefix': 'in ' }, 'in ' + S.duration(daily - now)),
        h('span', { class: 'sub', text: [at(daily, 'wday'), utcToo(daily, 'time')].filter(Boolean).join(' · ') })),
      h('li', { class: 'reset', 'data-reset': 'weekly' },
        h('span', { class: 'label', text: 'Weekly reset' }),
        h('span', { class: 'value', 'data-until': weekly, 'data-prefix': 'in ' }, 'in ' + S.duration(weekly - now)),
        h('span', { class: 'sub', text: [at(weekly, 'full'), utcToo(weekly, 'wday')].filter(Boolean).join(' · ') })),
    ];
    if (rs.monthly) {
      const monthly = S.nextReset(rs.monthly.rule, now);
      items.push(h('li', { class: 'reset', 'data-reset': 'monthly' },
        h('span', { class: 'label' }, rs.monthly.name, ' ', predictedBadge(rs.monthly)),
        h('span', { class: 'value', 'data-until': monthly, 'data-prefix': 'in ' }, 'in ' + S.duration(monthly - now)),
        h('span', { class: 'sub', text: [at(monthly, 'full'), utcToo(monthly, 'wday')].filter(Boolean).join(' · ') })));
    }
    if (nextItem) {
      const e = nextItem.event;
      items.push(h('li', { class: 'next', 'data-cat': e.category },
        h('span', { class: 'label', text: prefs.starred.includes(e.id) ? 'Next starred event' : 'Next event' }),
        h('span', { class: 'value next-name' }, nameOf(nextItem), ' ', predictedBadge(statusFor(e))),
        h('span', { class: 'sub' }, h('span', { 'data-until': nextItem.start, 'data-prefix': 'in ' }, 'in ' + S.duration(nextItem.start - now)), ` · ${at(nextItem.start, 'full')}`)));
    } else {
      items.push(h('li', { class: 'next' }, h('span', { class: 'label', text: 'Next event' }), h('span', { class: 'sub', text: 'Nothing you follow is scheduled yet.' })));
    }
    return items;
  }

  /**
   * The next event to mention at the top: the soonest starred one if any is coming, else the soonest.
   * Something that repeats every hour or so is only picked when it is starred.
   */
  function nextImportant(list, now) {
    const next = S.nextOf(list, region(), now, HORIZON_MS);
    return next.find((i) => prefs.starred.includes(i.event.id)) || next.find((i) => !isFrequent(i.event)) || null;
  }

  function regionLine() {
    const r = REGION.get(region()), rs = resets();
    const utcRule = (rule) => (rule.zone === 'UTC' ? `${rule.time} UTC` : `${rule.time} ${rule.zone}`);
    return [h('strong', { text: r.name }), ` · ${r.realms}. Daily reset ${utcRule(rs.daily.rule)}, weekly reset ${S.WEEKDAYS[rs.weekly.rule.weekday]} ${utcRule(rs.weekly.rule)}, the same all year, so local clocks move an hour when daylight saving changes.`];
  }

  // ---- Happening now (cards) ----

  function card(item, now) {
    const e = item.event, key = `now:${e.id}`;
    return h('article', { class: 'event', 'data-cat': e.category, 'data-id': e.id },
      h('div', { class: 'event-head' }, star(e, key), h('h3', {}, nameButton(item, key)), h('span', { class: 'pill', text: 'Scheduled now' })),
      h('div', { class: 'badges' }, badges(e)),
      h('p', { class: 'where', text: e.zone }),
      h('p', { class: 'countdown' },
        h('span', { class: 'big', 'data-until': item.end, 'data-prefix': 'Ends in ' }, 'Ends in ' + S.duration(item.end - now)),
        h('span', { class: 'since' }, ` · ${span(item.start, item.end)}`)),
      h('p', { class: 'note' }, `Started ${at(item.start, 'full')}, ends ${at(item.end, 'full')}`, utcToo(item.start, 'full') ? ` (${utcToo(item.start, 'full')} to ${utcToo(item.end, 'full')})` : '', '.'),
      e.note ? h('p', { class: 'note', text: e.note }) : null,
      sourceLine(e),
      actions(e, key));
  }

  // ---- Coming up (rows) ----

  function row(item, now) {
    const e = item.event, key = `next:${e.id}:${item.start}`;
    const long = item.end - item.start >= S.DAY;
    return h('li', { class: 'row', 'data-cat': e.category, 'data-id': e.id, 'data-start': item.start },
      h('div', { class: 'when' },
        h('span', { class: 't', text: at(item.start, 'time') }),
        utcToo(item.start, 'time') ? h('span', { class: 'utc', text: utcToo(item.start, 'time') }) : null,
        h('span', { class: 'in', 'data-until': item.start, 'data-prefix': 'in ' }, 'in ' + S.duration(item.start - now))),
      h('div', { class: 'what' },
        h('div', { class: 'line1' }, star(e, key), nameButton(item, key), badges(e)),
        h('div', { class: 'line2', text: [e.zone, long ? `runs ${span(item.start, item.end)}` : `${Math.round((item.end - item.start) / S.MIN)} min`, repeatText(e)].filter(Boolean).join(' · ') }),
        e.note ? h('p', { class: 'note', text: e.note }) : null),
      actions(e, key));
  }

  function rowsWithDays(items, now) {
    const out = [], z = formats().zone;
    let lastDay = S.dayKey(now, z);
    for (const it of items) {
      const day = S.dayKey(it.start, z);
      if (day !== lastDay) { out.push(h('li', { class: 'day-sep', text: S.dayLabel(it.start, now, z) })); lastDay = day; }
      out.push(row(it, now));
    }
    return out;
  }

  /** Something that repeats every hour or so lists only its next few starts, so it cannot flood the list. */
  const REPEAT_ROWS = 3;
  function capRepeats(items) {
    const count = new Map();
    return items.filter((i) => {
      if (!isFrequent(i.event)) return true;
      const n = (count.get(i.event.id) || 0) + 1;
      count.set(i.event.id, n);
      return n <= REPEAT_ROWS;
    });
  }

  const aheadText = (hours) => ({ 1: 'hour', 2: '2 hours', 4: '4 hours', 8: '8 hours', 24: '24 hours', 72: '3 days', 168: '7 days' }[hours]);

  // ---- Weekly overview: this reset week and the next ----

  function weekColumn(title, from, to, list, now) {
    const items = [];
    for (const e of list) {
      const s = S.scheduleFor(e, region());
      if (!s) continue;
      const found = S.windows(s, from, to);
      // Something that repeats every hour or so gets one line for the week, not one per start.
      if (isFrequent(e)) { if (found.length) items.push({ event: e, start: found[0].start, end: found[found.length - 1].end, repeats: true }); continue; }
      for (const w of found) items.push({ event: e, start: w.start, end: w.end, name: w.name });
    }
    items.sort((a, b) => Number(Boolean(a.repeats)) - Number(Boolean(b.repeats)) || a.start - b.start || a.event.name.localeCompare(b.event.name));
    const li = items.map((i) => {
      const whole = i.start <= from && i.end >= to;
      const when = i.repeats ? `${repeatText(i.event)}${i.end < to ? `, until ${at(i.end, 'wday')}` : ''}`
        : whole ? 'all week' : i.start < from ? `until ${at(i.end, 'wday')}` : i.end > to ? `from ${at(i.start, 'wday')}` : `${at(i.start, 'wday')} to ${at(i.end, 'wday')}`;
      const live = !i.repeats && i.start <= now && now < i.end;
      return h('li', { 'data-cat': i.event.category, 'data-id': i.event.id },
        nameButton(i, `week:${i.event.id}:${i.start}`),
        predictedBadge(statusFor(i.event)),
        h('span', { class: 'span', text: when + (live ? ' · on now' : '') }));
    });
    const note = gapNote(to);
    if (!li.length) li.push(h('li', { class: 'none', text: note ? 'Nothing known yet.' : query ? 'Nothing that matches is scheduled.' : 'Nothing you follow is scheduled.' }));
    return h('div', { class: 'week-col' },
      h('h3', {}, title, ' ', h('span', { class: 'dates', text: `${at(from, 'wdate')} to ${at(to, 'wdate')}` })),
      h('ul', { class: 'week-list' }, li), note);
  }

  function weekGrid(list, now) {
    const rule = resets().weekly.rule;
    const start = S.previousReset(rule, now), next = S.nextReset(rule, now), after = S.nextReset(rule, next);
    return [weekColumn('This reset week', start, next, list, now), weekColumn('Next reset week', next, after, list, now)];
  }

  // ---- Event calendar: an agenda by month ----

  function calendarMonths(list, now) {
    const z = formats().zone;
    const until = COVERS_UNTIL;
    const items = [];
    for (const e of list) {
      const s = S.scheduleFor(e, region());
      if (!s) continue;
      // Something that repeats every hour or so would flood the agenda; it lives in Coming up.
      if (isFrequent(e)) continue;
      for (const w of S.windows(s, now, until)) items.push({ event: e, start: w.start, end: w.end, name: w.name });
    }
    items.sort((a, b) => a.start - b.start || a.event.name.localeCompare(b.event.name));
    // Every month from this one to the end of the data, so a month with nothing known still shows.
    const months = [];
    for (let w = S.wallClock(z, now), y = w.y, mo = w.mo; ; mo === 12 ? (y++, mo = 1) : mo++) {
      const start = S.wallToUtc(z, y, mo, 1, 0, 0), end = S.wallToUtc(z, mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, 0, 0);
      if (start > until) break;
      months.push({ key: `${y}-${String(mo).padStart(2, '0')}`, label: at(Math.max(start, now), 'month'), end, items: [] });
    }
    for (const i of items) {
      const k = S.dayKey(Math.max(i.start, now), z).slice(0, 7);
      const m = months.find((x) => x.key === k);
      if (m) m.items.push(i);
    }
    return months.map((m) => h('div', { class: 'month' },
      h('h3', { text: m.label }),
      gapNote(Math.min(m.end, DATA_END)),
      m.items.length ? null : h('p', { class: 'month-none', text: gaps(Math.min(m.end, DATA_END)).length ? 'Nothing else known yet.' : 'Nothing you follow this month.' }),
      m.items.length ? h('ol', { class: 'agenda' }, m.items.map((i) => {
        const live = i.start <= now && now < i.end;
        return h('li', { class: live ? 'is-now' : null, 'data-cat': i.event.category, 'data-id': i.event.id },
          h('span', { class: 'dates', text: span(i.start, i.end) }),
          h('span', { class: 'what' },
            nameButton(i, `cal:${i.event.id}:${i.start}`), badges(i.event),
            h('span', { class: 'sub', text: live ? `on now, ends ${at(i.end, 'full')}` : `starts ${at(i.start, 'full')}` })));
      })) : null));
  }

  // ---- Render: a full rebuild only when what is listed changes; countdown text every second ----

  let lastKey = '';
  function structureKey(now, list, nowItems, nextItems, nextItem) {
    const rs = resets();
    return [prefs.region, prefs.filter, prefs.categories.join(), prefs.starred.join(), prefs.hidden.join(), prefs.aheadHours, prefs.compact, prefs.timeMode, query,
      formats().local, S.dayKey(now, formats().zone),
      nowItems.map((i) => i.event.id + i.start).join(), nextItems.map((i) => i.event.id + i.start).join(),
      nextItem ? nextItem.event.id + nextItem.start : '', list.length,
      Object.values(rs).map((r) => S.nextReset(r.rule, now)).join()].join('|');
  }

  function render(force) {
    const now = nowMs(), list = shown();
    const nowItems = S.happening(list, region(), now);
    const nextItems = capRepeats(S.upcoming(list, region(), now, prefs.aheadHours * S.HOUR));
    const nextItem = nextImportant(list, now);
    const key = structureKey(now, list, nowItems, nextItems, nextItem);
    if (force || key !== lastKey) {
      lastKey = key;
      const focusKey = document.activeElement && document.activeElement.getAttribute('data-fkey');
      $('summary').replaceChildren(...summaryItems(now, nextItem));
      $('region-line').replaceChildren(...regionLine());
      $('now-list').replaceChildren(...nowItems.map((i) => card(i, now)));
      const nowGap = showGap('now-gap', now + 1);
      $('now-empty').hidden = nowItems.length > 0;
      $('now-empty').textContent = nowGap ? 'Nothing known is in its scheduled window right now.' : 'Nothing you follow is in its scheduled window right now.';
      const starred = new Set(prefs.starred);
      const top = prefs.filter === 'starred' ? [] : nextItems.filter((i) => starred.has(i.event.id));
      const rest = prefs.filter === 'starred' ? nextItems : nextItems.filter((i) => !starred.has(i.event.id));
      const rows = [];
      if (top.length) rows.push(h('li', { class: 'group', text: 'Starred' }), ...rowsWithDays(top, now), h('li', { class: 'group', text: 'Everything else' }));
      rows.push(...rowsWithDays(rest, now));
      $('next-list').replaceChildren(...rows);
      const empty = $('next-empty');
      empty.hidden = nextItems.length > 0;
      const nextGap = showGap('next-gap', now + prefs.aheadHours * S.HOUR);
      if (!nextItems.length) {
        empty.textContent = `Nothing ${nextGap ? 'known' : 'you follow'} starts in the next ${aheadText(prefs.aheadHours)}.`
          + (nextItem ? ` Next: ${nameOf(nextItem)}, ${at(nextItem.start, 'full')}.` : '');
      }
      $('coming-hint').textContent = `next ${aheadText(prefs.aheadHours)}, ${zoneName() === 'UTC' ? 'in UTC' : `your time (${zoneName()})`}`;
      $('week-grid').replaceChildren(...weekGrid(list, now));
      $('week-hint').textContent = `${REGION.get(region()).name} reset weeks`;
      const months = calendarMonths(list, now);
      const anyItem = months.some((m) => m.querySelector('.agenda'));
      $('calendar').replaceChildren(...(anyItem || gaps(COVERS_UNTIL).length ? months : [h('p', { class: 'empty', text: query ? 'Nothing on the calendar matches your search.' : 'Nothing you follow is on the calendar.' })]),
        h('p', { class: 'gap', text: `Nothing after ${isoDay(DATA.meta.coversUntil)} is in the data yet.` }));
      $('calendar-hint').textContent = `through ${isoDay(DATA.meta.coversUntil)}`;
      renderChecklist(false); // rebuilt only when its region, periods or display changed
      if (focusKey) { const el = document.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`); if (el) el.focus(); }
    }
    $('clock-now').textContent = at(now, 'clock');
    if (prefs.timeMode === 'both') $('clock-sub').textContent = `${formats().utc.clock.format(now)} UTC`;
    for (const el of document.querySelectorAll('[data-until]')) {
      const t = el.getAttribute('data-prefix') + S.duration(Number(el.getAttribute('data-until')) - now);
      if (el.textContent !== t) el.textContent = t;
    }
  }

  // ---- Controls ----

  function syncControls() {
    for (const b of document.querySelectorAll('[data-region]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-region') === prefs.region));
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === prefs.filter));
    $('category-chips').replaceChildren(...CATEGORIES.map((c) => h('button', {
      type: 'button', class: 'chip', 'data-cat': c.id, 'data-category': c.id, 'aria-pressed': String(prefs.categories.includes(c.id)), text: c.name,
    })));
    $('ahead').value = String(prefs.aheadHours);
    $('time-mode').value = prefs.timeMode;
    $('compact-btn').setAttribute('aria-pressed', String(prefs.compact));
    $('hidden-btn').textContent = `Hidden (${prefs.hidden.length})`;
    // What the folded filters (phones) are set to, so they need not be opened to be read.
    const option = (id) => { const s = $(id); return s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : ''; };
    $('filters-summary').textContent = [
      query ? `search "${query}"` : null,
      prefs.filter === 'starred' ? 'Starred' : null,
      prefs.categories.length === CATEGORIES.length ? 'all categories' : `${prefs.categories.length} of ${CATEGORIES.length} categories`,
      option('ahead'), option('time-mode'), prefs.compact ? 'compact' : null, prefs.hidden.length ? `${prefs.hidden.length} hidden` : null,
    ].filter(Boolean).join(' · ');
    searchStatus();
    renderRemindersUi(); // the button says whether reminders are on; the dialog counts the starred events
    document.body.classList.toggle('compact', prefs.compact);
    const label = { dark: 'Dark', light: 'Light', system: 'System' }[prefs.theme];
    $('theme-btn').textContent = label;
    $('theme-btn').setAttribute('aria-label', `Theme: ${label}. Change theme`);
    applyTheme();
  }

  const systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const t = prefs.theme === 'system' ? (systemLight && systemLight.matches ? 'light' : 'dark') : prefs.theme;
    document.documentElement.setAttribute('data-theme', t);
  }
  if (systemLight && systemLight.addEventListener) systemLight.addEventListener('change', applyTheme);

  function changed() { savePrefs(); syncControls(); render(true); }
  const toggleIn = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : arr.concat(id));

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  // Share passes the configured address when there is one, else this page's own address.
  async function share() {
    const url = CONFIG.shareUrl || location.href.split('#')[0];
    const data = { title: 'WoW Tracker', text: 'World of Warcraft resets and events in your local time', url };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { toast(`Copy this link: ${url}`); }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const a = (name) => t.getAttribute(name);
    if (a('data-details')) openDetails(a('data-details'), Number(a('data-start')), t);
    else if (a('data-ics')) addOneToCalendar(a('data-ics'), Number(a('data-start')));
    else if (t.id === 'export-btn') { renderExport(); $('export-dialog').showModal(); }
    else if (t.id === 'export-go') exportNow();
    else if (t.id === 'reminders-btn') { renderRemindersUi(); $('reminders-dialog').showModal(); }
    else if (a('data-dismiss')) dismissReminders([a('data-dismiss')]);
    else if (t.id === 'reminders-clear') dismissReminders(tray.map((x) => x.key));
    else if (t.id === 'reminders-expand') { trayOpen = !trayOpen; renderTray(); }
    else if (t.id === 'cl-toggle') { prefs.checklistOpen = !prefs.checklistOpen; if (!prefs.checklistOpen) clEditing = false; savePrefs(); renderChecklist(true); }
    else if (t.id === 'cl-edit') { clEditing = !clEditing; clSay(''); renderChecklist(true); }
    else if (t.id === 'cl-add') addTask();
    else if (a('data-delete')) deleteTask(a('data-delete'));
    else if (t.id === 'cl-suggest') { renderSuggest(); $('suggest-dialog').showModal(); }
    else if (t.id === 'suggest-add') addSuggested();
    else if (t.id === 'cl-backup' || t.id === 'backup-btn') { renderBackup(); $('backup-dialog').showModal(); }
    else if (t.id === 'backup-copy') copyBackup();
    else if (t.id === 'backup-download') downloadBackup();
    else if (t.id === 'backup-check') checkBackup($('backup-in').value);
    else if (t.id === 'backup-apply') applyBackup();
    else if (t.id === 'backup-cancel') cancelBackup();
    else if (a('data-star') && t.closest('#details')) {
      prefs.starred = toggleIn(prefs.starred, a('data-star')); changed(); renderDetails();
      const again = document.querySelector(`#details [data-star="${CSS.escape(a('data-star'))}"]`);
      if (again) again.focus();
    } else if (a('data-region')) { prefs.region = a('data-region'); changed(); }
    else if (a('data-filter')) { prefs.filter = a('data-filter'); changed(); }
    else if (a('data-category')) { prefs.categories = toggleIn(prefs.categories, a('data-category')); changed(); }
    else if (a('data-star')) { prefs.starred = toggleIn(prefs.starred, a('data-star')); changed(); }
    else if (a('data-hide')) {
      const e = BY_ID.get(a('data-hide'));
      prefs.hidden = toggleIn(prefs.hidden, e.id); changed();
      toast(`${e.name} is hidden. Show it again from Hidden.`);
      if ($('details').open) $('details').close();
      $('coming-title').focus();
    } else if (a('data-unhide')) { prefs.hidden = prefs.hidden.filter((x) => x !== a('data-unhide')); changed(); renderHidden(); }
    else if (t.id === 'unhide-all') { prefs.hidden = []; changed(); renderHidden(); }
    else if (t.id === 'compact-btn') { prefs.compact = !prefs.compact; changed(); }
    else if (t.id === 'theme-btn') { prefs.theme = { dark: 'light', light: 'system', system: 'dark' }[prefs.theme]; changed(); }
    else if (t.id === 'about-btn') $('about').showModal();
    else if (t.id === 'hidden-btn') { renderHidden(); $('hidden-dialog').showModal(); }
    else if (t.id === 'filters-toggle') {
      const open = !$('filters').classList.contains('is-open');
      $('filters').classList.toggle('is-open', open);
      t.setAttribute('aria-expanded', String(open));
      $('filters-act').textContent = open ? 'Hide' : 'Show';
    } else if (t.id === 'news-toggle') { prefs.newsCollapsed = !prefs.newsCollapsed; savePrefs(); renderNews(); if (!prefs.newsCollapsed) loadNews(); }
    else if (t.id === 'news-all') { prefs.newsAll = !prefs.newsAll; savePrefs(); renderNews(); }
    else if (t.id === 'news-shop') { prefs.newsShop = !prefs.newsShop; savePrefs(); renderNews(); }
    else if (t.id === 'share-btn') share();
    else if (a('data-close') !== null) t.closest('dialog').close();
  });

  // Search: lists narrow as you type (briefly debounced); Escape or Clear empties it.
  function searchStatus() {
    const el = $('search-status');
    $('search-clear').hidden = !query;
    if (!query) { el.textContent = ''; return; }
    const n = shown().length;
    const elsewhere = EVENTS.filter(found).length - n;
    el.textContent = (n ? `${n} ${n === 1 ? 'event matches' : 'events match'}.` : `No event you follow matches "${query}".`)
      + (elsewhere > 0 ? ` ${elsewhere} more ${elsewhere === 1 ? 'is' : 'are'} hidden, not starred, or in a category you turned off.` : '');
  }
  function setQuery(text) {
    const next = String(text || '').trim().slice(0, 60);
    if (next === query) return;
    query = next;
    syncControls();
    render(true);
  }
  let searchTimer = 0;
  $('search').addEventListener('input', (ev) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setQuery(ev.target.value), 120); });
  $('search').addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ev.target.value) { ev.preventDefault(); ev.target.value = ''; setQuery(''); } });
  $('search-clear').addEventListener('click', () => { $('search').value = ''; setQuery(''); $('search').focus(); });

  $('ahead').addEventListener('change', (ev) => { prefs.aheadHours = Number(ev.target.value); changed(); });
  $('time-mode').addEventListener('change', (ev) => { prefs.timeMode = ev.target.value; changed(); });
  $('export-dialog').addEventListener('change', renderExport); // the range and the predicted choice
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // a click on the backdrop closes it
  }
  // Another tab of this page changed the settings: follow it.
  window.addEventListener('storage', (ev) => {
    if (ev.key === Store.PREFIX + 'reminders') { rem = Rem.sanitize(Store.read(storage, 'reminders')); renderRemindersUi(); syncControls(); return; }
    if (ev.key === Store.PREFIX + CL_KEY) { checklist = CL.sanitize(Store.read(storage, CL_KEY)); clRev++; renderChecklist(true); return; }
    if (ev.key !== Store.PREFIX + 'prefs') return;
    prefs = Store.sanitizePrefs(Store.read(storage, 'prefs'), EVENTS.map((e) => e.id), CATEGORIES.map((c) => c.id), deviceZone());
    syncControls(); render(true); renderNews();
    if (!prefs.newsCollapsed && !newsState.items.length) loadNews();
  });

  function renderHidden() {
    const items = prefs.hidden.map((id) => BY_ID.get(id)).filter(Boolean);
    $('hidden-list').replaceChildren(...items.map((e) => h('li', {},
      h('span', { text: `${e.name} (${CATEGORY.get(e.category).name})` }),
      h('button', { type: 'button', class: 'btn small', 'data-unhide': e.id, 'aria-label': `Show ${e.name} again`, text: 'Show' }))));
    $('hidden-empty').hidden = items.length > 0;
    $('unhide-all').hidden = items.length < 2;
  }

  // ---- Event details: one dialog, built only from what the dataset says ----

  const KIND = { official: 'Blizzard', client: 'game data', 'game-api': 'game API', wiki: 'wiki', guide: 'guide' };
  const ORDINAL = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' };

  /** "6 days 23 hours", "10 minutes": whole units only, as the data has them. */
  function lengthText(ms) {
    const m = Math.round(ms / S.MIN), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mi = m % 60;
    const part = (n, unit) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : null);
    return [part(d, 'day'), part(hr, 'hour'), part(mi, 'minute')].filter(Boolean).join(' ') || '0 minutes';
  }

  /** How long one window lasts and how it repeats, read off the schedule itself. */
  function durationText(s, w) {
    if (!s) return null;
    if (s.type === 'every') {
      const len = lengthText(s.durationMin * S.MIN);
      return s.periodMin < 1440 ? `${len}, ${repeatTextFor(s)}` : `${len}, once every ${lengthText(s.periodMin * S.MIN)}`;
    }
    if (s.type === 'monthlyNth') return `${lengthText(s.durationMin * S.MIN)}, from the ${ORDINAL[s.n] || `${s.n}th`} ${S.WEEKDAYS[s.weekday]} of each month at ${s.time} (${s.zone})`;
    return w ? lengthText(w.end - w.start) : null;
  }
  const repeatTextFor = (s) => (s.periodMin === 60 ? 'every hour' : s.periodMin % 60 === 0 ? `every ${s.periodMin / 60} hours` : `every ${s.periodMin} minutes`);

  /** The window to describe: the one clicked if it still exists, else the current one, else the next. */
  function occurrence(s, at, now) {
    if (!s) return null;
    if (Number.isFinite(at)) { const w = S.windows(s, at, at + 1).find((x) => x.start === at); if (w) return w; }
    return S.currentWindow(s, now) || S.windows(s, now + 1, now + HORIZON_MS).find((x) => x.start > now) || null;
  }

  function whenLine(w, now) {
    if (!w) return null;
    const live = w.start <= now && now < w.end;
    const utc = (ms) => utcToo(ms, 'full');
    return live
      ? [h('strong', { text: 'On now' }), ', ends ', at(w.end, 'full'), utc(w.end) ? ` (${utc(w.end)})` : '', ' · ', h('span', { 'data-until': w.end, 'data-prefix': 'ends in ' }, 'ends in ' + S.duration(w.end - now))]
      : w.start > now
        ? ['Starts ', at(w.start, 'full'), utc(w.start) ? ` (${utc(w.start)})` : '', ', ends ', at(w.end, 'full'), ' · ', h('span', { 'data-until': w.start, 'data-prefix': 'in ' }, 'in ' + S.duration(w.start - now))]
        : ['Ended ', at(w.end, 'full')];
  }

  function confidence(e, st) {
    if (st.status === 'predicted' && st.part === 'time') return [h('strong', { text: 'Predicted time. ' }), 'The dates are confirmed; the start time in this region is not. ', st.basis || ''];
    if (st.status === 'predicted') return [h('strong', { text: 'Predicted. ' }), st.basis || e.basis || 'A pattern Blizzard has not published.'];
    const kinds = [...new Set(e.sources.map((s) => KIND[s.kind] || s.kind))];
    return [h('strong', { text: 'Confirmed. ' }), `From ${kinds.join(' and ')}.`];
  }

  function coverage(e) {
    const c = CATEGORY.get(e.category), until = c.knownUntil ? Date.parse(c.knownUntil[region()]) : null;
    if (!until) return null;
    // A limit at midnight UTC is a date ("through Mar 31, 2027"); one at a reset is a moment.
    const d = new Date(until);
    const when = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `through ${isoDay(new Date(until - S.DAY).toISOString().slice(0, 10))}` : `until ${at(until, 'full')}`;
    return [`Known ${when}. After that: not known yet`, c.gap ? ` (${c.gap})` : '', '.'];
  }

  let detailsOpen = null; // { id, at, trigger }
  function renderDetails() {
    if (!detailsOpen) return;
    const e = BY_ID.get(detailsOpen.id);
    if (!e) return;
    const now = nowMs(), r = region(), s = S.scheduleFor(e, r), st = statusFor(e), key = `details:${e.id}`;
    const w = occurrence(s, detailsOpen.at, now);
    const later = s && w ? S.windows(s, w.end, now + HORIZON_MS).filter((x) => x.start >= w.end).slice(0, 3) : [];
    const other = DATA.regions.find((x) => x.id !== r);
    const os = other && S.scheduleFor(e, other.id), ow = occurrence(os, w ? w.start : NaN, now);
    const row = (label, ...value) => (value.flat().filter((v) => v !== null && v !== '').length ? [h('dt', { text: label }), h('dd', {}, ...value.flat())] : []);
    const name = w && w.name ? w.name : e.name;
    $('details').setAttribute('data-cat', e.category); // the category color, as on the cards
    $('details-body').replaceChildren(
      h('h2', { id: 'details-title' }, name),
      h('div', { class: 'badges' }, badges(e)),
      h('dl', { class: 'details-list' },
        row('When', whenLine(w, now) || (s ? 'Nothing more of it is in the data for this region.' : 'It does not run in this region.')),
        row('How long', durationText(s, w)),
        row('Region', REGION.get(r).name, ` (${REGION.get(r).realms})`),
        ow && other ? row(other.name, ow.start > now ? `Starts ${at(ow.start, 'full')}` : `On now, ends ${at(ow.end, 'full')}`,
          os.status === 'predicted' ? (os.part === 'time' ? ' (Predicted time)' : ' (Predicted)') : e.status === 'predicted' ? ' (Predicted)' : '') : [],
        row('Where', e.zone),
        row('About', e.note || null),
        row('Later', later.length ? h('ul', { class: 'details-later' }, later.map((x) => h('li', {}, x.name && x.name !== name ? `${x.name}: ` : '',
          x.end - x.start < S.DAY ? at(x.start, 'full') : [span(x.start, x.end), ` (starts ${at(x.start, 'full')})`]))) : null),
        row('How sure', confidence(e, st)),
        row('Data', coverage(e)),
        row('Sources', h('ul', { class: 'details-sources' }, e.sources.map((src) => h('li', {},
          h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.publisher, h('span', { class: 'sr-only', text: ' (opens a new tab)' })),
          ` · ${KIND[src.kind] || src.kind}`))), h('span', { class: 'details-checked', text: `Checked ${isoDay(e.lastVerified)}.` }))),
      h('div', { class: 'details-actions' }, star(e, key), h('span', { class: 'star-label', text: prefs.starred.includes(e.id) ? 'Starred' : 'Star' }),
        w ? h('button', { type: 'button', class: 'btn small', 'data-ics': e.id, 'data-start': w.start, 'aria-label': `Add ${name} on ${at(w.start, 'full')} to your calendar (downloads a calendar file)`, text: 'Add to calendar' }) : null,
        e.link ? h('a', { class: 'btn small', href: e.link.url, target: '_blank', rel: 'noopener noreferrer', text: e.link.label }, h('span', { class: 'sr-only', text: ' (opens a new tab)' })) : null,
        h('button', { type: 'button', class: 'btn small', 'data-hide': e.id, 'data-fkey': `${key}:hide`, 'aria-label': `Hide ${e.name}`, text: 'Hide' })));
  }

  function openDetails(id, atMs, trigger) {
    detailsOpen = { id, at: atMs, trigger, fkey: trigger && trigger.getAttribute('data-fkey') };
    renderDetails();
    const d = $('details');
    if (!d.open) d.showModal();
  }
  $('details').addEventListener('close', () => {
    const t = detailsOpen && detailsOpen.trigger, fkey = detailsOpen && detailsOpen.fkey;
    detailsOpen = null;
    // Back to the name that opened it, or the same name after the lists were rebuilt.
    const back = t && t.isConnected ? t : fkey ? document.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`) : null;
    if (back) back.focus();
  });

  // ---- Calendar export (.ics): the engine's own windows, written by js/ics.js ----

  const Ics = window.WoWIcs;
  const PAGE_URL = CONFIG.shareUrl || location.href.split('#')[0];
  const predictedLabel = (st) => (st.status !== 'predicted' ? '' : st.part === 'time' ? ' (Predicted time)' : ' (Predicted)');

  /** One calendar entry for one window of an event, in the chosen region. */
  function icsEntry(e, w) {
    const r = region(), reg = REGION.get(r), st = statusFor(e);
    const sure = st.status === 'predicted' && st.part === 'time'
      ? `Predicted time: the dates are confirmed; the start time on ${reg.realms} is not. ${st.basis || ''}`
      : st.status === 'predicted' ? `Predicted: ${st.basis || e.basis || 'a pattern Blizzard has not published.'}`
        : `Confirmed: from ${[...new Set(e.sources.map((s) => KIND[s.kind] || s.kind))].join(' and ')}.`;
    const description = [
      sure.trim(),
      e.note || null,
      `Region: ${reg.name} (${reg.realms}).`,
      `A scheduled time from WoW Tracker schedule data r${DATA.meta.datasetRevision}, checked ${e.lastVerified}. It is not read from the game; a realm can open early or late around maintenance.`,
      `Sources: ${e.sources.map((s) => `${s.publisher} ${s.url}`).join(' ; ')}`,
      `WoW Tracker: ${PAGE_URL}`,
    ].filter(Boolean).join('\n');
    return {
      uid: Ics.uid(`${e.id}|${r}|${w.start}`), start: w.start, end: w.end,
      summary: `${w.name || e.name}${predictedLabel(st)}`, description,
      location: `World of Warcraft: ${e.zone}`, url: e.link ? e.link.url : e.sources[0].url,
      tentative: st.status === 'predicted', categories: [CATEGORY.get(e.category).name],
    };
  }

  /** Hands a file made here to the browser to save. Nothing leaves the browser. */
  function saveFile(fileName, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: fileName, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Saves a calendar file, made from the engine's own windows. */
  function saveIcs(fileName, title, entries) {
    let text;
    try { text = Ics.calendar({ name: title, stampMs: nowMs(), events: entries }); } catch (err) { toast(`The calendar file could not be made: ${err.message}`); return false; }
    saveFile(fileName, text, 'text/calendar;charset=utf-8');
    toast(`Saved ${fileName} (${entries.length} ${entries.length === 1 ? 'event' : 'events'}). Open it to add ${entries.length === 1 ? 'it' : 'them'} to your calendar.`);
    return true;
  }
  const fileDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const regionSlug = () => REGION.get(region()).name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  /** What a bulk export holds: windows of what the filters show, from now to the end of the range. */
  function exportPlan(range, withPredicted) {
    const now = nowMs(), to = range === 'all' ? COVERS_UNTIL : now + prefs.aheadHours * S.HOUR;
    const entries = [], hourly = [], predicted = new Set(), timeOnly = new Set();
    for (const e of shown()) {
      const s = S.scheduleFor(e, region());
      if (!s) continue;
      const ws = S.windows(s, now, to); // on now, or starting before the end of the range
      if (!ws.length) continue;
      if (isFrequent(e)) { hourly.push(e.name); continue; }
      const st = statusFor(e);
      if (st.status === 'predicted' && st.part !== 'time' && !withPredicted) continue;
      for (const w of ws) {
        entries.push(icsEntry(e, w));
        if (st.status === 'predicted') (st.part === 'time' ? timeOnly : predicted).add(e.id);
      }
    }
    entries.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary));
    return { entries, hourly, predicted: predicted.size, timeOnly: timeOnly.size, to };
  }

  function renderExport() {
    const range = document.querySelector('input[name="export-range"]:checked').value, withPredicted = $('export-predicted').checked;
    const p = exportPlan(range, withPredicted), all = exportPlan('all', withPredicted), soon = exportPlan('soon', withPredicted);
    $('export-soon-label').textContent = `On now and the next ${aheadText(prefs.aheadHours)} (${soon.entries.length})`;
    $('export-all-label').textContent = `Everything known, through ${isoDay(DATA.meta.coversUntil)} (${all.entries.length})`;
    $('export-scope').textContent = `${REGION.get(region()).name}, with your filters: ${$('filters-summary').textContent}. Hidden events are left out.`;
    const withP = exportPlan(range, true);
    const pred = withP.entries.filter((x) => / \(Predicted\)$/.test(x.summary)).length;
    $('export-predicted-label').textContent = `Include predicted events (${pred}, titled "(Predicted)")`;
    $('export-notes').replaceChildren(...[
      p.timeOnly ? h('li', { text: `${p.timeOnly} ${p.timeOnly === 1 ? 'event has' : 'events have'} a predicted start time in this region and ${p.timeOnly === 1 ? 'says' : 'say'} "(Predicted time)" in the title.` }) : null,
      p.hourly.length ? h('li', { text: `Left out: ${p.hourly.join(', ')} (repeats every hour or so). Add a single one from its details.` }) : null,
    ].filter(Boolean));
    const go = $('export-go');
    go.disabled = !p.entries.length;
    go.textContent = p.entries.length ? `Download ${p.entries.length} ${p.entries.length === 1 ? 'event' : 'events'} (.ics)` : 'Nothing to export';
  }

  function exportNow() {
    const range = document.querySelector('input[name="export-range"]:checked').value;
    const p = exportPlan(range, $('export-predicted').checked);
    if (p.entries.length && saveIcs(`wowtracker-${regionSlug()}-${fileDay(nowMs())}.ics`, `WoW Tracker (${REGION.get(region()).name})`, p.entries)) $('export-dialog').close();
  }

  function addOneToCalendar(id, startMs) {
    const e = BY_ID.get(id), s = e && S.scheduleFor(e, region());
    const w = s && S.windows(s, startMs, startMs + 1).find((x) => x.start === startMs);
    if (!w) { toast('That time is no longer in the schedule.'); return; }
    saveIcs(`wowtracker-${e.id}-${fileDay(w.start)}.ics`, `WoW Tracker (${REGION.get(region()).name})`, [icsEntry(e, w)]);
  }

  // ---- Reminders for starred events (only while this page is open) ----

  const Rem = window.WoWReminders;
  let rem = Rem.sanitize(Store.read(storage, 'reminders'));
  const saveRem = () => Store.write(storage, 'reminders', rem);
  let tray = [];                 // reminders shown on the page: { key, event, start, name, title, body }
  const tried = new Set();       // keys this tab has already tried to deliver
  let notifyBroken = false;      // the browser has Notification but refuses it (Android Chrome needs a service worker)
  const BASE_TITLE = document.title;
  const REM_ENGINE = { scheduleFor: S.scheduleFor, windows: S.windows, isFrequent: (s) => s.type === 'every' && s.periodMin < 1440 };

  const notifyState = () => (!('Notification' in window) || notifyBroken ? 'unsupported' : Notification.permission);

  function reminderText(it, now) {
    const st = statusFor(it.event), when = at(it.start, 'full');
    const label = predictedLabel(st);
    return {
      title: `${it.name}${label} starts in ${S.duration(it.start - now)}`,
      body: `${when}${st.status === 'predicted' ? (st.part === 'time' ? '. The start time is a prediction.' : '. The time is a prediction, not published by Blizzard.') : '.'} ${REGION.get(region()).name}. WoW Tracker`,
    };
  }

  /** Only one tab delivers each reminder: the key is claimed under a lock shared by every tab. */
  async function claim(k) {
    const run = () => {
      const d = Rem.prune(Store.read(storage, 'reminded'), Date.now());
      if (d[k]) return false;
      d[k] = Date.now();
      Store.write(storage, 'reminded', d);
      return true;
    };
    try { if (navigator.locks && navigator.locks.request) return await navigator.locks.request('wowtracker-reminders', run); } catch (e) { /* no locks here: claim without one */ }
    return run();
  }

  function notifyBrowser(it) {
    if (!rem.notify || notifyState() !== 'granted') return;
    try {
      const n = new Notification(it.title, { body: it.body, tag: it.key, silent: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { notifyBroken = true; } // page notifications refused (a service worker would be needed): the page notice stays
  }

  async function deliver(it, now) {
    tried.add(it.key);
    if (!(await claim(it.key))) return;
    Object.assign(it, reminderText(it, now));
    tray.push(it);
    tray.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)); // soonest first
    renderTray();
    announce(`Reminder: ${it.title}, ${at(it.start, 'time')}.`);
    notifyBrowser(it);
  }

  // The tray itself is not a live region (its countdowns change every second); new reminders are
  // read out once, here, a moment after the tick that delivered them.
  let sayQueue = [], sayTimer = 0;
  function announce(text) {
    sayQueue.push(text);
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { $('reminders-say').textContent = sayQueue.join(' '); sayQueue = []; }, 250);
  }

  // A phone shows one notice and a desktop three; the rest wait behind "+N more" as one-line rows.
  const PHONE = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  const trayCap = () => (PHONE && PHONE.matches ? 1 : 3);
  let trayOpen = false;

  function trayEntry(it, line) {
    return h('li', { class: line ? 'reminder is-line' : 'reminder', 'data-cat': it.event.category },
      h('p', {}, h('strong', { text: `${it.name}${predictedLabel(statusFor(it.event))}` }), ' starts ',
        h('span', { 'data-until': it.start, 'data-prefix': 'in ' }, `in ${S.duration(it.start - nowMs())}`), ` · ${at(it.start, 'time')}`),
      h('button', { type: 'button', class: 'link-btn', 'data-dismiss': it.key, 'aria-label': `Dismiss the reminder for ${it.name}`, text: 'Dismiss' }));
  }

  function renderTray() {
    const el = $('reminders-tray'), cap = trayCap(), extra = Math.max(0, tray.length - cap);
    if (!extra) trayOpen = false;
    // Focus inside the tray stays on the same control, or the nearest one, when it is rebuilt.
    const f = el.contains(document.activeElement) ? document.activeElement : null;
    const was = f && (f.id || f.getAttribute('data-dismiss'));
    el.replaceChildren(...[ // replaceChildren would write a null out as the text "null"
      h('ul', { class: 'reminder-list' }, tray.slice(0, cap).map((it) => trayEntry(it, false))),
      extra ? h('ul', { class: 'reminder-more', id: 'reminders-more', hidden: !trayOpen }, tray.slice(cap).map((it) => trayEntry(it, true))) : null,
      tray.length > 1 ? h('div', { class: 'reminder-bar' },
        extra ? h('button', { type: 'button', class: 'link-btn', id: 'reminders-expand', 'aria-expanded': String(trayOpen), 'aria-controls': 'reminders-more' },
          trayOpen ? 'Show fewer' : `+${extra} more`, trayOpen ? null : h('span', { class: 'sr-only', text: extra === 1 ? ' reminder' : ' reminders' })) : null,
        h('button', { type: 'button', class: 'link-btn', id: 'reminders-clear', text: 'Dismiss all' })) : null].filter(Boolean));
    el.hidden = !tray.length;
    document.title = tray.length ? `(${tray.length}) ${BASE_TITLE}` : BASE_TITLE;
    if (was) {
      const back = (was === 'reminders-expand' || was === 'reminders-clear' ? $(was) : el.querySelector(`[data-dismiss="${CSS.escape(was)}"]`)) || el.querySelector('[data-dismiss]');
      (back || $('coming-title')).focus();
    }
  }
  if (PHONE && PHONE.addEventListener) PHONE.addEventListener('change', () => { if (tray.length) renderTray(); });

  /** Takes reminders off the page. They were delivered, so they do not come back. */
  function dismissReminders(keys) {
    tray = tray.filter((x) => !keys.includes(x.key));
    renderTray();
  }

  /** On each tick: drop what is no longer due, deliver what has come due. Nothing at all while off. */
  function checkReminders(now) {
    if (tray.length) {
      const ctx = { region: region(), now, starred: prefs.starred, hidden: prefs.hidden };
      const keep = tray.filter((it) => rem.on && Rem.stillDue(it, ctx));
      if (keep.length !== tray.length) { tray = keep; renderTray(); }
    }
    if (!rem.on || !prefs.starred.length) return;
    for (const it of Rem.due({ events: EVENTS, region: region(), now, settings: rem, starred: prefs.starred, hidden: prefs.hidden, engine: REM_ENGINE })) {
      if (!tried.has(it.key)) deliver(it, now);
    }
  }

  function renderRemindersUi() {
    $('reminders-btn').textContent = rem.on ? `Reminders: ${rem.lead} min` : 'Reminders: off';
    $('reminders-btn').setAttribute('aria-pressed', String(rem.on));
    $('rem-on').checked = rem.on;
    $('rem-lead').value = String(rem.lead);
    $('rem-hourly').checked = rem.hourly;
    for (const id of ['rem-lead', 'rem-hourly', 'rem-notify']) $(id).disabled = !rem.on;
    const ns = notifyState();
    $('rem-notify').checked = rem.notify && ns === 'granted';
    if (ns === 'unsupported' || ns === 'denied') $('rem-notify').disabled = true;
    $('rem-notify-status').textContent = {
      unsupported: 'This browser does not let a page show notifications (phones usually need an installed app for that), so reminders stay on the page.',
      denied: 'Notifications are blocked for this site. To use them, allow them in your browser\'s site settings.',
      default: 'Off unless you tick this; your browser will ask first.',
      granted: rem.notify ? 'On: a silent notification too, also when this tab is in the background.' : 'Allowed by your browser; tick to use them.',
    }[ns];
    const starred = EVENTS.filter((e) => prefs.starred.includes(e.id) && !prefs.hidden.includes(e.id));
    const hourly = starred.filter((e) => { const s = S.scheduleFor(e, region()); return s && REM_ENGINE.isFrequent(s); }).length;
    $('rem-starred').textContent = starred.length
      ? `${starred.length} starred ${starred.length === 1 ? 'event' : 'events'} in ${REGION.get(region()).name}${hourly ? `, ${hourly} of them hourly${rem.hourly ? '' : ' (left out unless you tick hourly events)'}` : ''}.`
      : 'No starred events yet. Star an event (the star by its name) to be reminded of it.';
  }

  function remChanged() { saveRem(); renderRemindersUi(); syncControls(); checkReminders(nowMs()); }

  $('rem-on').addEventListener('change', (ev) => { rem.on = ev.target.checked; remChanged(); });
  $('rem-lead').addEventListener('change', (ev) => { rem.lead = Number(ev.target.value); remChanged(); });
  $('rem-hourly').addEventListener('change', (ev) => { rem.hourly = ev.target.checked; remChanged(); });
  $('rem-notify').addEventListener('change', async (ev) => {
    if (!ev.target.checked) { rem.notify = false; remChanged(); return; }
    // Asked only here, from the reader's own click; never on load.
    let p = notifyState();
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
    rem.notify = p === 'granted';
    remChanged();
  });

  // ---- Your checklist: tasks the reader ticks, cleared at the region's resets ----

  // Ticks are stored under the reset period they belong to (js/checklist.js), so nothing runs at a
  // reset: the next rebuild simply finds the new period unticked. The list is rebuilt only when the
  // region, a period, the display zone or the list itself changes, never on the one-second tick.
  const CL = window.WoWChecklist;
  const CL_KEY = Store.editionKey('checklist', EDITION);
  const CL_ENGINE = { previousReset: S.previousReset, nextReset: S.nextReset };
  const KIND_NAME = { daily: 'Daily', weekly: 'Weekly' };
  let checklist = CL.defaults(), clEditing = false, clRev = 0, clKey = '';
  {
    const saved = Store.read(storage, CL_KEY);
    checklist = CL.prune(CL.sanitize(saved), Date.now()); // ticks from long ago are dropped on load
    if (saved && JSON.stringify(saved) !== JSON.stringify(checklist)) Store.write(storage, CL_KEY, checklist);
  }
  const clPeriods = (now) => CL.periods(DATA.resets, region(), now, CL_ENGINE);
  const random = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const clSay = (msg) => { $('cl-status').textContent = msg; };

  function saveChecklist(next) {
    checklist = next;
    clRev++;
    if (!Store.write(storage, CL_KEY, checklist)) clSay('This browser is not saving right now, so the list lasts only until the page is closed.');
    renderChecklist(true);
  }

  function countText(pr) {
    const parts = [];
    if (pr.daily.total) parts.push(`${pr.daily.done} of ${pr.daily.total} today`);
    if (pr.weekly.total) parts.push(`${pr.weekly.done} of ${pr.weekly.total} this week`);
    return parts.join(' · ') || 'No tasks yet';
  }

  function taskRow(t, per) {
    const key = `cl:${t.id}`;
    if (clEditing) {
      return h('li', { class: 'cl-task is-editing' },
        h('input', { type: 'text', class: 'cl-rename', value: t.name, maxlength: CL.MAX_NAME, 'data-rename': t.id, 'data-fkey': `${key}:name`, 'aria-label': `Name of the task ${t.name}`, autocomplete: 'off', spellcheck: 'false' }),
        h('select', { 'data-kind-of': t.id, 'data-fkey': `${key}:kind`, 'aria-label': `${t.name} repeats` },
          CL.KINDS.map((k) => h('option', { value: k, selected: k === t.kind, text: KIND_NAME[k] }))),
        h('button', { type: 'button', class: 'btn small', 'data-delete': t.id, 'data-fkey': `${key}:delete`, 'aria-label': `Delete ${t.name}`, text: 'Delete' }));
    }
    const done = CL.isDone(checklist, t, per);
    return h('li', { class: done ? 'cl-task is-done' : 'cl-task' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-task': t.id, 'data-fkey': `${key}:tick`, checked: done }), h('span', { class: 'cl-name', text: t.name })));
  }

  function taskGroup(kind, per, pr) {
    const tasks = checklist.tasks.filter((t) => t.kind === kind);
    return h('div', { class: 'cl-group', 'data-kind': kind },
      h('h3', {}, KIND_NAME[kind], tasks.length ? h('span', { class: 'cl-n', text: `${pr[kind].done} of ${pr[kind].total}` }) : null,
        h('span', { class: 'cl-clears', text: `clears ${at(per[kind].end, kind === 'daily' ? 'wday' : 'full')}` })),
      tasks.length ? h('ul', { class: 'cl-list' }, tasks.map((t) => taskRow(t, per))) : h('p', { class: 'cl-none', text: `No ${kind} tasks.` }));
  }

  function renderChecklist(force) {
    const now = nowMs(), per = clPeriods(now), open = prefs.checklistOpen;
    const key = [region(), per.daily.key, per.weekly.key, clRev, clEditing, open, formats().zone, formats().local].join('|');
    if (!force && key === clKey) return;
    clKey = key;
    const focusKey = document.activeElement && document.activeElement.getAttribute('data-fkey');
    const pr = CL.progress(checklist, per), any = checklist.tasks.length > 0;
    if (!any) clEditing = false;
    $('checklist-count').textContent = countText(pr);
    $('checklist').classList.toggle('is-open', open);
    $('checklist-body').hidden = !open;
    $('cl-toggle').textContent = open ? 'Hide' : 'Show';
    $('cl-toggle').setAttribute('aria-expanded', String(open));
    $('cl-edit').hidden = !open || !any;
    $('cl-edit').textContent = clEditing ? 'Done' : 'Edit';
    $('cl-edit').setAttribute('aria-pressed', String(clEditing));
    $('checklist-note').textContent = `Ticks are yours: the game is not read, so finishing something in game does not tick it here. They clear at the ${REGION.get(region()).name} daily and weekly resets; each region keeps its own.`;
    $('checklist-groups').replaceChildren(...(any ? CL.KINDS.map((k) => taskGroup(k, per, pr)) : [h('p', { class: 'cl-empty', text: 'No tasks yet. Add your own below, or start from Suggestions.' })]));
    if (focusKey) { const el = document.querySelector(`#checklist [data-fkey="${CSS.escape(focusKey)}"]`); if (el) el.focus(); }
  }

  function addTask() {
    const input = $('cl-name'), kind = $('cl-kind').value, name = CL.cleanName(input.value);
    const r = CL.add(checklist, input.value, kind, random);
    if (r.error) {
      clSay({ empty: 'Type a name for the task first.', full: `The list is full (${CL.MAX_TASKS} tasks). Delete one to add another.`, exists: `"${name}" is already on your ${kind} list.`, kind: 'Choose Daily or Weekly.' }[r.error]);
      input.focus();
      return;
    }
    input.value = '';
    saveChecklist(r.list);
    clSay(`Added "${name}" (${kind}).`);
    input.focus();
  }

  function deleteTask(id) {
    const i = checklist.tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const name = checklist.tasks[i].name;
    saveChecklist(CL.remove(checklist, id));
    clSay(`Deleted "${name}".`);
    // Focus moves to the next task's Delete, or the one before, or Done.
    const rest = document.querySelectorAll('#checklist [data-delete]');
    (rest[Math.min(i, rest.length - 1)] || ($('cl-edit').hidden ? $('cl-name') : $('cl-edit'))).focus();
  }

  /** A tick, a rename or a move to the other kind, from a control in the list. */
  function checklistChange(t) {
    const a = (n) => t.getAttribute(n);
    if (a('data-task')) { clSay(''); saveChecklist(CL.tick(checklist, a('data-task'), t.checked, clPeriods(nowMs()))); return; }
    const id = a('data-rename') || a('data-kind-of');
    if (!id) return;
    const r = CL.edit(checklist, id, a('data-rename') ? { name: t.value } : { kind: t.value });
    if (r.error) {
      const task = checklist.tasks.find((x) => x.id === id);
      clSay({ empty: 'A task needs a name; it was left as it was.', exists: 'That name is already on that list; it was left as it was.' }[r.error] || '');
      if (a('data-rename')) t.value = task ? task.name : t.value; else if (task) t.value = task.kind;
      return;
    }
    clSay('');
    saveChecklist(r.list);
  }
  $('checklist').addEventListener('change', (ev) => checklistChange(ev.target));
  $('cl-name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTask(); } });
  // Enter in a name being edited saves it at once (as leaving the box does).
  $('checklist').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('.cl-rename')) { ev.preventDefault(); checklistChange(ev.target); } });

  // Suggestions: optional starter tasks, added only when picked.
  function renderSuggest() {
    $('suggest-groups').replaceChildren(...CL.KINDS.map((kind) => h('fieldset', { class: 'suggest-group' },
      h('legend', { text: KIND_NAME[kind] }),
      CL.TEMPLATES.filter((x) => x.kind === kind).map((tpl) => {
        const has = CL.hasTemplate(checklist, tpl);
        return h('label', { class: has ? 'check is-added' : 'check' },
          h('input', { type: 'checkbox', 'data-template': tpl.id, checked: has, disabled: has }),
          h('span', {}, tpl.name, has ? h('span', { class: 'suggest-has', text: ' (on your list)' }) : null));
      }))));
    suggestButton();
  }
  const pickedTemplates = () => [...document.querySelectorAll('#suggest-groups [data-template]:checked:not(:disabled)')].map((x) => CL.TEMPLATES.find((tpl) => tpl.id === x.getAttribute('data-template')));
  function suggestButton() {
    const n = pickedTemplates().length, b = $('suggest-add');
    b.disabled = !n;
    b.textContent = n ? `Add ${n} ${n === 1 ? 'task' : 'tasks'}` : 'Add selected';
  }
  $('suggest-dialog').addEventListener('change', suggestButton);
  function addSuggested() {
    let list = checklist, added = 0, full = false;
    for (const tpl of pickedTemplates()) {
      const r = CL.add(list, tpl.name, tpl.kind, random);
      if (r.error === 'full') { full = true; break; }
      if (!r.error) { list = r.list; added++; }
    }
    if (!prefs.checklistOpen) { prefs.checklistOpen = true; savePrefs(); }
    $('suggest-dialog').close();
    saveChecklist(list);
    clSay(`Added ${added} ${added === 1 ? 'task' : 'tasks'}.${full ? ` The list is full at ${CL.MAX_TASKS}.` : ''}`);
  }

  // ---- Settings backup: one line of text the reader keeps; restored only after a confirmation ----

  const Backup = window.WoWBackup;
  const backupClean = {
    prefs: (raw) => Store.sanitizePrefs(raw, EVENTS.map((e) => e.id), CATEGORIES.map((c) => c.id), deviceZone()),
    reminders: (raw) => Rem.sanitize(raw),
    checklist: (raw) => CL.sanitize(raw),
  };
  let pendingBackup = null;

  function settingsSummary(p, r, c) {
    const n = c.tasks.length;
    return [REGION.get(p.region).name, `${p.starred.length} starred`, `${p.hidden.length} hidden`, r.on ? `reminders ${r.lead} min before` : 'reminders off',
      n ? `${n} checklist ${n === 1 ? 'task' : 'tasks'}` : 'no checklist tasks'].join(' · ');
  }
  const backupText = () => Backup.make({ prefs, reminders: rem, checklist: CL.prune(checklist, nowMs()), edition: EDITION, version: APP_VERSION, now: nowMs() });

  function renderBackup() {
    $('backup-what').textContent = `This browser now: ${settingsSummary(prefs, rem, checklist)}.`;
    $('backup-out').value = backupText();
    pendingBackup = null;
    $('backup-result').replaceChildren();
  }

  async function copyBackup() {
    const text = backupText(), out = $('backup-out');
    out.value = text;
    try { await navigator.clipboard.writeText(text); toast('Backup copied. Keep it somewhere safe, such as a note or an email to yourself.'); } catch (e) { out.focus(); out.select(); toast('Copying is not allowed here: the backup is selected in the box, so copy it from there.'); }
  }

  function downloadBackup() {
    const name = `wowtracker-settings-${fileDay(nowMs())}.json`;
    saveFile(name, backupText(), 'application/json');
    toast(`Saved ${name}. Open a file under Restore to bring it back.`);
  }

  function checkBackup(text) {
    const r = Backup.read(text, backupClean, EDITION), out = $('backup-result');
    pendingBackup = null;
    if (!r.ok) { out.replaceChildren(h('p', { class: 'backup-error', text: `${Backup.ERRORS[r.error]} Nothing was changed.` })); return; }
    pendingBackup = r.data;
    const d = r.data, lost = r.dropped.starred + r.dropped.hidden;
    out.replaceChildren(...[
      h('p', {}, h('strong', { text: 'This backup can be restored. ' }), r.saved ? `Made ${at(r.saved, 'full')}${r.version ? ` with v${r.version}` : ''}. ` : '', `It holds: ${settingsSummary(d.prefs, d.reminders, d.checklist)}.`),
      lost || r.dropped.tasks ? h('p', { text: [lost ? `${lost} starred or hidden ${lost === 1 ? 'event is' : 'events are'} not in this version's schedule data and will be left out.` : '', r.dropped.tasks ? `${r.dropped.tasks} damaged checklist ${r.dropped.tasks === 1 ? 'task' : 'tasks'} will be left out.` : ''].filter(Boolean).join(' ') }) : null,
      h('p', { text: `Restoring replaces what this browser has now (${settingsSummary(prefs, rem, checklist)}).` }),
      h('p', { class: 'backup-actions' },
        h('button', { type: 'button', class: 'btn small', id: 'backup-apply', text: 'Replace my settings' }),
        h('button', { type: 'button', class: 'btn small', id: 'backup-cancel', text: 'Cancel' }))].filter(Boolean));
    $('backup-apply').focus();
  }

  function cancelBackup() {
    pendingBackup = null;
    $('backup-result').replaceChildren(h('p', { text: 'Nothing was changed.' }));
    $('backup-check').focus();
  }

  function applyBackup() {
    if (!pendingBackup) return;
    const d = pendingBackup;
    pendingBackup = null;
    prefs = d.prefs;
    rem = d.reminders;
    checklist = CL.prune(d.checklist, nowMs());
    clRev++;
    const saved = [Store.write(storage, 'prefs', prefs), Store.write(storage, 'reminders', rem), Store.write(storage, CL_KEY, checklist)].every(Boolean);
    $('backup-in').value = '';
    syncControls();
    render(true);
    renderChecklist(true);
    renderNews();
    if (!prefs.newsCollapsed && !newsState.items.length) loadNews();
    checkReminders(nowMs());
    $('backup-what').textContent = `This browser now: ${settingsSummary(prefs, rem, checklist)}.`;
    $('backup-out').value = backupText();
    $('backup-result').replaceChildren(h('p', { text: saved ? 'Restored: settings, stars, hidden events, reminders and the checklist.' : 'Restored for this visit, but this browser is not saving right now, so it lasts only until the page is closed.' }));
    $('backup-check').focus();
  }

  $('backup-in').addEventListener('input', () => { if (pendingBackup || $('backup-result').childNodes.length) { pendingBackup = null; $('backup-result').replaceChildren(); } });
  $('backup-file').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // the same file can be opened again
    if (!file) return;
    if (file.size > Backup.MAX_CHARS * 4) { $('backup-result').replaceChildren(h('p', { class: 'backup-error', text: `${Backup.ERRORS['too-big']} Nothing was changed.` })); return; }
    let text = '';
    try { text = await file.text(); } catch (e) { $('backup-result').replaceChildren(h('p', { class: 'backup-error', text: 'That file could not be read. Nothing was changed.' })); return; }
    $('backup-in').value = text.length > Backup.MAX_CHARS ? '' : text;
    checkBackup(text);
  });

  // ---- Footer, About and the untracked list ----

  function renderMeta() {
    const m = DATA.meta, L = CONFIG.links;
    const links = [];
    if (L.labs) links.push(h('a', { href: L.labs, text: 'RadMage Labs' }));
    if (L.github) links.push(h('a', { href: L.github, target: '_blank', rel: 'noopener', text: 'GitHub' }));
    links.push(h('button', { type: 'button', class: 'link-btn', id: 'share-btn', text: 'Share' }));
    links.push(h('button', { type: 'button', class: 'link-btn', id: 'backup-btn', 'aria-haspopup': 'dialog', text: 'Back up settings' }));
    if (L.feedback) links.push(h('a', { href: L.feedback, target: '_blank', rel: 'noopener', text: 'Feedback' }));
    if (L.coffee) links.push(h('a', { href: L.coffee, target: '_blank', rel: 'noopener', text: 'Buy me a coffee' }));
    $('footer-links').replaceChildren(...links);
    if (!L.labs) $('labs-link').removeAttribute('href');
    $('revision').textContent = `Schedule data r${m.datasetRevision} · patch ${m.patch} · reviewed ${isoDay(m.reviewedOn)}`;
    const predicted = EVENTS.filter((e) => e.status === 'predicted').length;
    const timeOnly = EVENTS.filter((e) => e.status === 'confirmed' && Object.values(e.schedules).some((s) => s.status === 'predicted')).length;
    $('about-data').textContent = `Schedule data r${m.datasetRevision}, reviewed ${isoDay(m.reviewedOn)} for patch ${m.patch} (game build ${m.clientBuild}), covering dates through ${isoDay(m.coversUntil)}. `
      + `${EVENTS.length} events: ${EVENTS.length - predicted} confirmed and ${predicted} predicted. For ${timeOnly} of the confirmed ones the start time on European realms is predicted. Each one names its source and the date it was last checked.`;
    $('untracked').textContent = DATA.untracked.length
      ? 'Not shown as times, because no verified schedule exists: ' + DATA.untracked.map((u) => `${u.name} (${u.reason})`).join('; ') + '.'
      : '';
  }

  // ---- News (isolated: nothing here can stop the timers) ----

  // Open by default, under the resets. Saved headlines show at once; a newer copy is asked for only
  // after the dashboard has drawn, and never while news is collapsed. The list is rebuilt only when
  // the headlines or a news setting change, never on the one-second tick.
  let newsState = { items: [], fetchedAt: null, status: 'idle' };
  function renderNews() {
    try {
      const open = !prefs.newsCollapsed, toggle = $('news-toggle'), more = $('news-all');
      toggle.textContent = open ? 'Collapse' : 'Show news';
      toggle.setAttribute('aria-expanded', String(open));
      $('news').classList.toggle('is-collapsed', !open);
      $('news-body').hidden = !open;
      if (!open) { more.hidden = true; return; }
      const when = newsState.fetchedAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(newsState.fetchedAt) : '';
      const home = h('a', { href: News.BLIZZARD_NEWS, target: '_blank', rel: 'noopener noreferrer', text: 'Blizzard News' });
      const note = {
        idle: [], loading: ['Loading headlines...'],
        ok: ['From ', home, `, updated ${when}.`],
        stale: [`Blizzard did not answer; these are the headlines saved ${when}. `, home],
        failed: ['Headlines cannot load here. Read them on ', home, '.'],
      }[newsState.status];
      $('news-note').replaceChildren(...note);
      const all = News.visible(newsState.items, prefs.newsShop);
      const rows = News.shown(newsState.items, prefs.newsShop, prefs.newsAll).map((i) => h('li', {},
        i.dateMs ? h('time', { datetime: new Date(i.dateMs).toISOString(), text: formats().newsDay.format(i.dateMs) }) : h('span', { class: 'no-date' }),
        h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer' }, i.title, h('span', { class: 'sr-only', text: ' (opens a new tab)' })),
        i.category ? h('span', { class: 'cat', text: i.category }) : null));
      // While the first copy loads, three empty lines hold the space so nothing below jumps.
      if (!rows.length && newsState.status === 'loading') for (let n = 0; n < News.PREVIEW; n++) rows.push(h('li', { class: 'ph', 'aria-hidden': 'true' }));
      $('news-list').replaceChildren(...rows);
      more.hidden = all.length <= News.PREVIEW;
      more.textContent = prefs.newsAll ? 'Show fewer' : `Show all ${all.length}`;
      more.setAttribute('aria-expanded', String(prefs.newsAll));
      // Store posts are left out by default; the button says how many and brings them back.
      const shop = newsState.items.slice(0, News.KEEP_ITEMS).filter(News.isShop).length;
      $('news-shop').hidden = !shop && !prefs.newsShop;
      $('news-shop').textContent = prefs.newsShop ? 'Hide shop posts' : `Show ${shop} shop ${shop === 1 ? 'post' : 'posts'}`;
      $('news-shop').setAttribute('aria-pressed', String(prefs.newsShop));
    } catch (e) { /* the news section never breaks the page */ }
  }

  /** Only where config.js says news.json is passed through; elsewhere it would only ever be a 404. */
  const newsHere = () => News.canAsk(location.protocol, location.hostname, CONFIG.newsHosts);

  /** The saved copy, shown before anything is asked for (it may be old; loadNews decides). */
  function seedNews() {
    try {
      const cache = News.sanitizeCache(Store.read(storage, 'news'));
      if (cache) newsState = { items: cache.items, fetchedAt: cache.fetchedAt, status: 'ok' };
      // With nothing saved, the first paint already holds the space the headlines will take.
      else newsState.status = newsHere() ? 'loading' : 'failed';
    } catch (e) { /* no saved copy */ }
  }

  let newsBusy = false, newsTried = -Infinity;
  /** The first load waits until the browser is idle after drawing the dashboard. */
  function scheduleNews() {
    if (prefs.newsCollapsed) return;
    newsTried = Date.now();
    const go = () => loadNews();
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 200);
  }

  async function loadNews() {
    if (newsBusy || prefs.newsCollapsed) return;
    newsBusy = true;
    newsTried = Date.now();
    try {
      const cache = News.sanitizeCache(Store.read(storage, 'news'));
      if (cache) newsState = { items: cache.items, fetchedAt: cache.fetchedAt, status: 'ok' };
      if (cache && News.isFresh(cache, Date.now())) { renderNews(); return; }
      if (!newsHere()) { newsState.status = newsState.items.length ? 'stale' : 'failed'; renderNews(); return; }
      newsState.status = newsState.items.length ? 'ok' : 'loading'; renderNews();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), News.TIMEOUT_MS);
      let items = [];
      try {
        const res = await fetch(News.NEWS_PATH, { credentials: 'omit', cache: 'no-store', signal: ctl.signal });
        if (res.ok) items = News.parseNews(await res.json());
      } finally { clearTimeout(timer); }
      if (items.length) {
        const fresh = { fetchedAt: Date.now(), items };
        Store.write(storage, 'news', fresh);
        newsState = { items, fetchedAt: fresh.fetchedAt, status: 'ok' };
      } else newsState.status = newsState.items.length ? 'stale' : 'failed';
    } catch (e) {
      newsState.status = newsState.items.length ? 'stale' : 'failed';
    } finally { newsBusy = false; }
    renderNews();
  }

  // ---- Clock check against this site's own address (skipped when opened from a file) ----

  async function sampleClock() {
    const url = new URL(location.href);
    url.hash = '';
    url.searchParams.set('clock', String(Date.now()));
    const sentMs = Date.now();
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    return { sentMs, receivedMs: Date.now(), date: res.headers.get('Date'), age: res.headers.get('Age') };
  }
  let clockBusy = false, lastCheck = -Infinity;
  async function checkClock(minGapMs) {
    if (!/^https?:$/.test(location.protocol) || clockBusy || performance.now() - lastCheck < (minGapMs || 0)) return;
    clockBusy = true; lastCheck = performance.now();
    const before = clockOffset;
    try {
      const first = await sampleClock();
      await new Promise((ok) => setTimeout(ok, Clock.SAMPLE_GAP_MS));
      const est = Clock.estimateClock([first, await sampleClock()]);
      clockOffset = est ? est.offsetMs : 0;
      const n = $('clock-notice');
      n.hidden = !(est && est.applied);
      if (est && est.applied) n.textContent = `Your device clock is ${S.duration(Math.abs(est.offsetMs))} ${est.offsetMs > 0 ? 'slow' : 'fast'}; the times here are corrected for it.`;
    } catch (e) { /* no correction: the device clock is used as it is */ }
    finally { clockBusy = false; }
    if (clockOffset !== before) render(true);
  }

  // ---- Ticking: in step with whole seconds; recheck the clock after sleep or a clock change ----

  let timer = 0, lastWall = Date.now(), lastSteady = performance.now();
  function tick() {
    const wall = Date.now(), steady = performance.now();
    const resumed = Clock.detectResume(lastWall, lastSteady, wall, steady);
    if (resumed) checkClock(resumed === 'clock-jump' ? 5000 : 60000);
    lastWall = wall; lastSteady = steady;
    render(Boolean(resumed));
    checkReminders(nowMs()); // after sleep or a clock change too: what has started is never shown late
    if (!prefs.newsCollapsed && Date.now() - newsTried > News.REFRESH_MS) loadNews();
    timer = setTimeout(tick, 1000 - (nowMs() % 1000) + 5);
  }
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); tick(); });

  syncControls();
  renderMeta();
  seedNews();
  renderNews();
  render(true);
  scheduleNews(); // before the first tick, so the tick does not ask for news ahead of the dashboard
  tick();
  checkClock(0);
  setInterval(() => checkClock(60000), 6 * 3600000);
})();
