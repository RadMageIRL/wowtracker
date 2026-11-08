// Settings backup: preferences, stars, hidden events, reminders and the checklist as one line of JSON
// the reader keeps, and the checks a pasted or opened backup must pass before anything is replaced.
// Pure, so the page and the Node tests share it. Nothing is sent anywhere; the page shows what a
// backup holds and replaces the current settings only after the reader confirms.
(function (root) {
  'use strict';

  const APP = 'wowtracker';
  const FORMAT = 1;
  /** A real backup is a few kilobytes; anything far larger is refused unread. */
  const MAX_CHARS = 200000;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** The backup text: { app, format, edition, version, saved, prefs, reminders, checklist }. */
  function make({ prefs, reminders, checklist, edition = 'retail', version, now }) {
    return JSON.stringify({ app: APP, format: FORMAT, edition, version: String(version || ''), saved: new Date(now).toISOString(), prefs, reminders, checklist });
  }

  /**
   * A backup read back. { ok: true, data: { prefs, reminders, checklist }, saved, version, dropped }
   * or { ok: false, error }. Every part goes through the same sanitizer as saved settings, so an id
   * this dataset does not know, a wrong type or a hostile string is dropped or falls back to the
   * default; dropped counts what was left out. clean: { prefs(raw), reminders(raw), checklist(raw) }.
   */
  function read(text, clean, edition = 'retail') {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
    if (text.length > MAX_CHARS) return { ok: false, error: 'too-big' };
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: 'not-json' }; }
    if (!isObj(raw) || raw.app !== APP) return { ok: false, error: 'not-ours' };
    if (raw.format !== FORMAT) return { ok: false, error: 'format' };
    if ((raw.edition === undefined ? 'retail' : raw.edition) !== edition) return { ok: false, error: 'edition' };
    if (!isObj(raw.prefs) && !isObj(raw.reminders) && !isObj(raw.checklist)) return { ok: false, error: 'nothing' };
    const data = { prefs: clean.prefs(raw.prefs), reminders: clean.reminders(raw.reminders), checklist: clean.checklist(raw.checklist) };
    const count = (v) => (Array.isArray(v) ? new Set(v).size : 0);
    const p = isObj(raw.prefs) ? raw.prefs : {}, c = isObj(raw.checklist) ? raw.checklist : {};
    const dropped = {
      starred: Math.max(0, count(p.starred) - data.prefs.starred.length),
      hidden: Math.max(0, count(p.hidden) - data.prefs.hidden.length),
      tasks: Math.max(0, (Array.isArray(c.tasks) ? c.tasks.length : 0) - data.checklist.tasks.length),
    };
    const saved = typeof raw.saved === 'string' && Number.isFinite(Date.parse(raw.saved)) ? Date.parse(raw.saved) : null;
    const version = typeof raw.version === 'string' && /^\d+\.\d+\.\d+$/.test(raw.version) ? raw.version : null;
    return { ok: true, data, saved, version, dropped };
  }

  const ERRORS = {
    empty: 'Paste a backup first, or open a backup file.',
    'too-big': 'That is far larger than a WoW Tracker backup, so it was not read.',
    'not-json': 'That is not a WoW Tracker backup: it is not valid JSON. Paste the whole text you copied.',
    'not-ours': 'That is valid JSON but not a WoW Tracker backup.',
    format: 'That backup was made by a newer WoW Tracker. Reload the page to get the latest version, then try again.',
    edition: 'That backup belongs to another edition of WoW Tracker.',
    nothing: 'That backup holds no settings.',
  };

  const Backup = { APP, FORMAT, MAX_CHARS, ERRORS, make, read };
  if (typeof module === 'object' && module.exports) module.exports = Backup;
  else root.WoWBackup = Backup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
