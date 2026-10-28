// Checks data/events.source.json against the data rules and writes events-data.js, the file the page
// loads. The page gets what it shows (names, schedules, labels, source links, check dates); the
// verbatim source quotes stay in the source file for whoever maintains it.
//
//   node tools/build-data.mjs           check and write events-data.js
//   node tools/build-data.mjs --check   check, and fail if events-data.js is not current
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = createRequire(import.meta.url)('../js/schedule.js');

const STATUSES = ['confirmed', 'predicted'];
const SOURCE_KINDS = ['official', 'client', 'game-api', 'wiki', 'guide'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validZone(zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch (e) { return false; }
}
const httpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

/** Every rule the data must pass; an empty list means it is good. */
export function validate(src) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const meta = src.meta || {};
  if (!Number.isInteger(meta.datasetRevision) || meta.datasetRevision < 1) err('meta', 'datasetRevision must be a positive whole number');
  for (const k of ['reviewedOn', 'coversUntil']) if (!ISO_DAY.test(meta[k] || '')) err('meta', `${k} must be YYYY-MM-DD`);
  if (!meta.patch) err('meta', 'patch is required');

  const regions = new Set((src.regions || []).map((r) => r.id));
  if ([...regions].sort().join() !== 'eu,us') err('regions', 'must be exactly us and eu');
  for (const r of src.regions || []) if (!r.name || !r.realms) err(`region ${r.id}`, 'name and realms are required');

  const checkSources = (where, item) => {
    if (!Array.isArray(item.sources) || !item.sources.length) { err(where, 'at least one source is required'); return; }
    for (const s of item.sources) {
      if (!httpsUrl(s.url)) err(where, `source url must be https: ${s.url}`);
      if (!SOURCE_KINDS.includes(s.kind)) err(where, `source kind must be one of ${SOURCE_KINDS.join(', ')}`);
      if (!s.publisher) err(where, 'source publisher is required');
      if (!ISO_DAY.test(s.retrieved || '')) err(where, 'source retrieved date must be YYYY-MM-DD');
      if (typeof s.quote !== 'string' || s.quote.trim().length < 10) err(where, 'every source needs the verbatim quote it was used for');
    }
    if (!ISO_DAY.test(item.lastVerified || '')) err(where, 'lastVerified must be YYYY-MM-DD');
    else if (meta.reviewedOn && item.lastVerified > meta.reviewedOn) err(where, 'lastVerified is after meta.reviewedOn');
    if (!STATUSES.includes(item.status)) err(where, `status must be one of ${STATUSES.join(', ')} (unverified schedules are listed under "untracked", never as times)`);
    // Confirmed needs Blizzard's word or the game's own data; a wiki or guide alone is not enough.
    if (item.status === 'confirmed' && !item.sources.some((s) => ['official', 'client', 'game-api'].includes(s.kind))) err(where, 'confirmed needs an official Blizzard, game data or game API source');
    if (item.status === 'predicted' && !(typeof item.basis === 'string' && item.basis.length > 20)) err(where, 'predicted needs a basis: the pattern the prediction follows');
  };

  const checkRule = (where, rule) => {
    if (!rule || typeof rule !== 'object') { err(where, 'rule missing'); return; }
    if (['daily', 'weekly', 'monthly'].includes(rule.type)) {
      if (!TIME.test(rule.time || '')) err(where, 'time must be HH:MM');
      if (!validZone(rule.zone)) err(where, `unknown time zone ${rule.zone}`);
      if (rule.type === 'weekly' && !(Number.isInteger(rule.weekday) && rule.weekday >= 0 && rule.weekday <= 6)) err(where, 'weekday must be 0-6 (0 = Sunday)');
      if (rule.type === 'monthly' && !(Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28)) err(where, 'day must be 1-28');
    } else err(where, `unknown reset rule ${rule.type}`);
  };

  // Resets: daily and weekly per region, plus any monthly ones.
  for (const r of regions) {
    const rs = (src.resets || {})[r];
    if (!rs) { err(`resets ${r}`, 'missing'); continue; }
    for (const kind of ['daily', 'weekly']) if (!rs[kind]) err(`resets ${r}`, `${kind} missing`);
    for (const [kind, item] of Object.entries(rs)) {
      checkRule(`resets ${r}.${kind}`, item.rule);
      checkSources(`resets ${r}.${kind}`, item);
    }
  }

  // Each category says, per region, how far ahead its schedules are known, and why they stop there.
  const categories = new Set(), knownUntil = new Map();
  for (const c of src.categories || []) {
    if (!ID.test(c.id || '') || categories.has(c.id)) err('categories', `bad or repeated id ${c.id}`);
    categories.add(c.id);
    if (!c.name) err(`category ${c.id}`, 'name is required');
    if (!(typeof c.gap === 'string' && c.gap.length > 20)) err(`category ${c.id}`, 'gap (why schedules stop at knownUntil) is required');
    for (const r of regions) {
      const k = c.knownUntil && c.knownUntil[r];
      if (!ISO_INSTANT.test(k || '')) err(`category ${c.id}`, `knownUntil.${r} needs a date, time and offset`);
      else knownUntil.set(`${c.id} ${r}`, Date.parse(k));
    }
  }

  const checkSchedule = (where, s, event) => {
    if (!s || typeof s !== 'object') { err(where, 'schedule missing'); return; }
    // A region can be less certain than the event as a whole (for example only its start time).
    if (s.status !== undefined) {
      if (!STATUSES.includes(s.status)) err(where, `status must be one of ${STATUSES.join(', ')}`);
      if (s.status === 'confirmed' && event.status !== 'confirmed') err(where, 'a region cannot be more certain than its event');
      if (s.status === 'predicted' && !(typeof s.basis === 'string' && s.basis.length > 20)) err(where, 'a predicted region needs a basis');
      if (s.part !== undefined && s.part !== 'time') err(where, 'part can only be "time" (only the start time is predicted)');
    } else if (s.part !== undefined || s.basis !== undefined) err(where, 'part and basis go with a region status');
    if (s.type === 'dates') {
      if (!Array.isArray(s.windows) || !s.windows.length) { err(where, 'dates needs windows'); return; }
      let prevEnd = -Infinity;
      for (const w of s.windows) {
        if (!ISO_INSTANT.test(w.start || '') || !ISO_INSTANT.test(w.end || '')) { err(where, `window times need a date, time and offset: ${w.start} ${w.end}`); continue; }
        const a = Date.parse(w.start), b = Date.parse(w.end);
        if (!(b > a)) err(where, `window ends before it starts: ${w.start}`);
        if (a < prevEnd) err(where, `windows overlap or are out of order at ${w.start}`);
        if (b - a > 62 * S.DAY) err(where, `window longer than 62 days: ${w.start}`);
        if (w.name !== undefined && !(typeof w.name === 'string' && w.name.trim())) err(where, `window name must be text: ${w.start}`);
        prevEnd = b;
      }
    } else if (s.type === 'every') {
      for (const k of ['periodMin', 'offsetMin', 'durationMin']) if (!Number.isInteger(s[k]) || s[k] < 0) err(where, `${k} must be a whole number of minutes`);
      if (s.offsetMin >= s.periodMin) err(where, 'offsetMin must be less than periodMin');
      if (!(s.durationMin > 0 && s.durationMin <= s.periodMin)) err(where, 'durationMin must be within the period');
      for (const k of ['from', 'until']) if (s[k] !== undefined && !ISO_INSTANT.test(s[k])) err(where, `${k} needs a date, time and offset`);
    } else if (s.type === 'monthlyNth') {
      if (!(Number.isInteger(s.n) && s.n >= 1 && s.n <= 4)) err(where, 'n must be 1-4');
      if (!(Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6)) err(where, 'weekday must be 0-6');
      if (!TIME.test(s.time || '')) err(where, 'time must be HH:MM');
      if (!validZone(s.zone)) err(where, `unknown time zone ${s.zone}`);
      if (!(Number.isInteger(s.durationMin) && s.durationMin > 0 && s.durationMin <= 28 * 1440)) err(where, 'durationMin must be 1 minute to 28 days');
      if (s.until !== undefined && !ISO_INSTANT.test(s.until)) err(where, 'until needs a date, time and offset');
    } else err(where, `unknown schedule type ${s.type}`);
  };

  const ids = new Set();
  for (const e of src.events || []) {
    const where = `event ${e.id}`;
    if (!ID.test(e.id || '') || ids.has(e.id)) err(where, 'bad or repeated id');
    ids.add(e.id);
    if (!e.name) err(where, 'name is required');
    if (!categories.has(e.category)) err(where, `unknown category ${e.category}`);
    if (!e.zone) err(where, 'zone (where it happens) is required');
    if (!e.schedules || typeof e.schedules !== 'object' || !Object.keys(e.schedules).length) err(where, 'schedules by region are required');
    else for (const [r, s] of Object.entries(e.schedules)) {
      if (!regions.has(r)) err(where, `unknown region ${r}`);
      checkSchedule(`${where} ${r}`, s, e);
      // Nothing may start where its category says schedules are no longer known.
      const k = knownUntil.get(`${e.category} ${r}`);
      if (k === undefined || !s) continue;
      if (s.type === 'dates') { for (const w of s.windows || []) if (Date.parse(w.start) >= k) err(`${where} ${r}`, `window starts after its category's knownUntil: ${w.start}`); }
      else if (!s.until || Date.parse(s.until) > k) err(`${where} ${r}`, "a repeating schedule needs an until at or before its category's knownUntil");
    }
    if (e.link && !httpsUrl(e.link.url)) err(where, 'link must be https');
    checkSources(where, e);
  }
  for (const u of src.untracked || []) if (!u.name || !u.reason) err('untracked', 'name and reason are required');
  return errors;
}

/** What the page gets: no quotes or maintenance notes. */
export function pageData(src) {
  const sourceLinks = (item) => item.sources.map((s) => ({ url: s.url, publisher: s.publisher, kind: s.kind }));
  const resets = {};
  for (const [r, rs] of Object.entries(src.resets)) {
    resets[r] = {};
    for (const [kind, item] of Object.entries(rs)) {
      resets[r][kind] = Object.assign({ name: item.name, rule: item.rule, status: item.status }, item.basis ? { basis: item.basis } : {}, { lastVerified: item.lastVerified, sources: sourceLinks(item) });
    }
  }
  return {
    meta: src.meta,
    regions: src.regions,
    resets,
    categories: src.categories,
    events: src.events.map((e) => {
      const out = { id: e.id, name: e.name, category: e.category, zone: e.zone, status: e.status, schedules: e.schedules };
      for (const k of ['note', 'basis', 'link', 'important']) if (e[k] !== undefined) out[k] = e[k];
      out.sources = sourceLinks(e);
      out.lastVerified = e.lastVerified;
      return out;
    }),
    untracked: src.untracked || [],
  };
}

export function render(src) {
  const json = JSON.stringify(pageData(src), null, 1);
  return '// Generated by tools/build-data.mjs from data/events.source.json. Do not edit by hand.\n'
    + '(function (root) {\n  \'use strict\';\n  const DATA = ' + json.replace(/\n/g, '\n  ') + ';\n'
    + '  if (typeof module === \'object\' && module.exports) module.exports = DATA;\n  else root.WOW_DATA = DATA;\n'
    + '})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
}

export function buildData({ check = false, log = console.log } = {}) {
  const src = JSON.parse(readFileSync(join(ROOT, 'data', 'events.source.json'), 'utf8'));
  const errors = validate(src);
  if (errors.length) return { ok: false, errors };
  const out = render(src);
  const path = join(ROOT, 'events-data.js');
  let current = '';
  try { current = readFileSync(path, 'utf8'); } catch (e) { current = ''; }
  if (check) {
    if (current !== out) return { ok: false, errors: ['events-data.js is not current: run node tools/build-data.mjs'] };
  } else if (current !== out) {
    writeFileSync(path, out);
    log('Wrote events-data.js');
  }
  return { ok: true, errors: [], revision: src.meta.datasetRevision, events: src.events.length };
}

if (process.argv[1] && process.argv[1].endsWith('build-data.mjs')) {
  const r = buildData({ check: process.argv.includes('--check') });
  if (!r.ok) { console.error('Data refused:\n  ' + r.errors.join('\n  ')); process.exit(1); }
  console.log(`Data r${r.revision}: ${r.events} events, every rule passes.`);
}
