// Saved settings. Everything stays in this browser's localStorage under one prefix, because one
// origin (radmagelabs.com, github.io) can serve several apps. Saved data is never trusted: it is
// checked against the current dataset on every load, so a stale or edited value falls back to the
// default instead of breaking the page.
(function (root) {
  'use strict';

  const PREFIX = 'wowtracker:v1:';
  const REGIONS = ['us', 'eu'];
  const FILTERS = ['all', 'starred'];
  const AHEAD_HOURS = [1, 2, 4, 8, 24, 72, 168];
  const TIME_MODES = ['local', 'both', 'utc'];
  const THEMES = ['dark', 'light', 'system'];

  /** Europe's realms for a device in a European zone, the Americas' otherwise. */
  function guessRegion(zone) {
    const z = typeof zone === 'string' ? zone : '';
    return /^Europe\//.test(z) || /^Atlantic\/(Reykjavik|Canary|Faroe|Madeira|Azores)$/.test(z) ? 'eu' : 'us';
  }

  function defaults(categoryIds, zone) {
    return {
      region: guessRegion(zone), filter: 'all', categories: categoryIds.slice(), starred: [], hidden: [],
      aheadHours: 168, compact: false, timeMode: 'local', theme: 'dark', newsOpen: false,
    };
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const idList = (v, known) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && known.has(x)))] : []);

  /** Saved preferences, cleaned against the dataset's event and category ids. */
  function sanitizePrefs(raw, eventIds, categoryIds, zone) {
    const d = defaults(categoryIds, zone);
    if (!isObj(raw)) return d;
    const events = new Set(eventIds), categories = new Set(categoryIds);
    return {
      region: pick(raw.region, REGIONS, d.region),
      filter: pick(raw.filter, FILTERS, d.filter),
      categories: Array.isArray(raw.categories) ? idList(raw.categories, categories) : d.categories,
      starred: idList(raw.starred, events),
      hidden: idList(raw.hidden, events),
      aheadHours: pick(raw.aheadHours, AHEAD_HOURS, d.aheadHours),
      compact: raw.compact === true,
      timeMode: pick(raw.timeMode, TIME_MODES, d.timeMode),
      theme: pick(raw.theme, THEMES, d.theme),
      newsOpen: raw.newsOpen === true,
    };
  }

  // localStorage can be missing or throw (private windows, blocked storage); the page still works.
  function read(storage, key) {
    try { const s = storage && storage.getItem(PREFIX + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function write(storage, key, value) {
    try { storage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  const Store = { PREFIX, REGIONS, FILTERS, AHEAD_HOURS, TIME_MODES, THEMES, guessRegion, defaults, sanitizePrefs, read, write };
  if (typeof module === 'object' && module.exports) module.exports = Store;
  else root.WoWStore = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
