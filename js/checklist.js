// Your checklist: daily and weekly tasks the reader writes and ticks. Pure, so the page and the Node
// tests share it. Nothing is read from the game, so a tick only says the reader ticked it.
//
// A tick is stored under the reset period it belongs to ("us:weekly:2026-11-03T15:00Z"), the latest
// reset at or before now from the dataset's own reset rules, worked out by the schedule engine. When
// the period changes, the task is simply unticked: nothing has to run at the reset, so a closed tab,
// a sleeping laptop or a month away cannot miss it. Tasks are shared by both regions; ticks are kept
// per region, because the regions reset at different times. The reset rules and the engine are passed
// in, so a later edition keeps its own list under its own storage key with its own rules.
(function (root) {
  'use strict';

  const KINDS = ['daily', 'weekly'];
  const MAX_TASKS = 40, MAX_NAME = 60;
  const DAY = 86400000;
  /** Ticks of a period that began longer ago than this are dropped (two weeks and a day). */
  const KEEP_MS = 15 * DAY;
  const PERIOD = /^([a-z]{2}):(daily|weekly):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})Z$/;
  const ID = /^[a-z0-9]{1,16}$/;

  /**
   * Optional suggestions, added only when the reader picks them. Each is common in Retail, but not
   * every one fits every character, and none is checked against the game.
   */
  const TEMPLATES = [
    { id: 'vault-claim', kind: 'weekly', name: 'Claim the Great Vault' },
    { id: 'vault-fill', kind: 'weekly', name: 'Great Vault: raid, dungeon and world rows' },
    { id: 'mythic-plus', kind: 'weekly', name: 'Mythic+ dungeons' },
    { id: 'raid', kind: 'weekly', name: 'Raid: this week\'s bosses' },
    { id: 'delves', kind: 'weekly', name: 'Bountiful Delves' },
    { id: 'world-boss', kind: 'weekly', name: 'This week\'s world boss' },
    { id: 'bonus-quest', kind: 'weekly', name: 'This week\'s bonus event quest' },
    { id: 'prey', kind: 'weekly', name: 'Prey Hunts' },
    { id: 'profession-weekly', kind: 'weekly', name: 'Profession weekly quests' },
    { id: 'trading-post', kind: 'weekly', name: 'Trading Post: this month\'s activities' },
    { id: 'world-quests', kind: 'daily', name: 'World quests' },
    { id: 'daily-quests', kind: 'daily', name: 'Daily quests' },
    { id: 'profession-cooldowns', kind: 'daily', name: 'Profession cooldowns' },
  ];

  /** An empty list: no task is ever added on its own. */
  const defaults = () => ({ tasks: [], done: {} });

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** A task name as plain text: no control characters, single spaces, at most MAX_NAME characters. */
  function cleanName(v) {
    if (typeof v !== 'string') return '';
    return [...v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_NAME).join('').trim();
  }
  /** Same name, ignoring case and spacing: two such tasks of one kind would be one task. */
  const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

  /** A saved list, checked: what is malformed is dropped, the rest kept. */
  function sanitize(raw) {
    const out = defaults();
    if (!isObj(raw)) return out;
    const ids = new Set();
    for (const t of Array.isArray(raw.tasks) ? raw.tasks : []) {
      if (out.tasks.length >= MAX_TASKS) break;
      if (!isObj(t) || typeof t.id !== 'string' || !ID.test(t.id) || ids.has(t.id) || !KINDS.includes(t.kind)) continue;
      const name = cleanName(t.name);
      if (!name || out.tasks.some((x) => x.kind === t.kind && sameName(x.name, name))) continue;
      ids.add(t.id);
      out.tasks.push({ id: t.id, name, kind: t.kind });
    }
    if (isObj(raw.done)) {
      for (const k of Object.keys(raw.done)) {
        const m = PERIOD.exec(k), v = raw.done[k];
        if (!m || !Number.isFinite(Date.parse(m[3] + 'Z')) || !Array.isArray(v)) continue;
        const kind = m[2], ticked = [...new Set(v.filter((id) => typeof id === 'string' && ids.has(id) && out.tasks.some((t) => t.id === id && t.kind === kind)))];
        if (ticked.length) out.done[k] = ticked;
      }
    }
    return out;
  }

  const periodKey = (region, kind, startMs) => `${region}:${kind}:${new Date(startMs).toISOString().slice(0, 16)}Z`;

  /**
   * The daily and weekly periods that contain now in a region: { daily: { key, start, end }, weekly }.
   * resets: the dataset's resets ({ us: { daily: { rule }, weekly: { rule } }, eu: ... }).
   * engine: { previousReset(rule, now), nextReset(rule, now) }, the schedule engine.
   */
  function periods(resets, region, now, engine) {
    const out = {};
    for (const kind of KINDS) {
      const rule = resets[region][kind].rule, start = engine.previousReset(rule, now);
      out[kind] = { key: periodKey(region, kind, start), start, end: engine.nextReset(rule, now) };
    }
    return out;
  }

  const tickedIn = (list, key) => (own(list.done, key) ? list.done[key] : []);
  /** Ticked in the period it belongs to now. */
  const isDone = (list, task, per) => tickedIn(list, per[task.kind].key).includes(task.id);

  /** The list with one task ticked (on) or unticked in its current period. */
  function tick(list, id, on, per) {
    const task = list.tasks.find((t) => t.id === id);
    if (!task) return list;
    const key = per[task.kind].key, now = tickedIn(list, key).filter((x) => x !== id);
    const done = Object.assign({}, list.done);
    if (on) done[key] = now.concat(id); else if (now.length) done[key] = now; else delete done[key];
    return { tasks: list.tasks, done };
  }

  /** A new id no task has: ten base-36 characters from random() (0 <= x < 1). */
  function newId(list, random) {
    for (;;) {
      let id = '';
      while (id.length < 10) id += Math.floor(random() * 36).toString(36);
      if (!list.tasks.some((t) => t.id === id)) return id;
    }
  }

  /** { list } with the task added, or { error: 'empty' | 'full' | 'exists' | 'kind' } and the list unchanged. */
  function add(list, name, kind, random) {
    const n = cleanName(name);
    if (!n) return { list, error: 'empty' };
    if (!KINDS.includes(kind)) return { list, error: 'kind' };
    if (list.tasks.length >= MAX_TASKS) return { list, error: 'full' };
    if (list.tasks.some((t) => t.kind === kind && sameName(t.name, n))) return { list, error: 'exists' };
    return { list: { tasks: list.tasks.concat({ id: newId(list, random), name: n, kind }), done: list.done } };
  }

  /** { list } with a task renamed or moved to the other kind, or { error } as for add. */
  function edit(list, id, changes) {
    const task = list.tasks.find((t) => t.id === id);
    if (!task) return { list, error: 'missing' };
    const name = changes.name === undefined ? task.name : cleanName(changes.name);
    const kind = changes.kind === undefined ? task.kind : changes.kind;
    if (!name) return { list, error: 'empty' };
    if (!KINDS.includes(kind)) return { list, error: 'kind' };
    if (list.tasks.some((t) => t.id !== id && t.kind === kind && sameName(t.name, name))) return { list, error: 'exists' };
    // A task moved to the other kind starts unticked there: its ticks belong to the old kind's periods.
    const next = { tasks: list.tasks.map((t) => (t.id === id ? { id, name, kind } : t)), done: list.done };
    return { list: kind === task.kind ? next : sanitize(next) };
  }

  /** The list without the task and its ticks. */
  const remove = (list, id) => sanitize({ tasks: list.tasks.filter((t) => t.id !== id), done: list.done });

  /**
   * The ticks still worth keeping: periods that began within KEEP_MS before now, and none that begin
   * more than a day after now (a tick from a clock set wrong, which would otherwise come back then).
   */
  function prune(list, now) {
    const done = {};
    for (const k of Object.keys(list.done)) {
      const m = PERIOD.exec(k), start = m ? Date.parse(m[3] + 'Z') : NaN;
      if (now - start < KEEP_MS && start - now <= DAY) done[k] = list.done[k];
    }
    return { tasks: list.tasks, done };
  }

  /** { daily: { done, total }, weekly: { done, total } } in the current periods. */
  function progress(list, per) {
    const out = {};
    for (const kind of KINDS) {
      const tasks = list.tasks.filter((t) => t.kind === kind);
      out[kind] = { done: tasks.filter((t) => isDone(list, t, per)).length, total: tasks.length };
    }
    return out;
  }

  /** True when a task of the template's kind already has its name. */
  const hasTemplate = (list, tpl) => list.tasks.some((t) => t.kind === tpl.kind && sameName(t.name, tpl.name));

  const Checklist = { KINDS, MAX_TASKS, MAX_NAME, KEEP_MS, TEMPLATES, defaults, cleanName, sanitize, periodKey, periods, isDone, tick, add, edit, remove, prune, progress, hasTemplate };
  if (typeof module === 'object' && module.exports) module.exports = Checklist;
  else root.WoWChecklist = Checklist;
})(typeof globalThis !== 'undefined' ? globalThis : this);
