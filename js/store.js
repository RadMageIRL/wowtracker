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
      aheadHours: 168, compact: false, timeMode: 'local', theme: 'dark', newsCollapsed: false, newsAll: false, newsShop: false,
      checklistOpen: false,
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
      // News is open unless the reader collapsed it. v0.1 saved newsOpen: false for everyone who never
      // opened news, so that old field is ignored and v0.1 settings come back with news open.
      newsCollapsed: raw.newsCollapsed === true,
      newsAll: raw.newsAll === true,
      newsShop: raw.newsShop === true,
      // Your checklist starts folded to one line; opening it is remembered.
      checklistOpen: raw.checklistOpen === true,
    };
  }

  /**
   * The storage key of one piece of state in an edition of the game. Retail keeps the keys it has
   * always had ("checklist" is wowtracker:v1:checklist); another edition would get its own
   * ("forever:checklist"), so its tasks and ticks never mix with Retail's.
   */
  const editionKey = (name, edition) => (!edition || edition === 'retail' ? name : `${edition}:${name}`);

  // ---- Editions: which settings are the reader's, and which belong to one edition's dataset ----

  /** About the reader, the same in every edition. They live in "prefs", as they always have. */
  const SHARED_PREFS = ['region', 'aheadHours', 'compact', 'timeMode', 'theme', 'newsCollapsed', 'newsAll', 'newsShop'];
  /** About one edition's events and categories. Retail keeps them in "prefs"; another edition in "<edition>:prefs". */
  const EDITION_PREFS = ['filter', 'categories', 'starred', 'hidden', 'checklistOpen'];
  const pickKeys = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

  /** The shared settings from saved preferences, cleaned. */
  const sanitizeShared = (raw, zone) => pickKeys(sanitizePrefs(raw, [], [], zone), SHARED_PREFS);
  /** One edition's own settings, cleaned against that edition's event and category ids. */
  const sanitizeEditionPrefs = (raw, eventIds, categoryIds) => pickKeys(sanitizePrefs(raw, eventIds, categoryIds, 'UTC'), EDITION_PREFS);
  /** The part of preferences an edition other than Retail stores under its own key. */
  const editionPrefs = (prefs) => pickKeys(prefs, EDITION_PREFS);

  /**
   * What an edition other than Retail writes back to "prefs": the stored object exactly as it is,
   * with only the shared settings replaced. Retail's stars, hidden events, categories, filter and
   * checklist choice are never touched (cleaning them against another edition's ids would erase them).
   */
  function mergeShared(raw, prefs) {
    return Object.assign({}, isObj(raw) ? raw : {}, pickKeys(prefs, SHARED_PREFS));
  }

  /**
   * The edition a page shows: a link's "#forever" first (it is not saved), then the reader's saved
   * choice, then the default (the first id). Anything else, such as "#coming-title", is ignored.
   */
  function pickEdition(hash, saved, ids) {
    const h = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
    if (ids.includes(h)) return h;
    if (typeof saved === 'string' && ids.includes(saved)) return saved;
    return ids[0];
  }

  // localStorage can be missing or throw (private windows, blocked storage); the page still works.
  function read(storage, key) {
    try { const s = storage && storage.getItem(PREFIX + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function write(storage, key, value) {
    try { storage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  const Store = { PREFIX, REGIONS, FILTERS, AHEAD_HOURS, TIME_MODES, THEMES, SHARED_PREFS, EDITION_PREFS, guessRegion, defaults, sanitizePrefs, sanitizeShared, sanitizeEditionPrefs, editionPrefs, mergeShared, pickEdition, editionKey, read, write };
  if (typeof module === 'object' && module.exports) module.exports = Store;
  else root.WoWStore = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
