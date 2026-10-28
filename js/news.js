// Latest news from Blizzard News (news.blizzard.com), the official World of Warcraft news site. Its
// list does not allow cross-origin reads, so the page asks its own site for news.json: the local
// server (tools/serve.mjs) passes that through to Blizzard's list. Where nothing answers (a file
// opened from disk, a host without the pass-through) the section links to Blizzard News instead.
// Only titles, links, dates and categories are used, always as plain text, and only links back to
// news.blizzard.com are kept. Parsing is pure so the Node tests can check it.
(function (root) {
  'use strict';

  /** Next to the page, so it resolves under whatever folder the page is served from. */
  const NEWS_PATH = 'news.json';
  const NEWS_HOST = 'news.blizzard.com';
  const BLIZZARD_NEWS = 'https://news.blizzard.com/en-us/feed/world-of-warcraft';
  /** Blizzard's list behind news.json (used by tools/serve.mjs). */
  const UPSTREAM = 'https://news.blizzard.com/en-us/api/feed/world-of-warcraft';
  const MAX_ITEMS = 8;
  /** A copy younger than this is used as is; an open section asks again once it is older. */
  const REFRESH_MS = 15 * 60000;
  const TIMEOUT_MS = 8000;

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

  // Dashes become plain hyphens; control characters are dropped.
  function safeChar(code) {
    if (code === 0x2013 || code === 0x2014 || code === 0x2015) return '-';
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff) return '';
    return String.fromCodePoint(code);
  }
  function decode(s) {
    return s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
  }
  const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014, 0x2015) + ']', 'g');
  const CONTROLS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + String.fromCharCode(0x7f) + '-' + String.fromCharCode(0x9f) + ']', 'g');

  /** Text for the page: entities decoded, any markup removed, dashes plain, whitespace collapsed. */
  function plainText(raw, max) {
    if (typeof raw !== 'string') return '';
    return decode(decode(raw).replace(/<[^>]*>/g, '')).replace(DASHES, '-').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /** An https link to an English page of news.blizzard.com, without query or fragment; null for anything else. */
  function cleanLink(raw) {
    if (typeof raw !== 'string') return null;
    let u;
    try { u = new URL(raw.trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.hostname !== NEWS_HOST || u.port || u.username || u.password || !u.pathname.startsWith('/en-us/')) return null;
    return `https://${NEWS_HOST}${u.pathname}`;
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function item(title, link, dateMs, category) {
    const t = plainText(title, 200), l = cleanLink(link);
    if (!t || !l) return null;
    return { title: t, link: l, dateMs: typeof dateMs === 'number' && Number.isFinite(dateMs) ? dateMs : null, category: plainText(category, 40) };
  }

  function newestFirst(items, max) {
    const seen = new Set();
    return items
      .filter((i) => !seen.has(i.link) && Boolean(seen.add(i.link)))
      .sort((a, b) => (b.dateMs === null ? -Infinity : b.dateMs) - (a.dateMs === null ? -Infinity : a.dateMs))
      .slice(0, max);
  }

  /**
   * The newest posts in Blizzard's list (`contentItems[].properties`), newest first. The list gives
   * one date per post, `lastUpdated`, so an article Blizzard edits later moves up with its new date.
   */
  function parseNews(raw, max) {
    const list = isObj(raw) && Array.isArray(raw.contentItems) ? raw.contentItems : [];
    const items = [];
    for (const entry of list) {
      const p = isObj(entry) && isObj(entry.properties) ? entry.properties : null;
      if (!p) continue;
      const dateMs = typeof p.lastUpdated === 'string' ? Date.parse(p.lastUpdated) : NaN;
      const i = item(p.title, p.newsUrl, dateMs, p.category);
      if (i) items.push(i);
    }
    return newestFirst(items, max || MAX_ITEMS);
  }

  const isFresh = (cache, nowMs) => Boolean(cache) && nowMs >= cache.fetchedAt && nowMs - cache.fetchedAt < REFRESH_MS;

  /** A copy read back from storage, kept only if it still looks like what parseNews returns. */
  function sanitizeCache(raw) {
    if (!isObj(raw) || typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt) || !Array.isArray(raw.items)) return null;
    const items = raw.items.filter(isObj).filter((i) => typeof i.link === 'string' && cleanLink(i.link) === i.link)
      .map((i) => item(i.title, i.link, i.dateMs, i.category)).filter(Boolean);
    return items.length ? { fetchedAt: raw.fetchedAt, items: newestFirst(items, MAX_ITEMS) } : null;
  }

  const News = { NEWS_PATH, NEWS_HOST, BLIZZARD_NEWS, UPSTREAM, MAX_ITEMS, REFRESH_MS, TIMEOUT_MS, plainText, cleanLink, parseNews, isFresh, sanitizeCache };
  if (typeof module === 'object' && module.exports) module.exports = News;
  else root.WoWNews = News;
})(typeof globalThis !== 'undefined' ? globalThis : this);
