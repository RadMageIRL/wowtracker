// Checks each edition's schedule data (data/<source>.source.json, editions listed in js/config.js) against
// the data rules and writes the file the page loads for it (Retail: events-data.js). The page gets what it
// shows (names, schedules, labels, source links, check dates); the verbatim source quotes stay in the
// source file for whoever maintains it. From the same page data it writes the calendar subscription feeds
// (calendar/*.ics, tools/feeds.mjs), so a data change and its feeds are always one change.
//
//   node tools/build-data.mjs           check every edition and write its files and the feeds
//   node tools/build-data.mjs --check   check, and fail if a generated file or feed is not current
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feeds } from './feeds.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const S = require('../js/schedule.js');
/** The editions, from js/config.js: the default (Retail) first. */
export const EDITIONS = require('../js/config.js').editions;

const STATUSES = ['confirmed', 'predicted'];
const SOURCE_KINDS = ['official', 'client', 'game-api', 'wiki', 'guide'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validZone(zone) {
  // A missing zone is not valid: Intl would quietly use the machine's own.
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch (e) { return false; }
}
const httpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

/**
 * Every rule the data must pass; an empty list means it is good. `edition` is the dataset's edition id:
 * Retail's file predates editions and carries no edition fields; every other edition must name itself,
 * its client product, and the server clock each region reads its client calendar in.
 */
export function validate(src, edition = 'retail') {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const meta = src.meta || {};
  const retail = edition === 'retail';
  if (!Number.isInteger(meta.datasetRevision) || meta.datasetRevision < 1) err('meta', 'datasetRevision must be a positive whole number');
  for (const k of ['reviewedOn', 'coversUntil']) if (!ISO_DAY.test(meta[k] || '')) err('meta', `${k} must be YYYY-MM-DD`);
  if (!meta.patch) err('meta', 'patch is required');
  if (retail) { if (meta.edition !== undefined && meta.edition !== 'retail') err('meta', 'the Retail data cannot name another edition'); }
  else {
    if (meta.edition !== edition) err('meta', `edition must be ${edition}`);
    if (!/^[a-z_]+$/.test(meta.product || '')) err('meta', 'product (the client product code, such as wowf) is required');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(meta.clientBuild || '')) err('meta', 'clientBuild must be a full build number');
  }
  // A client source of an edition other than Retail must cite a build of that edition's own client line.
  const buildLine = retail ? null : String(meta.clientBuild || '').split('.').slice(0, 2).join('.') + '.';

  const regions = new Set((src.regions || []).map((r) => r.id));
  if ([...regions].sort().join() !== 'eu,us') err('regions', 'must be exactly us and eu');
  for (const r of src.regions || []) {
    if (!r.name || !r.realms) err(`region ${r.id}`, 'name and realms are required');
    // The server clock the region reads its client calendar rows in (never assumed from another edition).
    if (!retail || r.serverZone !== undefined) {
      const z = r.serverZone || {};
      if (!validZone(z.zone)) err(`region ${r.id}`, 'serverZone.zone must be a time zone');
      if (!STATUSES.includes(z.status)) err(`region ${r.id}`, `serverZone.status must be one of ${STATUSES.join(', ')}`);
      if (!(typeof z.basis === 'string' && z.basis.length > 20)) err(`region ${r.id}`, 'serverZone.basis (the evidence for this clock) is required');
      if (!retail && !(typeof z.name === 'string' && z.name.trim())) err(`region ${r.id}`, 'serverZone.name (the clock in words, such as US Central time) is required');
    }
  }

  const checkSources = (where, item) => {
    if (!Array.isArray(item.sources) || !item.sources.length) { err(where, 'at least one source is required'); return; }
    for (const s of item.sources) {
      if (!httpsUrl(s.url)) err(where, `source url must be https: ${s.url}`);
      if (buildLine && s.kind === 'client' && !String(s.url).includes(`build=${buildLine}`)) err(where, `a client source must cite a ${buildLine}x build of this edition: ${s.url}`);
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
      // A reset nobody has published or observed is said to be unknown: never a guessed rule.
      if (item.status === 'unknown') {
        if (!item.name) err(`resets ${r}.${kind}`, 'name is required');
        if (item.rule !== undefined) err(`resets ${r}.${kind}`, 'an unknown reset has no rule');
        if (!(typeof item.note === 'string' && item.note.length > 20)) err(`resets ${r}.${kind}`, 'an unknown reset needs a note saying what is not known');
        continue;
      }
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

  // A rotation names each window of an "every" schedule (a Curse Surge location, the Aqir zone of the week).
  // It is always derived from observations, so only a predicted event or region may have one, and a name
  // may only change between windows, never inside one.
  const checkNames = (where, s, event) => {
    const n = s.names;
    if (!n || typeof n !== 'object' || Array.isArray(n)) { err(where, 'names must be { list, everyMin, offsetMin, shift }'); return; }
    if (!Array.isArray(n.list) || n.list.length < 2 || n.list.length > 12 || !n.list.every((x) => typeof x === 'string' && x.trim()) || new Set(n.list).size !== n.list.length) err(where, 'names.list must be 2 to 12 different names');
    if (!Number.isInteger(n.everyMin) || n.everyMin < 1) err(where, 'names.everyMin must be a whole number of minutes');
    else {
      if (n.everyMin % s.periodMin !== 0) err(where, 'names.everyMin must be a whole number of periods, so a name never changes inside a window');
      if (!Number.isInteger(n.offsetMin) || n.offsetMin < 0 || n.offsetMin >= n.everyMin) err(where, 'names.offsetMin must be 0 or more and less than names.everyMin');
      else if ((((n.offsetMin - s.offsetMin) % s.periodMin) + s.periodMin) % s.periodMin !== 0) err(where, 'names.offsetMin must fall on a window start');
    }
    if (!Number.isInteger(n.shift) || n.shift < 0 || !Array.isArray(n.list) || n.shift >= n.list.length) err(where, 'names.shift must be a position in names.list');
    if (event.status !== 'predicted' && s.status !== 'predicted') err(where, 'a rotation of names is derived from observations, so it must be labeled predicted');
  };

  const checkSchedule = (where, s, event) => {
    if (!s || typeof s !== 'object') { err(where, 'schedule missing'); return; }
    if (s.names !== undefined && s.type !== 'every') err(where, 'only a repeating ("every") schedule can have a rotation of names');
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
      if (s.names !== undefined) checkNames(where, s, event);
    } else if (s.type === 'monthlyNth') {
      if (!(Number.isInteger(s.n) && s.n >= 1 && s.n <= 4)) err(where, 'n must be 1-4');
      if (!(Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6)) err(where, 'weekday must be 0-6');
      if (!TIME.test(s.time || '')) err(where, 'time must be HH:MM');
      if (!validZone(s.zone)) err(where, `unknown time zone ${s.zone}`);
      if (!(Number.isInteger(s.durationMin) && s.durationMin > 0 && s.durationMin <= 28 * 1440)) err(where, 'durationMin must be 1 minute to 28 days');
      if (s.until !== undefined && !ISO_INSTANT.test(s.until)) err(where, 'until needs a date, time and offset');
    } else err(where, `unknown schedule type ${s.type}`);
  };

  // A region whose server clock is itself predicted cannot have times more certain than that clock.
  const clockPredicted = new Set((src.regions || []).filter((r) => r.serverZone && r.serverZone.status === 'predicted').map((r) => r.id));
  const ids = new Set();
  for (const e of src.events || []) {
    const where = `event ${e.id}`;
    if (!ID.test(e.id || '') || ids.has(e.id)) err(where, 'bad or repeated id');
    ids.add(e.id);
    if (!e.name) err(where, 'name is required');
    if (!categories.has(e.category)) err(where, `unknown category ${e.category}`);
    // Where it happens; null says plainly that no source names a place (shown as such, never guessed).
    if (e.zone !== null && !(typeof e.zone === 'string' && e.zone.trim())) err(where, 'zone (where it happens) is required, or null when no source names a place');
    if (e.repeats !== undefined && !(typeof e.repeats === 'string' && e.repeats.length >= 10 && e.repeats.length <= 240)) err(where, 'repeats (how it recurs, in words) must be 10 to 240 characters');
    if (!e.schedules || typeof e.schedules !== 'object' || !Object.keys(e.schedules).length) err(where, 'schedules by region are required');
    else for (const [r, s] of Object.entries(e.schedules)) {
      if (!regions.has(r)) err(where, `unknown region ${r}`);
      checkSchedule(`${where} ${r}`, s, e);
      if (s && clockPredicted.has(r) && (s.status || e.status) !== 'predicted') err(`${where} ${r}`, "the region's server clock is predicted, so its times must be labeled predicted");
      // Nothing may start where its category says schedules are no longer known.
      const k = knownUntil.get(`${e.category} ${r}`);
      if (k === undefined || !s) continue;
      if (s.type === 'dates') { for (const w of s.windows || []) if (Date.parse(w.start) >= k) err(`${where} ${r}`, `window starts after its category's knownUntil: ${w.start}`); }
      else if (!s.until || Date.parse(s.until) > k) err(`${where} ${r}`, "a repeating schedule needs an until at or before its category's knownUntil");
    }
    if (e.link && !httpsUrl(e.link.url)) err(where, 'link must be https');
    // Search words only (what players also call it), never shown as facts: short plain text, each once.
    if (e.aliases !== undefined) {
      const seen = new Set([e.name.toLowerCase()]);
      if (!Array.isArray(e.aliases) || !e.aliases.length || e.aliases.length > 4) err(where, 'aliases must be a list of 1 to 4 words');
      else for (const a of e.aliases) {
        if (typeof a !== 'string' || !/^[A-Za-z0-9' ]{2,30}$/.test(a)) err(where, `alias ${JSON.stringify(a)} must be 2 to 30 letters, digits, spaces or apostrophes`);
        else if (seen.has(a.toLowerCase())) err(where, `alias ${a} repeats the name or another alias`);
        else seen.add(a.toLowerCase());
      }
    }
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
      resets[r][kind] = item.status === 'unknown' ? { name: item.name, status: 'unknown', note: item.note }
        : Object.assign({ name: item.name, rule: item.rule, status: item.status }, item.basis ? { basis: item.basis } : {}, { lastVerified: item.lastVerified, sources: sourceLinks(item) });
    }
  }
  return {
    meta: src.meta,
    regions: src.regions,
    resets,
    categories: src.categories,
    events: src.events.map((e) => {
      const out = { id: e.id, name: e.name, category: e.category, zone: e.zone, status: e.status, schedules: e.schedules };
      for (const k of ['aliases', 'note', 'repeats', 'basis', 'link', 'important']) if (e[k] !== undefined) out[k] = e[k];
      out.sources = sourceLinks(e);
      out.lastVerified = e.lastVerified;
      return out;
    }),
    untracked: src.untracked || [],
  };
}

export function render(src, edition = EDITIONS[0]) {
  const json = JSON.stringify(pageData(src), null, 1);
  return `// Generated by tools/build-data.mjs from data/${edition.source}.source.json. Do not edit by hand.\n`
    + '(function (root) {\n  \'use strict\';\n  const DATA = ' + json.replace(/\n/g, '\n  ') + ';\n'
    + `  if (typeof module === 'object' && module.exports) module.exports = DATA;\n  else root.${edition.data} = DATA;\n`
    + '})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
}

/** Writes a generated file, or with check says it is not current. Bytes as given (the feeds keep their CRLF). */
function writeOrCheck(file, out, check, log) {
  const path = join(ROOT, file);
  let current = '';
  try { current = readFileSync(path, 'utf8'); } catch (e) { current = ''; }
  if (current === out) return [];
  if (check) return [`${file} is not current: run node tools/build-data.mjs`];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  log(`Wrote ${file}`);
  return [];
}

/** Checks one edition and writes (or, with check, compares) its generated file. */
function buildEdition(edition, check, log) {
  const src = JSON.parse(readFileSync(join(ROOT, 'data', `${edition.source}.source.json`), 'utf8'));
  const errors = validate(src, edition.id).map((e) => `${edition.id}: ${e}`);
  if (errors.length) return { ok: false, errors };
  const stale = writeOrCheck(edition.file, render(src, edition), check, log);
  if (stale.length) return { ok: false, errors: stale };
  return { ok: true, errors: [], id: edition.id, revision: src.meta.datasetRevision, events: src.events.length, page: pageData(src) };
}

/**
 * Every edition, then the calendar feeds made from them (tools/feeds.mjs); revision and events are Retail's
 * (the default), and editions lists each one.
 */
export function buildData({ check = false, log = console.log } = {}) {
  const results = EDITIONS.map((e) => buildEdition(e, check, log));
  const errors = results.flatMap((r) => r.errors);
  if (errors.length) return { ok: false, errors };
  const pages = Object.fromEntries(results.map((r) => [r.id, r.page]));
  const stale = feeds(pages).flatMap((f) => writeOrCheck(f.file, f.text, check, log));
  if (stale.length) return { ok: false, errors: stale };
  return { ok: true, errors: [], revision: results[0].revision, events: results[0].events, editions: results.map(({ id, revision, events }) => ({ id, revision, events })) };
}

if (process.argv[1] && process.argv[1].endsWith('build-data.mjs')) {
  const r = buildData({ check: process.argv.includes('--check') });
  if (!r.ok) { console.error('Data refused:\n  ' + r.errors.join('\n  ')); process.exit(1); }
  console.log(`Data r${r.revision}: ${r.events} events, every rule passes.`);
  for (const e of r.editions.slice(1)) console.log(`${e.id} data r${e.revision}: ${e.events} events, every rule passes.`);
}
