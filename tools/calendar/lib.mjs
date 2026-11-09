// The schedule comparison tool's logic, pure and deterministic (no clock, no network, no files): read the
// game client's calendar tables (Holidays, HolidayNames, HolidayDescriptions, as wago.tools exports them as
// CSV) into a snapshot, expand a snapshot into windows on each region's server clock, compare two snapshots,
// and compare a snapshot with WoW Tracker's published data. It reports; it never changes the data.
//
// What the client tables can and cannot say: they hold wall times with no time zone, so they confirm dates,
// durations and regions, never an instant whose server clock is not known. Every instant computed here uses
// the edition's own server clocks, as its data states them, and is labeled with that clock's status.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../js/schedule.js');

export const FORMAT = 'wowtracker-calendar-snapshot/1';
const HOUR = 3600000, DAY = 86400000;

/** The columns this decoder understands. Any other layout is refused: a changed table needs a person. */
export const HEADERS = {
  holidays: ['ID', 'Region', 'Looping', 'HolidayNameID', 'HolidayDescriptionID', 'Priority', 'CalendarFilterType', 'Flags',
    ...Array.from({ length: 10 }, (_, i) => `Duration_${i}`), ...Array.from({ length: 26 }, (_, i) => `Date_${i}`),
    ...Array.from({ length: 10 }, (_, i) => `CalendarFlags_${i}`), 'TextureFileDataID_0', 'TextureFileDataID_1', 'TextureFileDataID_2'],
  names: ['ID', 'Name_lang'],
  descriptions: ['ID', 'Description_lang'],
};

/** Client products and the edition whose data they feed. */
export const PRODUCTS = { wow: 'retail', wowt: 'retail', wowf: 'forever' };
/** Retail's server clocks, as its data's bases say: Americas rows on Pacific time, Europe's on Central European time. */
export const RETAIL_ZONES = { us: 'America/Los_Angeles', eu: 'Europe/Paris' };
/** A row's region mask: 0 is every region; bit 1 the Americas, bit 4 Europe. Other bits are regions not tracked here. */
export const REGION_BITS = { us: 1, eu: 4 };
export const REGIONS = ['us', 'eu'];
/** A rescheduled occurrence is paired with the old one only within this distance; further apart they are a removal and an addition. */
export const PAIR_WITHIN_MS = 14 * DAY;

export const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');
const pad = (n) => String(n).padStart(2, '0');
export const isoMin = (ms) => (ms == null ? '-' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z');
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- CSV (RFC 4180: quoted fields, "" inside quotes, CRLF or LF) ----

export function parseCsv(text) {
  const records = [];
  let field = '', record = [], quoted = false, i = 0;
  const s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { record.push(field); field = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') { i++; continue; }
    if (c === '\n') { record.push(field); records.push(record); record = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  const [header = [], ...rows] = records;
  return { header, rows: rows.filter((r) => !(r.length === 1 && r[0] === '')).map((r, n) => {
    if (r.length !== header.length) throw new Error(`CSV line ${n + 2} has ${r.length} fields, the header ${header.length}`);
    return Object.fromEntries(header.map((h, k) => [h, r[k]]));
  }) };
}

// ---- Packed wall times ----

/** WoW packed time: minute 6 bits, hour 5, weekday 3, day - 1 6, month - 1 4, year - 2000 5; all bits set means any. */
export const unpack = (v) => ({ mi: v & 63, h: (v >> 6) & 31, wd: (v >> 11) & 7, d: ((v >> 14) & 63) + 1, mo: ((v >> 20) & 15) + 1, y: (v >> 24) & 31 });
/** The inverse, for tests: { mi, h, wd = 7, d = 64 (any), mo = 16 (any), y = 31 (any) } with y as years after 2000. */
export const pack = ({ mi = 0, h = 0, wd = 7, d = 64, mo = 16, y = 31 }) => (mi | (h << 6) | (wd << 11) | ((d - 1) << 14) | ((mo - 1) << 20) | (y << 24)) >>> 0;

const anyDay = (u) => u.mo === 16 && u.d === 64;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How a row repeats, from its first date: looping, daily, weekly, annual (any year), dated, or none. */
export function kindOf(row) {
  if (!row.dates.length) return 'none';
  if (row.looping) return 'looping';
  const u = unpack(row.dates[0]);
  if (anyDay(u)) return u.wd === 7 ? 'daily' : 'weekly';
  return u.y === 31 ? 'annual' : 'dated';
}

/** A packed date in words, as the server's calendar says it (wall time, no zone). */
export function describeDate(v) {
  const u = unpack(v), t = `${pad(u.h)}:${pad(u.mi)}`;
  if (anyDay(u)) return u.wd === 7 ? `every day ${t}` : `every ${WD[u.wd]} ${t}`;
  if (u.y === 31) return `every year ${MONTHS[u.mo - 1]} ${u.d} ${t}`;
  return `${2000 + u.y}-${pad(u.mo)}-${pad(u.d)} ${t}`;
}

export const regionsOf = (mask) => REGIONS.filter((r) => mask === 0 || (mask & REGION_BITS[r]) !== 0);

// ---- Snapshots ----

/** A snapshot from the three tables' CSV text. Description text is kept only as a fingerprint. */
export function snapshotFromCsv({ holidays, names, descriptions, product, build, retrieved = null, files = [] }) {
  if (!PRODUCTS[product]) throw new Error(`unknown product "${product}" (known: ${Object.keys(PRODUCTS).join(', ')})`);
  const tables = { holidays: parseCsv(holidays), names: parseCsv(names), descriptions: parseCsv(descriptions) };
  for (const [k, t] of Object.entries(tables)) {
    if (!sameList(t.header, HEADERS[k])) throw new Error(`the ${k} table's columns changed (${t.header.join(',')}); the decoder needs a review before it can read it`);
  }
  const nm = new Map(tables.names.rows.map((r) => [r.ID, r.Name_lang]));
  const ds = new Map(tables.descriptions.rows.map((r) => [r.ID, r.Description_lang]));
  const nums = (r, p, n) => Array.from({ length: n }, (_, i) => Number(r[`${p}_${i}`])).filter((x) => x);
  const table = tables.holidays.rows.map((r) => {
    const text = ds.get(r.HolidayDescriptionID) || '';
    const row = {
      holidayId: Number(r.ID), name: nm.get(r.HolidayNameID) || '', nameId: Number(r.HolidayNameID),
      regionMask: Number(r.Region), looping: r.Looping === '1', durationsH: nums(r, 'Duration', 10), dates: nums(r, 'Date', 26),
      flags: Number(r.Flags), priority: Number(r.Priority), calendarFilterType: Number(r.CalendarFilterType),
      calendarFlags: nums(r, 'CalendarFlags', 10), descriptionId: Number(r.HolidayDescriptionID), descriptionSha256: text ? sha256(text) : null,
    };
    return { holidayId: row.holidayId, name: row.name, kind: kindOf(row), ...row };
  }).sort((a, b) => a.holidayId - b.holidayId);
  return { format: FORMAT, product, edition: PRODUCTS[product], build, retrieved, files, table };
}

/** Reads a snapshot, or one of the committed fixtures that hold a snapshot's table. */
export function asSnapshot(doc) {
  if (!doc || !Array.isArray(doc.table)) throw new Error('not a snapshot: no table');
  const product = doc.product || null;
  if (!PRODUCTS[product]) throw new Error(`not a snapshot: product "${product}"`);
  const table = doc.table.map((r) => ({ ...r, kind: r.kind || kindOf(r) })).sort((a, b) => a.holidayId - b.holidayId);
  return { format: FORMAT, product, edition: PRODUCTS[product], build: doc.build, retrieved: doc.retrieved || null, files: doc.files || [], table };
}

// ---- Expanding rows into windows ----

/** The server clocks of an edition's regions: Forever's from its data, Retail's as its data's bases say. */
export function zonesFor(source) {
  if (source.meta && source.meta.edition === 'forever') {
    return Object.fromEntries(source.regions.map((r) => [r.id, { zone: r.serverZone.zone, name: r.serverZone.name, status: r.serverZone.status }]));
  }
  return { us: { zone: RETAIL_ZONES.us, name: 'US Pacific time', status: 'as the data states' }, eu: { zone: RETAIL_ZONES.eu, name: 'Central European time', status: 'as the data states' } };
}

function* wallsOf(u, kind, fromMs, toMs) {
  // Wall dates from two days before to two days after the range, in calendar order.
  const lo = new Date(fromMs - 2 * DAY), hi = new Date(toMs + 2 * DAY);
  if (kind === 'weekly' || kind === 'daily') {
    for (let t = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate()); t < hi.getTime(); t += DAY) {
      const d = new Date(t);
      if (kind === 'daily' || d.getUTCDay() === u.wd) yield { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: u.h, mi: u.mi };
    }
    return;
  }
  const years = u.y === 31 ? Array.from({ length: hi.getUTCFullYear() - lo.getUTCFullYear() + 1 }, (_, i) => lo.getUTCFullYear() + i) : [2000 + u.y];
  for (const y of years) {
    if (u.d > new Date(Date.UTC(y, u.mo, 0)).getUTCDate()) continue; // no such day that year
    yield { y, mo: u.mo, d: u.d, h: u.h, mi: u.mi };
  }
}

/**
 * Every window of every row that starts in [fromMs, toMs), on each region's own clock. Durations are elapsed
 * hours; a row with several durations has them as phases one after another (Retail's Darkmoon Faire: 48 h,
 * then the 168 h of the fair). Looping rows (rotations whose reading is unverified) only with { looping: true }.
 */
export function occurrences(snapshot, zones, fromMs, toMs, { looping = false } = {}) {
  const out = [];
  for (const row of snapshot.table) {
    const kind = row.kind || kindOf(row);
    if (kind === 'none' || (kind === 'looping' && !looping)) continue;
    for (const region of regionsOf(row.regionMask)) {
      const zone = zones[region] && zones[region].zone;
      if (!zone) continue;
      for (const v of row.dates) {
        const u = unpack(v);
        if (kind === 'looping') {
          // The reading in V0.3-RESEARCH A1: on for the first duration, again every sum(durations) hours.
          const period = row.durationsH.reduce((a, b) => a + b, 0) * HOUR;
          if (!period || anyDay(u) || u.y === 31) continue;
          const base = S.wallToUtc(zone, 2000 + u.y, u.mo, u.d, u.h, u.mi);
          for (let k = Math.max(0, Math.ceil((fromMs - base) / period)), s = base + k * period; s < toMs; k++, s = base + k * period) {
            out.push({ holidayId: row.holidayId, name: row.name, region, kind, wall: `loop from ${describeDate(v)}`, start: s, end: s + row.durationsH[0] * HOUR, phases: [[s, s + row.durationsH[0] * HOUR]] });
          }
          continue;
        }
        for (const w of wallsOf(u, kind, fromMs, toMs)) {
          const start = S.wallToUtc(zone, w.y, w.mo, w.d, w.h, w.mi);
          if (start < fromMs || start >= toMs) continue;
          const phases = [];
          let t = start;
          for (const hrs of row.durationsH) { phases.push([t, t + hrs * HOUR]); t += hrs * HOUR; }
          out.push({ holidayId: row.holidayId, name: row.name, region, kind, wall: `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`, start, end: phases.length ? t : null, phases });
        }
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.region.localeCompare(b.region) || a.holidayId - b.holidayId);
}

// ---- Comparing two snapshots ----

const FIELDS = ['name', 'kind', 'regionMask', 'looping', 'durationsH', 'flags', 'calendarFilterType', 'calendarFlags', 'descriptionSha256'];

/** Rows added, removed and changed (field by field; dates as the server's calendar says them). */
export function diffRows(a, b) {
  const A = new Map(a.table.map((r) => [r.holidayId, r])), B = new Map(b.table.map((r) => [r.holidayId, r]));
  const added = b.table.filter((r) => !A.has(r.holidayId)), removed = a.table.filter((r) => !B.has(r.holidayId));
  const changed = [];
  for (const r of b.table) {
    const o = A.get(r.holidayId);
    if (!o) continue;
    const fields = FIELDS.filter((f) => !sameList(o[f] === undefined ? null : o[f], r[f] === undefined ? null : r[f])).map((f) => ({ field: f, old: o[f], new: r[f] }));
    const oldDates = o.dates.map(describeDate), newDates = r.dates.map(describeDate);
    const datesAdded = newDates.filter((d) => !oldDates.includes(d)), datesRemoved = oldDates.filter((d) => !newDates.includes(d));
    if (fields.length || datesAdded.length || datesRemoved.length) changed.push({ holidayId: r.holidayId, name: r.name, oldName: o.name, fields, datesAdded, datesRemoved });
  }
  // A new row with an old row's name is reported as replacing it.
  const replaced = added.filter((n) => n.name).flatMap((n) => removed.filter((o) => o.name === n.name).map((o) => ({ from: o.holidayId, to: n.holidayId, name: n.name })));
  return { added, removed, changed, replaced };
}

/**
 * Occurrences added, removed, moved (same row, the nearest old one within PAIR_WITHIN_MS) and resized (same
 * start, another end), per region. Unchanged ones are only counted.
 */
export function diffOccurrences(oldOcc, newOcc) {
  const key = (o) => `${o.region}|${o.holidayId}|${o.start}|${o.end}`;
  const oldKeys = new Set(oldOcc.map(key)), newKeys = new Set(newOcc.map(key));
  const gone = oldOcc.filter((o) => !newKeys.has(key(o))), fresh = newOcc.filter((n) => !oldKeys.has(key(n)));
  const unchanged = newOcc.length - fresh.length;
  const pairs = [];
  for (const o of gone) for (const n of fresh) {
    if (o.region === n.region && o.holidayId === n.holidayId && Math.abs(n.start - o.start) <= PAIR_WITHIN_MS) pairs.push([Math.abs(n.start - o.start), o, n]);
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1].start - y[1].start || x[2].start - y[2].start);
  const usedO = new Set(), usedN = new Set(), moved = [], resized = [];
  for (const [, o, n] of pairs) {
    if (usedO.has(o) || usedN.has(n)) continue;
    usedO.add(o); usedN.add(n);
    (o.start === n.start ? resized : moved).push({ region: n.region, holidayId: n.holidayId, name: n.name, oldName: o.name, old: [o.start, o.end], new: [n.start, n.end] });
  }
  return {
    unchanged,
    added: fresh.filter((n) => !usedN.has(n)), removed: gone.filter((o) => !usedO.has(o)), moved, resized,
  };
}

// ---- Comparing a snapshot with the published data ----

/** The client rows an event's sources cite ("ID 301, Region 0, ..."). */
export const citedRows = (e) => [...new Set((e.sources || []).filter((s) => s.kind === 'client').flatMap((s) => [...String(s.quote).matchAll(/\bID (\d+)\b/g)].map((m) => Number(m[1]))))].sort((a, b) => a - b);

/** How sure the data is of one region's times, in its own words. */
function confidence(e, s) {
  const status = (s && s.status) || e.status, part = s && s.part;
  return status === 'predicted' ? (part === 'time' ? 'Predicted time' : 'Predicted') : 'Confirmed';
}

/**
 * Each event's published windows in [fromMs, its category's knownUntil) against the windows its cited rows give
 * in the snapshot. A published window matches an occurrence that has its start and end, either the whole span
 * or one phase. Also: how far the client data reaches for the event, and rows no event cites.
 */
export function impact(snapshot, source, fromMs) {
  const zones = zonesFor(source);
  const byId = new Map(snapshot.table.map((r) => [r.holidayId, r]));
  const cat = new Map(source.categories.map((c) => [c.id, c]));
  const far = fromMs + 3 * 366 * DAY;
  const all = occurrences(snapshot, zones, fromMs, far);
  const events = source.events.map((e) => {
    const rows = citedRows(e);
    const missing = rows.filter((id) => !byId.has(id));
    const regions = {};
    for (const r of REGIONS) {
      const s = e.schedules ? e.schedules[r] : null;
      const known = Date.parse(cat.get(e.category).knownUntil[r]);
      const published = s ? S.windows(s, fromMs, known).filter((w) => w.start >= fromMs && w.start < known) : [];
      const occ = all.filter((o) => o.region === r && rows.includes(o.holidayId));
      const expected = occ.filter((o) => o.start < known);
      const matched = new Set(), notInClient = [], phaseOf = [];
      for (const w of published) {
        const hit = expected.find((o) => !matched.has(o) && ((o.start === w.start && o.end === w.end) || o.phases.some(([a, b]) => a === w.start && b === w.end)));
        if (hit) { matched.add(hit); if (!(hit.start === w.start && hit.end === w.end)) phaseOf.push(hit.phases.findIndex(([a, b]) => a === w.start && b === w.end) + 1); }
        else notInClient.push(w);
      }
      const notPublished = expected.filter((o) => !matched.has(o));
      const after = occ.filter((o) => o.start >= known);
      const endless = rows.some((id) => byId.has(id) && ['annual', 'weekly', 'daily'].includes(byId.get(id).kind) && regionsOf(byId.get(id).regionMask).includes(r));
      const lastPublished = published.length ? Math.max(...published.map((w) => w.end)) : null;
      regions[r] = {
        confidence: s ? confidence(e, s) : '-', published: published.length, matched: matched.size, phases: [...new Set(phaseOf)].sort(),
        notInClient, notPublished, knownUntil: known, lastPublishedEnd: lastPublished,
        clientAfterKnown: after.length ? (endless ? 'repeats with no end' : `to ${isoMin(Math.max(...after.map((o) => o.start)))}`) : 'nothing later',
        result: !rows.length ? 'no client rows' : notInClient.length || notPublished.length ? 'differs' : 'matches',
      };
    }
    return { id: e.id, name: e.name, category: e.category, status: e.status, lastVerified: e.lastVerified, rows, missingRows: missing,
      sources: (e.sources || []).map((x) => ({ kind: x.kind, publisher: x.publisher, quote: x.kind === 'client' ? x.quote : null, url: x.url })), regions };
  });
  const cited = new Set(events.flatMap((e) => e.rows));
  const uncited = snapshot.table.filter((r) => !cited.has(r.holidayId)).map((r) => ({
    holidayId: r.holidayId, name: r.name, kind: r.kind, dates: r.dates.map(describeDate).slice(0, 3), more: Math.max(0, r.dates.length - 3),
    inRange: REGIONS.filter((reg) => all.some((o) => o.holidayId === r.holidayId && o.region === reg && o.start < Date.parse(source.meta.coversUntil + 'T23:59:59Z'))),
  }));
  return { zones, events, uncited };
}

// ---- The report ----

/**
 * Two decoders must agree: the tool's occurrences against the rows an independent script wrote into a fixture,
 * over what that script decoded (its rows' holiday ids, and its from/until, else its first and last start).
 */
export function crossCheck(snapshot, zones, fixture) {
  const rows = fixture.rows;
  const ids = new Set(rows.map((x) => x.holidayId));
  const starts = rows.map((x) => Date.parse(x.startUtc));
  const from = fixture.from ? Date.parse(fixture.from) : Math.min(...starts), until = fixture.until ? Date.parse(fixture.until) : Math.max(...starts) + 1;
  const z = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const mine = new Set(occurrences(snapshot, zones, from, until).filter((o) => ids.has(o.holidayId)).map((o) => `${o.region} ${o.holidayId} ${z(o.start)} ${o.end == null ? '-' : z(o.end)}`));
  // A row with no duration has no end; the Retail script wrote its end as its start (start + 0 hours).
  const theirs = new Set(rows.map((x) => `${x.region} ${x.holidayId} ${x.startUtc} ${Array.isArray(x.durationsH) && !x.durationsH.length ? '-' : x.endUtc || '-'}`));
  return { from: isoMin(from), until: isoMin(until), agree: [...theirs].filter((k) => mine.has(k)).length, onlyTool: [...mine].filter((k) => !theirs.has(k)).sort(), onlyFixture: [...theirs].filter((k) => !mine.has(k)).sort() };
}

const cell = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
const win = (w) => `${isoMin(w.start)} to ${isoMin(w.end)}`;

/**
 * The whole comparison as JSON and Markdown, and an exit code: 0 when nothing published is affected and the
 * builds agree, 1 when there is something to review. Deterministic: the same inputs give the same bytes.
 */
export function compare({ oldSnap = null, newSnap, source, fromMs, untilMs, crossCheckFixture = null }) {
  const edition = source.meta.edition || 'retail';
  if (newSnap.edition !== edition) throw new Error(`the snapshot is ${newSnap.product} (${newSnap.edition}), the data is ${edition}`);
  if (oldSnap && oldSnap.edition !== edition) throw new Error(`the old snapshot is ${oldSnap.product} (${oldSnap.edition}), the data is ${edition}`);
  const zones = zonesFor(source);
  const rows = oldSnap ? diffRows(oldSnap, newSnap) : null;
  const occ = oldSnap ? diffOccurrences(occurrences(oldSnap, zones, fromMs, untilMs), occurrences(newSnap, zones, fromMs, untilMs)) : null;
  const imp = impact(newSnap, source, fromMs);
  const cross = crossCheckFixture ? crossCheck(newSnap, zones, crossCheckFixture) : null;
  const differs = imp.events.filter((e) => Object.values(e.regions).some((r) => r.result === 'differs') || e.missingRows.length);
  const buildChanges = rows ? rows.added.length + rows.removed.length + rows.changed.length : 0;
  const code = differs.length || buildChanges ? 1 : 0;

  const md = [];
  const title = source.meta.game || edition;
  md.push(`# ${title}: ${oldSnap ? `${oldSnap.product} ${oldSnap.build} to ` : ''}${newSnap.product} ${newSnap.build}`, '');
  md.push(`This report changes nothing. Published data: ${source.meta.game}, r${source.meta.datasetRevision} (reviewed ${source.meta.reviewedOn}, client ${source.meta.clientBuild}). Windows compared from ${isoMin(fromMs)}${oldSnap ? `; builds compared to ${isoMin(untilMs)}` : ''}.`, '');
  md.push('Server clocks used for every instant below:', '');
  for (const r of REGIONS) md.push(`- ${r === 'us' ? 'Americas' : 'Europe'}: ${zones[r].name} (${zones[r].zone}), ${zones[r].status}`);
  md.push('', 'The client tables give wall times without a zone: they can confirm dates, durations and regions, never an instant on a clock that is not known.', '');
  if (cross) {
    md.push('## Decoder cross-check', '', cross.onlyTool.length || cross.onlyFixture.length
      ? `DISAGREE: ${cross.agree} windows agree; only this tool: ${cross.onlyTool.length}; only the fixture: ${cross.onlyFixture.length}.`
      : `${cross.agree} windows agree with the independent decoder's fixture (${cross.from} to ${cross.until}); none differ.`, '');
    for (const k of cross.onlyTool.slice(0, 20)) md.push(`- only this tool: ${k}`);
    for (const k of cross.onlyFixture.slice(0, 20)) md.push(`- only the fixture: ${k}`);
    if (cross.onlyTool.length || cross.onlyFixture.length) md.push('');
  }
  if (rows) {
    md.push('## Rows', '', `${rows.added.length} added, ${rows.removed.length} removed, ${rows.changed.length} changed.`, '');
    for (const r of rows.added) md.push(`- added ${r.holidayId} "${r.name || '(no name)'}" ${r.kind}, ${r.durationsH.join('+') || 'no'} h, ${r.dates.slice(0, 3).map(describeDate).join('; ')}${r.dates.length > 3 ? ` and ${r.dates.length - 3} more` : ''}`);
    for (const r of rows.removed) md.push(`- removed ${r.holidayId} "${r.name || '(no name)'}" ${r.kind}`);
    for (const x of rows.replaced) md.push(`- row ${x.to} replaces row ${x.from} ("${x.name}")`);
    for (const c of rows.changed) {
      const parts = c.fields.map((f) => `${f.field} ${JSON.stringify(f.old)} to ${JSON.stringify(f.new)}`);
      if (c.datesAdded.length) parts.push(`dates added: ${c.datesAdded.join('; ')}`);
      if (c.datesRemoved.length) parts.push(`dates removed: ${c.datesRemoved.join('; ')}`);
      md.push(`- changed ${c.holidayId} "${c.name || '(no name)'}"${c.oldName !== c.name ? ` (was "${c.oldName}")` : ''}: ${parts.join('; ')}`);
    }
    md.push('', '## Occurrences', '', `${occ.unchanged} unchanged, ${occ.added.length} added, ${occ.removed.length} removed, ${occ.moved.length} moved, ${occ.resized.length} with a new length (looping rows not expanded).`, '');
    for (const o of occ.added) md.push(`- added ${o.region} ${o.holidayId} "${o.name}": ${win(o)}`);
    for (const o of occ.removed) md.push(`- removed ${o.region} ${o.holidayId} "${o.name}": ${win(o)}`);
    for (const o of occ.moved) md.push(`- moved ${o.region} ${o.holidayId} "${o.name}": ${isoMin(o.old[0])} to ${isoMin(o.new[0])} (${(o.new[0] - o.old[0]) / HOUR > 0 ? '+' : ''}${(o.new[0] - o.old[0]) / HOUR} h)`);
    for (const o of occ.resized) md.push(`- new length ${o.region} ${o.holidayId} "${o.name}": ends ${isoMin(o.old[1])} then ${isoMin(o.new[1])}`);
    md.push('');
  }
  md.push('## Published events', '', '| Event | Rows | Region | Confidence | Published | Result | Known until | Client data after that |', '|---|---|---|---|---|---|---|---|');
  for (const e of imp.events) {
    for (const r of REGIONS) {
      const x = e.regions[r];
      md.push(`| ${cell(e.name)} | ${e.rows.join(', ') || '-'} | ${r} | ${x.confidence} | ${x.published}${x.phases.length ? ` (phase ${x.phases.join(', ')})` : ''} | ${x.result} | ${isoMin(x.knownUntil)} | ${e.rows.length ? x.clientAfterKnown : '-'} |`);
    }
  }
  md.push('');
  for (const e of differs) {
    md.push(`### ${e.name}: needs a review`, '');
    if (e.missingRows.length) md.push(`- cited rows not in this build: ${e.missingRows.join(', ')}`);
    for (const r of REGIONS) {
      for (const w of e.regions[r].notInClient) md.push(`- ${r}: published ${win(w)}, not in the client data`);
      for (const o of e.regions[r].notPublished) md.push(`- ${r}: client ${win(o)} (row ${o.holidayId}, ${o.wall} server time), not published`);
    }
    md.push(`- sources: ${e.sources.map((s) => (s.quote ? `${s.publisher}: "${s.quote}"` : `${s.publisher} ${s.url}`)).join('; ')}`, `- last verified ${e.lastVerified}`, '');
  }
  md.push('## Coverage and sources', '', 'Per event: the end of its last published window and the date its data is known until, in each region; how far the client data reaches after that; its sources (client rows quoted); when it was last checked.', '');
  for (const e of imp.events) {
    const reach = REGIONS.map((r) => `${r} last window ends ${isoMin(e.regions[r].lastPublishedEnd)}, known until ${isoMin(e.regions[r].knownUntil)}${e.rows.length ? `, client data after that: ${e.regions[r].clientAfterKnown}` : ''}`).join('; ');
    md.push(`- ${e.name} (${e.id}), checked ${e.lastVerified}: ${reach}. Sources: ${e.sources.map((s) => (s.quote ? `${s.publisher}: "${s.quote}"` : `${s.publisher} ${s.url}`)).join('; ')}`);
  }
  md.push('');
  const active = imp.uncited.filter((u) => u.inRange.length);
  md.push('## Rows no event cites', '', `${active.length} with a window in the data's range (listed); ${imp.uncited.length - active.length} more with none.`, '');
  for (const u of active) md.push(`- ${u.holidayId} "${u.name || '(no name)'}" ${u.kind}: ${u.dates.join('; ') || 'no dates'}${u.more ? ` and ${u.more} more` : ''}; in range for ${u.inRange.join(', ')}`);
  md.push('', `Result: ${code === 0 ? 'nothing published is affected' : 'something to review'}. Nothing was changed.`, '');

  const json = {
    format: 'wowtracker-calendar-report/1', edition, data: { revision: source.meta.datasetRevision, reviewedOn: source.meta.reviewedOn, clientBuild: source.meta.clientBuild },
    old: oldSnap && { product: oldSnap.product, build: oldSnap.build }, new: { product: newSnap.product, build: newSnap.build },
    from: isoMin(fromMs), until: isoMin(untilMs), zones, crossCheck: cross, rows, occurrences: occ, impact: imp, result: code === 0 ? 'unaffected' : 'review',
  };
  return { json, markdown: md.join('\n'), code };
}
