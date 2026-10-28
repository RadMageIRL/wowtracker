// Saved settings, the news parser and the clock check. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Store = require('../js/store.js');
const News = require('../js/news.js');
const Clock = require('../js/clock.js');

const FEED = JSON.parse(readFileSync(new URL('./fixtures/news-feed.json', import.meta.url), 'utf8'));
const EVENTS = ['darkmoon-faire', 'hallows-end'];
const CATS = ['holiday', 'darkmoon'];

/** A localStorage stand-in; `broken` throws on every call, as blocked storage does. */
function memoryStorage(broken) {
  const m = new Map();
  return {
    getItem(k) { if (broken) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('blocked'); m.set(k, String(v)); },
    dump: () => Object.fromEntries(m),
  };
}

export function unitTests(test) {
  // ---- Saved settings ----

  test('garbage saved settings fall back to the defaults', () => {
    for (const raw of [null, 7, 'x', [], { region: 'kr', filter: 'nope', aheadHours: 5, timeMode: 'gmt', theme: 'neon' }]) {
      const p = Store.sanitizePrefs(raw, EVENTS, CATS, 'America/Chicago');
      assert.equal(p.region, 'us');
      assert.equal(p.filter, 'all');
      assert.equal(p.aheadHours, 168);
      assert.equal(p.timeMode, 'local');
      assert.equal(p.theme, 'dark');
      assert.deepEqual(p.categories, CATS);
      assert.equal(p.compact, false);
      assert.equal(p.newsOpen, false);
    }
  });

  test('a European device zone starts on Europe, everything else on the Americas', () => {
    assert.equal(Store.defaults(CATS, 'Europe/Berlin').region, 'eu');
    assert.equal(Store.defaults(CATS, 'Atlantic/Reykjavik').region, 'eu');
    assert.equal(Store.defaults(CATS, 'America/Sao_Paulo').region, 'us');
    assert.equal(Store.defaults(CATS, 'Australia/Sydney').region, 'us');
    assert.equal(Store.defaults(CATS, undefined).region, 'us');
  });

  test('saved stars, hidden events and categories keep only ids the dataset knows, once each', () => {
    const p = Store.sanitizePrefs({ starred: ['hallows-end', 'gone', 'hallows-end', 5], hidden: ['darkmoon-faire', null], categories: ['holiday', 'retired'] }, EVENTS, CATS, 'UTC');
    assert.deepEqual(p.starred, ['hallows-end']);
    assert.deepEqual(p.hidden, ['darkmoon-faire']);
    assert.deepEqual(p.categories, ['holiday']);
  });

  test('a saved region, filter, span, time mode, theme and news choices come back as saved', () => {
    const p = Store.sanitizePrefs({ region: 'eu', filter: 'starred', aheadHours: 8, timeMode: 'utc', theme: 'system', compact: true, newsOpen: true, newsShop: true }, EVENTS, CATS, 'America/Chicago');
    assert.deepEqual([p.region, p.filter, p.aheadHours, p.timeMode, p.theme, p.compact, p.newsOpen, p.newsShop], ['eu', 'starred', 8, 'utc', 'system', true, true, true]);
    assert.equal(Store.sanitizePrefs({}, EVENTS, CATS, 'UTC').newsShop, false, 'shop posts are hidden by default');
    assert.equal(Store.sanitizePrefs({ newsShop: 'yes' }, EVENTS, CATS, 'UTC').newsShop, false);
  });

  test('settings round-trip through storage under the wowtracker:v1: prefix; blocked storage never throws', () => {
    const s = memoryStorage(false);
    assert.equal(Store.write(s, 'prefs', { region: 'eu' }), true);
    assert.deepEqual(Object.keys(s.dump()), ['wowtracker:v1:prefs']);
    assert.deepEqual(Store.read(s, 'prefs'), { region: 'eu' });
    const b = memoryStorage(true);
    assert.equal(Store.write(b, 'prefs', {}), false);
    assert.equal(Store.read(b, 'prefs'), null);
    assert.equal(Store.read(null, 'prefs'), null);
    s.setItem('wowtracker:v1:prefs', '{not json');
    assert.equal(Store.read(s, 'prefs'), null);
  });

  // ---- News ----

  test('news keeps Blizzard links as plain text, newest first, up to twenty, and shows at most eight', () => {
    const items = News.parseNews(FEED);
    assert.equal(items.length, 19); // every usable post in the fixture, under the 20 kept
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].dateMs >= items[i].dateMs);
    for (const i of items) assert.match(i.link, /^https:\/\/news\.blizzard\.com\/en-us\/[^?#]*$/);
    assert.equal(items[0].title, 'Hotfixes: October 27, 2026');
    assert.equal(items[0].category, 'News');
    assert.equal(News.visible(items, false).length, 8);
    assert.equal(News.visible(items, true).length, 8);
  });

  test('shop posts are only Blizzard\'s Shop Now, Sale, On Sale and Pre-purchase categories, in any case or spacing', () => {
    const items = News.parseNews(FEED);
    assert.deepEqual(items.filter(News.isShop).map((i) => i.category).sort(), ['ON SALE', 'Pre-purchase', 'Sale', 'Shop Now', 'Shop Now']);
    assert.equal(News.isShop({ title: 'Anything', category: ' PRE-PURCHASE ' }), true);
    for (const category of ['News', 'This Week in WoW', 'New Content Update', 'Trading Post', 'Twitch Drops', 'Limited-Time Event', 'New Mount', 'Pre-order', 'Prepurchase', '']) {
      assert.equal(News.isShop({ title: 'Shop sale: 50% off a new mount', category }), false, category);
    }
  });

  test('by default the shop posts are left out, game news that mentions a sale or a mount stays, and asking shows them', () => {
    const items = News.parseNews(FEED);
    const plain = News.visible(items, false);
    assert.ok(plain.every((i) => !News.isShop(i)));
    assert.ok(plain.some((i) => i.title === 'Hotfixes: a mount sale price shown wrong in the shop is fixed'));
    assert.ok(plain.some((i) => i.title === 'Twitch Drop now live: a free mount'));
    assert.ok(items.filter((i) => !News.isShop(i)).some((i) => i.category === 'New Mount'), 'New Mount posts stay');
    assert.ok(!plain.some((i) => i.category === 'Pre-purchase'), 'Pre-purchase posts are left out');
    const all = News.visible(items, true);
    assert.ok(all.some((i) => i.title === 'Bring the Spirit of the Sea Home with the New Grimtide Estate and Grimtide Decor Packs!'));
    assert.deepEqual(News.visible(null, false), []);
  });

  test('news drops off-site, plain http and empty-title posts, strips markup and turns dashes plain', () => {
    const all = News.parseNews(FEED, 50);
    const titles = all.map((i) => i.title);
    assert.ok(!titles.includes('Off-site link') && !titles.includes('Plain http'));
    assert.ok(titles.includes('Markup & entities - dash'));
    const marked = all.find((i) => i.title === 'Markup & entities - dash');
    assert.equal(marked.link, 'https://news.blizzard.com/en-us/article/1/markup');
    assert.equal(all.find((i) => i.title === 'No date').dateMs, null);
    assert.equal(all[all.length - 1].title, 'No date');
    assert.equal(News.parseNews(null).length, 0);
    assert.equal(News.parseNews({ contentItems: 'x' }).length, 0);
  });

  test('a news copy is fresh for 15 minutes and is re-checked when read back', () => {
    const items = News.parseNews(FEED);
    const t = Date.parse('2026-10-28T00:00:00Z');
    assert.equal(News.isFresh({ fetchedAt: t, items }, t + 14 * 60000), true);
    assert.equal(News.isFresh({ fetchedAt: t, items }, t + 15 * 60000), false);
    assert.equal(News.isFresh({ fetchedAt: t, items }, t - 1), false);
    assert.equal(News.sanitizeCache({ fetchedAt: t, items: [{ title: 'x', link: 'https://evil.example/en-us/a' }] }), null);
    assert.equal(News.sanitizeCache({ fetchedAt: 'yesterday', items }), null);
    assert.equal(News.sanitizeCache({ fetchedAt: t, items }).items.length, items.length);
  });

  // ---- Clock check (shared with GW2 Timer) ----

  const sample = (sentMs, serverMs, age) => ({ sentMs, receivedMs: sentMs + 100, date: new Date(serverMs).toUTCString(), age });

  test('a live Date header 90 s ahead corrects the clock by about 90 s', () => {
    const t = Date.parse('2026-10-28T00:00:00Z');
    const est = Clock.estimateClock([sample(t, t + 90000 + 50), sample(t + 5000, t + 95000 + 50)]);
    assert.ok(est && est.applied && Math.abs(est.offsetMs - 90000) < 1100, JSON.stringify(est));
  });

  test('a frozen Date header with no Age is ignored, and an offset under 1.5 s is not applied', () => {
    const t = Date.parse('2026-10-28T00:00:00Z');
    assert.equal(Clock.estimateClock([sample(t, t - 600000), sample(t + 5000, t - 600000)]), null);
    const small = Clock.estimateClock([sample(t, t + 500), sample(t + 5000, t + 5500)]);
    assert.ok(small && !small.applied && small.offsetMs === 0);
  });

  test('a wall clock that jumps, or a long pause, asks for a new clock check', () => {
    assert.equal(Clock.detectResume(0, 0, 1000, 1000), null);
    assert.equal(Clock.detectResume(0, 0, 60000, 1000), 'clock-jump');
    assert.equal(Clock.detectResume(0, 0, 6 * 60000, 6 * 60000), 'long-gap');
  });
}
