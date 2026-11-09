// Settings backup: the settings shared by every edition, the reminder settings, and each edition's own
// choices (stars, hidden events, categories, the Starred view, the checklist) as one line of JSON the
// reader keeps, and the checks a pasted or opened backup must pass before anything is replaced. Pure, so
// the page and the Node tests share it. Nothing is sent anywhere; the page shows what a backup would
// change and replaces settings only after the reader confirms.
//
// Format 2 (v0.3): { app, format: 2, version, saved, shared: { prefs, reminders }, editions: { retail:
// { prefs, checklist }, forever: { prefs, checklist } } }. An edition missing from a backup is left as it
// is when the backup is restored. Format 1 (v0.1 and v0.2): { app, format: 1, edition, version, saved,
// prefs, reminders, checklist }, one edition (Retail, unless it names another): it restores the shared
// settings, the reminder settings and that edition only.
(function (root) {
  'use strict';

  const APP = 'wowtracker';
  const FORMAT = 2;
  /** A real backup is a few kilobytes; anything far larger is refused unread. */
  const MAX_CHARS = 200000;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** The backup text. editions: { [id]: { prefs, checklist } }, only the editions that have anything saved. */
  function make({ shared, reminders, editions, version, now }) {
    return JSON.stringify({ app: APP, format: FORMAT, version: String(version || ''), saved: new Date(now).toISOString(), shared: { prefs: shared, reminders }, editions });
  }

  /**
   * A backup read back: { ok: true, format, saved, version, shared, reminders, editions, unknown, dropped }
   * or { ok: false, error }. shared and reminders are null when the backup has no shared part (they are
   * then left as they are); editions holds only the editions the backup has, each { prefs, checklist };
   * unknown names the editions this version does not have (left out). Every part goes through the same
   * sanitizer as saved settings, so an id an edition does not know, a wrong type or a hostile string is
   * dropped or falls back to the default; dropped counts, per edition, what was left out.
   * clean: { shared(raw), reminders(raw), editions: { [id]: { prefs(raw), checklist(raw) } } }.
   */
  function read(text, clean) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
    if (text.length > MAX_CHARS) return { ok: false, error: 'too-big' };
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: 'not-json' }; }
    if (!isObj(raw) || raw.app !== APP) return { ok: false, error: 'not-ours' };
    if (raw.format !== 1 && raw.format !== 2) return { ok: false, error: 'format' };
    const known = Object.keys(clean.editions);
    // Both formats as one shape: the shared part, and each edition's raw part.
    let sharedRaw = null, remRaw = null, parts = {}, unknown = [];
    if (raw.format === 1) {
      const edition = raw.edition === undefined ? 'retail' : raw.edition;
      if (!known.includes(edition)) return { ok: false, error: 'edition' };
      if (!isObj(raw.prefs) && !isObj(raw.reminders) && !isObj(raw.checklist)) return { ok: false, error: 'nothing' };
      // A format 1 backup always replaced every setting it covers, missing ones with their defaults.
      sharedRaw = isObj(raw.prefs) ? raw.prefs : {};
      remRaw = raw.reminders;
      parts = { [edition]: { prefs: raw.prefs, checklist: raw.checklist } };
    } else {
      if (raw.shared !== undefined && !isObj(raw.shared)) return { ok: false, error: 'damaged' };
      if (raw.editions !== undefined && !isObj(raw.editions)) return { ok: false, error: 'damaged' };
      const eds = isObj(raw.editions) ? raw.editions : {};
      for (const id of Object.keys(eds)) {
        if (!known.includes(id)) { unknown.push(/^[a-z][a-z0-9-]{0,19}$/.test(id) ? id : 'unnamed'); continue; }
        if (!isObj(eds[id])) return { ok: false, error: 'damaged' };
        parts[id] = { prefs: eds[id].prefs, checklist: eds[id].checklist };
      }
      if (isObj(raw.shared)) { sharedRaw = isObj(raw.shared.prefs) ? raw.shared.prefs : {}; remRaw = raw.shared.reminders; }
      if (sharedRaw === null && !Object.keys(parts).length) return { ok: false, error: unknown.length ? 'edition' : 'nothing' };
      unknown = [...new Set(unknown)].slice(0, 5);
    }
    const count = (v) => (Array.isArray(v) ? new Set(v).size : 0);
    const editions = {}, dropped = {};
    for (const id of known) {
      if (!own(parts, id)) continue;
      const p = isObj(parts[id].prefs) ? parts[id].prefs : {}, c = isObj(parts[id].checklist) ? parts[id].checklist : {};
      const e = { prefs: clean.editions[id].prefs(parts[id].prefs), checklist: clean.editions[id].checklist(parts[id].checklist) };
      editions[id] = e;
      dropped[id] = {
        starred: Math.max(0, count(p.starred) - e.prefs.starred.length),
        hidden: Math.max(0, count(p.hidden) - e.prefs.hidden.length),
        tasks: Math.max(0, (Array.isArray(c.tasks) ? c.tasks.length : 0) - e.checklist.tasks.length),
      };
    }
    const saved = typeof raw.saved === 'string' && Number.isFinite(Date.parse(raw.saved)) ? Date.parse(raw.saved) : null;
    const version = typeof raw.version === 'string' && /^\d+\.\d+\.\d+$/.test(raw.version) ? raw.version : null;
    return {
      ok: true, format: raw.format, saved, version,
      shared: sharedRaw === null ? null : clean.shared(sharedRaw),
      reminders: sharedRaw === null ? null : clean.reminders(remRaw),
      editions, unknown, dropped,
    };
  }

  const ERRORS = {
    empty: 'Paste a backup first, or open a backup file.',
    'too-big': 'That is far larger than a WoW Tracker backup, so it was not read.',
    'not-json': 'That is not a WoW Tracker backup: it is not valid JSON. Paste the whole text you copied.',
    'not-ours': 'That is valid JSON but not a WoW Tracker backup.',
    format: 'That backup was made by a newer WoW Tracker. Reload the page to get the latest version, then try again.',
    edition: 'That backup is for a game version this WoW Tracker does not have.',
    damaged: 'That backup is damaged: a part of it is not what a WoW Tracker backup holds.',
    nothing: 'That backup holds no settings.',
  };

  const Backup = { APP, FORMAT, MAX_CHARS, ERRORS, make, read };
  if (typeof module === 'object' && module.exports) module.exports = Backup;
  else root.WoWBackup = Backup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
