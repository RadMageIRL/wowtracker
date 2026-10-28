// WoW Tracker page. Reads the generated dataset (events-data.js), the links in config.js and the pure
// helpers in schedule.js, store.js, news.js and clock.js; everything here is display and input. The
// DOM is built with createElement only: no outside text is ever parsed as HTML.
(function () {
  'use strict';

  const S = window.WoWSchedule, Store = window.WoWStore, News = window.WoWNews, Clock = window.WoWClock;
  const DATA = window.WOW_DATA, CONFIG = window.WoWConfig;
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

  function shown() {
    const cats = new Set(prefs.categories), hidden = new Set(prefs.hidden), starred = new Set(prefs.starred);
    return EVENTS.filter((e) => !hidden.has(e.id) && cats.has(e.category) && (prefs.filter === 'all' || starred.has(e.id)));
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
      h('div', { class: 'event-head' }, star(e, key), h('h3', { text: nameOf(item) }), h('span', { class: 'pill', text: 'Scheduled now' })),
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
        h('div', { class: 'line1' }, star(e, key), h('span', { class: 'name', text: nameOf(item) }), badges(e)),
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
        h('span', { class: 'name', text: nameOf(i) }),
        predictedBadge(statusFor(i.event)),
        h('span', { class: 'span', text: when + (live ? ' · on now' : '') }));
    });
    if (!li.length) li.push(h('li', { class: 'none', text: 'Nothing you follow is scheduled.' }));
    return h('div', { class: 'week-col' },
      h('h3', {}, title, ' ', h('span', { class: 'dates', text: `${at(from, 'wdate')} to ${at(to, 'wdate')}` })),
      h('ul', { class: 'week-list' }, li));
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
    const months = new Map();
    for (const i of items) {
      const k = S.dayKey(Math.max(i.start, now), z).slice(0, 7);
      if (!months.has(k)) months.set(k, { label: at(Math.max(i.start, now), 'month'), items: [] });
      months.get(k).items.push(i);
    }
    return [...months.values()].map((m) => h('div', { class: 'month' },
      h('h3', { text: m.label }),
      h('ol', { class: 'agenda' }, m.items.map((i) => {
        const live = i.start <= now && now < i.end;
        return h('li', { class: live ? 'is-now' : null, 'data-cat': i.event.category, 'data-id': i.event.id },
          h('span', { class: 'dates', text: span(i.start, i.end) }),
          h('span', { class: 'what' },
            h('span', { class: 'name', text: nameOf(i) }), badges(i.event),
            h('span', { class: 'sub', text: live ? `on now, ends ${at(i.end, 'full')}` : `starts ${at(i.start, 'full')}` })));
      }))));
  }

  // ---- Render: a full rebuild only when what is listed changes; countdown text every second ----

  let lastKey = '';
  function structureKey(now, list, nowItems, nextItems, nextItem) {
    const rs = resets();
    return [prefs.region, prefs.filter, prefs.categories.join(), prefs.starred.join(), prefs.hidden.join(), prefs.aheadHours, prefs.compact, prefs.timeMode,
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
      $('now-empty').hidden = nowItems.length > 0;
      const starred = new Set(prefs.starred);
      const top = prefs.filter === 'starred' ? [] : nextItems.filter((i) => starred.has(i.event.id));
      const rest = prefs.filter === 'starred' ? nextItems : nextItems.filter((i) => !starred.has(i.event.id));
      const rows = [];
      if (top.length) rows.push(h('li', { class: 'group', text: 'Starred' }), ...rowsWithDays(top, now), h('li', { class: 'group', text: 'Everything else' }));
      rows.push(...rowsWithDays(rest, now));
      $('next-list').replaceChildren(...rows);
      const empty = $('next-empty');
      empty.hidden = nextItems.length > 0;
      if (!nextItems.length) {
        empty.textContent = `Nothing you follow starts in the next ${aheadText(prefs.aheadHours)}.`
          + (nextItem ? ` Next: ${nextItem.event.name}, ${at(nextItem.start, 'full')}.` : '');
      }
      $('coming-hint').textContent = `next ${aheadText(prefs.aheadHours)}, ${zoneName() === 'UTC' ? 'in UTC' : `your time (${zoneName()})`}`;
      $('week-grid').replaceChildren(...weekGrid(list, now));
      $('week-hint').textContent = `${REGION.get(region()).name} reset weeks`;
      const months = calendarMonths(list, now);
      $('calendar').replaceChildren(...(months.length ? months : [h('p', { class: 'empty', text: 'Nothing you follow is on the calendar.' })]));
      $('calendar-hint').textContent = `through ${isoDay(DATA.meta.coversUntil)}`;
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
    if (a('data-region')) { prefs.region = a('data-region'); changed(); }
    else if (a('data-filter')) { prefs.filter = a('data-filter'); changed(); }
    else if (a('data-category')) { prefs.categories = toggleIn(prefs.categories, a('data-category')); changed(); }
    else if (a('data-star')) { prefs.starred = toggleIn(prefs.starred, a('data-star')); changed(); }
    else if (a('data-hide')) {
      const e = BY_ID.get(a('data-hide'));
      prefs.hidden = toggleIn(prefs.hidden, e.id); changed();
      toast(`${e.name} is hidden. Show it again from Hidden.`);
      $('coming-title').focus();
    } else if (a('data-unhide')) { prefs.hidden = prefs.hidden.filter((x) => x !== a('data-unhide')); changed(); renderHidden(); }
    else if (t.id === 'unhide-all') { prefs.hidden = []; changed(); renderHidden(); }
    else if (t.id === 'compact-btn') { prefs.compact = !prefs.compact; changed(); }
    else if (t.id === 'theme-btn') { prefs.theme = { dark: 'light', light: 'system', system: 'dark' }[prefs.theme]; changed(); }
    else if (t.id === 'about-btn') $('about').showModal();
    else if (t.id === 'hidden-btn') { renderHidden(); $('hidden-dialog').showModal(); }
    else if (t.id === 'news-toggle') { prefs.newsOpen = !prefs.newsOpen; savePrefs(); renderNews(); if (prefs.newsOpen) loadNews(); }
    else if (t.id === 'share-btn') share();
    else if (a('data-close') !== null) t.closest('dialog').close();
  });

  $('ahead').addEventListener('change', (ev) => { prefs.aheadHours = Number(ev.target.value); changed(); });
  $('time-mode').addEventListener('change', (ev) => { prefs.timeMode = ev.target.value; changed(); });
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // a click on the backdrop closes it
  }
  // Another tab of this page changed the settings: follow it.
  window.addEventListener('storage', (ev) => {
    if (ev.key !== Store.PREFIX + 'prefs') return;
    prefs = Store.sanitizePrefs(Store.read(storage, 'prefs'), EVENTS.map((e) => e.id), CATEGORIES.map((c) => c.id), deviceZone());
    syncControls(); render(true); renderNews();
  });

  function renderHidden() {
    const items = prefs.hidden.map((id) => BY_ID.get(id)).filter(Boolean);
    $('hidden-list').replaceChildren(...items.map((e) => h('li', {},
      h('span', { text: `${e.name} (${CATEGORY.get(e.category).name})` }),
      h('button', { type: 'button', class: 'btn small', 'data-unhide': e.id, 'aria-label': `Show ${e.name} again`, text: 'Show' }))));
    $('hidden-empty').hidden = items.length > 0;
    $('unhide-all').hidden = items.length < 2;
  }

  // ---- Footer, About and the untracked list ----

  function renderMeta() {
    const m = DATA.meta, L = CONFIG.links;
    const links = [];
    if (L.labs) links.push(h('a', { href: L.labs, text: 'RadMage Labs' }));
    if (L.github) links.push(h('a', { href: L.github, target: '_blank', rel: 'noopener', text: 'GitHub' }));
    links.push(h('button', { type: 'button', class: 'link-btn', id: 'share-btn', text: 'Share' }));
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

  let newsState = { items: [], fetchedAt: null, status: 'idle' };
  function renderNews() {
    try {
      const open = prefs.newsOpen;
      $('news-toggle').textContent = open ? 'Hide' : 'Show';
      $('news-toggle').setAttribute('aria-expanded', String(open));
      $('news-body').hidden = !open;
      if (!open) return;
      const when = newsState.fetchedAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(newsState.fetchedAt) : '';
      const home = h('a', { href: News.BLIZZARD_NEWS, target: '_blank', rel: 'noopener noreferrer', text: 'Blizzard News' });
      const note = {
        idle: [], loading: ['Loading headlines...'],
        ok: [`From `, home, `, updated ${when}.`],
        stale: [`Blizzard did not answer; these are the headlines saved ${when}. `, home],
        failed: ['Headlines cannot load here. Read them on ', home, '.'],
      }[newsState.status];
      $('news-note').replaceChildren(...note);
      $('news-list').replaceChildren(...newsState.items.map((i) => h('li', {},
        h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer', text: i.title }),
        h('span', { class: 'meta' }, i.category ? `${i.category} · ` : '', i.dateMs ? h('time', { datetime: new Date(i.dateMs).toISOString(), text: formats().newsDay.format(i.dateMs) }) : ''))));
    } catch (e) { /* the news section never breaks the page */ }
  }

  let newsBusy = false, newsTried = -Infinity;
  async function loadNews() {
    if (newsBusy) return;
    newsBusy = true;
    newsTried = Date.now();
    try {
      const cache = News.sanitizeCache(Store.read(storage, 'news'));
      if (cache) newsState = { items: cache.items, fetchedAt: cache.fetchedAt, status: 'ok' };
      if (cache && News.isFresh(cache, Date.now())) { renderNews(); return; }
      if (!/^https?:$/.test(location.protocol)) { newsState.status = newsState.items.length ? 'stale' : 'failed'; renderNews(); return; }
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
    if (prefs.newsOpen && Date.now() - newsTried > News.REFRESH_MS) loadNews();
    timer = setTimeout(tick, 1000 - (nowMs() % 1000) + 5);
  }
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); tick(); });

  syncControls();
  renderMeta();
  render(true);
  tick();
  renderNews();
  if (prefs.newsOpen) loadNews();
  checkClock(0);
  setInterval(() => checkClock(60000), 6 * 3600000);
})();
