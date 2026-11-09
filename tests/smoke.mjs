// Browser tests on the production build (dist/, from node tools/build.mjs), in headless Chrome over the
// DevTools protocol with no dependencies. Each check opens a fresh tab with a simulated clock and time
// zone. news.json is answered from a fixture, refused, or missing, so no test reaches Blizzard.
//
//   node tests/smoke.mjs [--dir dist] [--only <part of a check name>] [--shots <folder>]
//                        [--layout] [--fonts page|arial-georgia|verdana-georgia] [--font-profile android]
//
// --layout runs only the checks whose results depend on font widths (LAYOUT_CHECKS below). --fonts swaps
// the page's font stacks for wider ones in every tab (any platform). --font-profile shows Chrome only one
// kind of device's fonts (Linux, tests/lib/fonts.mjs). The first line printed names the browser and the
// fonts the page was really drawn with; a requested set or profile that is not in use stops the run.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { launchChrome } from './lib/cdp.mjs';
import { fontProfileEnv, SETS as FONT_SETS, setScript } from './lib/fonts.mjs';
import { serve } from '../tools/serve.mjs';
import { events as icsEvents } from './ics.mjs';

const require = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(ROOT, opt('dir', 'dist'));
const ONLY = opt('only', '');
const SHOTS = opt('shots', null);
const LAYOUT = argv.includes('--layout');
const FONT_SET = opt('fonts', 'page');
if (!Object.hasOwn(FONT_SETS, FONT_SET)) { console.error(`Unknown font set "${FONT_SET}" (known: ${Object.keys(FONT_SETS).join(', ')}).`); process.exit(1); }
const SET = FONT_SETS[FONT_SET];
let PROFILE = null;
try { PROFILE = opt('font-profile', null) ? fontProfileEnv(opt('font-profile')) : null; } catch (e) { console.error(e.message); process.exit(1); }
if (!existsSync(join(DIR, 'index.html'))) { console.error(`No site in ${DIR}: run node tools/build.mjs first.`); process.exit(1); }

const FEED = readFileSync(join(ROOT, 'tests', 'fixtures', 'news-feed.json'), 'utf8');
const utc = (iso) => Date.parse(iso);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A copy of the build with no events at all, for the empty-data check, and one without the data file.
const EMPTY = mkdtempSync(join(tmpdir(), 'wowtracker-empty-'));
cpSync(DIR, EMPTY, { recursive: true });
writeFileSync(join(EMPTY, 'events-data.js'), readFileSync(join(DIR, 'events-data.js'), 'utf8').replace(/"events": \[[\s\S]*?\n   \],\n   "untracked"/, '"events": [],\n   "untracked"'));
if (readFileSync(join(EMPTY, 'events-data.js'), 'utf8').includes('"hallows-end"')) throw new Error('the empty-data copy still has events');
const MISSING = mkdtempSync(join(tmpdir(), 'wowtracker-missing-'));
cpSync(DIR, MISSING, { recursive: true });
rmSync(join(MISSING, 'events-data.js'));

const servers = [];
async function site(dir, opts) { const s = await serve(dir, 0, opts); servers.push(s.server); return `http://127.0.0.1:${s.port}/`; }
const BASE = await site(DIR, { sendDate: false, news: { body: FEED } });
const NO_NEWS = await site(DIR, { sendDate: false, news: 'off' });
const SLOW_NEWS = await site(DIR, { sendDate: false, news: { body: FEED, delayMs: 2500 } });
const EMPTY_BASE = await site(EMPTY, { sendDate: false, news: 'off' });
const MISSING_BASE = await site(MISSING, { sendDate: false, news: 'off' });
const DATED = await site(DIR, { sendDate: true, news: 'off' });
/** Every browser the checks start gets the same fonts: the profile's (Linux) and the set's (in each tab). */
async function launchBrowser() {
  const b = await launchChrome({ env: PROFILE && PROFILE.env });
  if (SET) {
    const plain = b.newPage.bind(b);
    b.newPage = async () => { const p = await plain(); await p.beforeLoad(setScript(SET)); return p; };
  }
  return b;
}
const chrome = await launchBrowser();
for (const b of [BASE]) await chrome.grant(b.slice(0, -1), ['clipboardReadWrite', 'clipboardSanitizedWrite']);

let passed = 0, failed = 0;
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** A fresh tab: storage cleared (or seeded with prefs), a simulated clock and zone. */
async function open({ at, tz = 'America/Chicago', width = 1280, height = 900, mobile = false, url = BASE, prefs = null, keepStorage = false, media = null, reminders = null, checklist = null, before = null, browser = chrome } = {}) {
  const page = await browser.newPage();
  const origin = new URL(url).origin;
  if (!keepStorage && url.startsWith('http')) await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await page.emulate({ timezone: tz, locale: 'en-US' });
  await page.viewport(width, height, mobile);
  if (media) await page.emulateMedia(media);
  if (at) await page.startClockAt(at);
  if (before) await page.beforeLoad(before);
  const seed = { prefs, reminders, checklist };
  if (prefs || reminders || checklist) await page.beforeLoad(`if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(${JSON.stringify(seed)})) if (v) localStorage.setItem('wowtracker:v1:' + k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); }`);
  await page.goto(url);
  await page.waitFor("document.querySelector('#summary li') !== null || !document.getElementById('clock-notice').hidden");
  return page;
}
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const texts = (page, sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`);
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const cardNames = (page) => texts(page, '#now-list h3');
const rowNames = (page) => texts(page, '#next-list .row .name');

// ---- Resets, regions and rollover ----

check('desktop load in Chicago: resets, Happening now, Coming up and the next event are right', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.match(await text(page, '#clock-now'), /^8:30:0\d PM$/);
  assert.match(await text(page, '[data-reset="daily"]'), /^Daily resetin 13h (29|30)mWed 10:00 AM$/);
  assert.match(await text(page, '[data-reset="weekly"]'), /^Weekly resetin 6d 13hTue, Nov 3, 9:00 AM$/);
  assert.match(await text(page, '[data-reset="monthly"]'), /Trading Post\s*Predicted.*Sun, Nov 1, 9:00 AM/);
  // The Curse Surge slots are the ones Wowhead listed for the Americas at this hour (01:30, 02:00, 02:30, 03:00 UTC).
  assert.deepEqual(await cardNames(page), ["Hallow's End", 'Warlords of Draenor Timewalking', "Lu'ashal", "Curse Surge: The Broodmother's Nest"]); // repeating events after the rest
  assert.deepEqual((await rowNames(page)).slice(0, 7), ["Aqir Invasion: Zul'Aman", 'Curse Surge: The Looming Mutagenitor', 'Curse Surge: Mlurkkr Massacre',
    "Aqir Invasion: Zul'Aman", 'Curse Surge: Siege at the Whispering Marsh', "Aqir Invasion: Zul'Aman", 'Darkmoon Faire']);
  assert.match(await text(page, '#summary .next'), /^Next eventDarkmoon Faire\s*in 4d 5h · Sun, Nov 1, 1:00 AM$/);
  assert.match(await text(page, '#region-line'), /^Americas · US, Latin American and Oceanic realms\. Daily reset 15:00 UTC, weekly reset Tuesday 15:00 UTC/);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Europe: its own resets, its own week (Predaxas until 04:00 UTC) and "Predicted time" on holiday start times', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  await click(page, '[data-region="eu"]');
  assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true');
  assert.match(await text(page, '[data-reset="daily"]'), /in 2h (29|30)mTue 11:00 PM$/);
  assert.match(await text(page, '[data-reset="weekly"]'), /in 2h (29|30)mTue, Oct 27, 11:00 PM$/);
  assert.deepEqual(await cardNames(page), ['Delves Bonus Event', 'Predaxas', "Hallow's End", 'Curse Surge: Mlurkkr Massacre']); // soonest to end first, repeating events last; Europe two places ahead
  const he = await text(page, '#now-list [data-id="hallows-end"] .badges');
  assert.match(he, /Predicted time/);
  assert.match(await text(page, '#region-line'), /^Europe · European realms\. Daily reset 04:00 UTC, weekly reset Wednesday 04:00 UTC/);
  await page.reload();
  assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true', 'the region is saved');
  await page.close();
});

check('a European device zone starts on Europe; an American one on the Americas', async () => {
  const eu = await open({ at: utc('2026-10-28T01:30:00Z'), tz: 'Europe/Berlin' });
  assert.equal(await eu.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true');
  await eu.close();
  const us = await open({ at: utc('2026-10-28T01:30:00Z'), tz: 'America/Sao_Paulo' });
  assert.equal(await us.eval(`document.querySelector('[data-region="us"]').getAttribute('aria-pressed')`), 'true');
  await us.close();
});

check('at the European weekly reset the week rolls over on its own: Predaxas leaves, Lu\'ashal and Timewalking arrive', async () => {
  const page = await open({ at: utc('2026-10-28T03:59:57Z'), prefs: { region: 'eu' } });
  assert.ok((await cardNames(page)).includes('Predaxas'));
  assert.match(await text(page, '[data-reset="weekly"] .value'), /^in [0-3]s$/);
  await page.waitFor(`[...document.querySelectorAll('#now-list h3')].some((h) => h.textContent === "Lu'ashal")`, 8000);
  const names = await cardNames(page);
  assert.ok(!names.includes('Predaxas') && names.includes('Warlords of Draenor Timewalking'), names.join());
  assert.match(await text(page, '[data-reset="weekly"] .value'), /^in 6d 23h$/);
  await page.close();
});

check('at the Americas daily reset the countdown starts again from 24 hours', async () => {
  const page = await open({ at: utc('2026-10-28T14:59:58Z') });
  await page.waitFor(`document.querySelector('[data-reset="daily"] .value').textContent.startsWith('in 23h')`, 6000);
  assert.match(await text(page, '[data-reset="daily"] .sub'), /^Thu 10:00 AM$/);
  await page.close();
});

check('across the US daylight-saving change the reset moves from 10:00 AM CDT to 9:00 AM CST in Chicago', async () => {
  const before = await open({ at: utc('2026-10-30T16:00:00Z') });
  assert.match(await text(before, '[data-reset="daily"] .sub'), /^Sat 10:00 AM$/);
  await before.close();
  const after = await open({ at: utc('2026-10-31T16:00:00Z') });
  assert.match(await text(after, '[data-reset="daily"] .sub'), /^Sun 9:00 AM$/);
  await after.close();
});

check('across the EU change the European reset moves from 06:00 to 05:00 in Berlin', async () => {
  const before = await open({ at: utc('2026-10-23T12:00:00Z'), tz: 'Europe/Berlin', prefs: { region: 'eu' } });
  assert.match(await text(before, '[data-reset="daily"] .sub'), /^Sat 6:00 AM$/);
  await before.close();
  const after = await open({ at: utc('2026-10-25T12:00:00Z'), tz: 'Europe/Berlin', prefs: { region: 'eu' } });
  assert.match(await text(after, '[data-reset="daily"] .sub'), /^Mon 5:00 AM$/);
  await after.close();
});

check('Coming up puts starts after local midnight under day headings and repeats an hourly or half-hourly event only three times', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.deepEqual(await texts(page, '#next-list .day-sep'), ['Sunday, Nov 1', 'Tuesday, Nov 3']);
  assert.equal((await rowNames(page)).filter((n) => n.startsWith('Aqir Invasion')).length, 3);
  assert.equal((await rowNames(page)).filter((n) => n.startsWith('Curse Surge')).length, 3);
  await page.close();
  const late = await open({ at: utc('2026-10-28T04:30:00Z'), prefs: { aheadHours: 4 } }); // 11:30 PM in Chicago
  assert.deepEqual(await texts(late, '#next-list .day-sep'), ['Tomorrow']);
  await late.close();
});

check('an event moves from Coming up into Happening now when its window opens, and the Curse Surge moves to its next place', async () => {
  const page = await open({ at: utc('2026-10-28T01:59:58Z'), prefs: { aheadHours: 1 } });
  assert.ok(!(await cardNames(page)).some((n) => n.startsWith('Aqir Invasion')));
  assert.ok((await cardNames(page)).includes("Curse Surge: The Broodmother's Nest"));
  await page.waitFor(`[...document.querySelectorAll('#now-list h3')].some((h) => h.textContent === "Aqir Invasion: Zul'Aman")`, 6000);
  assert.match(await text(page, '#now-list [data-id="aqir-invasion"] .big'), /^Ends in (9m|10m)/);
  const cards = await cardNames(page);
  assert.ok(cards.includes('Curse Surge: The Looming Mutagenitor') && !cards.includes("Curse Surge: The Broodmother's Nest"), cards.join());
  assert.match(await text(page, '#now-list [data-id="curse-surge"] .big'), /^Ends in (29m|30m)/);
  await page.close();
});

check('nothing is shown as live after the data stops: on 2026-12-02 no world boss, Aqir Invasion, Curse Surge or Timewalking, only the December bonus weeks', async () => {
  const page = await open({ at: utc('2026-12-02T18:05:00Z') });
  const now = await page.eval(`[...document.querySelectorAll('#now-list [data-id]')].map((e) => e.getAttribute('data-id'))`);
  assert.deepEqual(now.sort(), ['battleground-bonus', 'pet-battle-bonus', 'wow-anniversary']);
  await page.close();
});

// ---- Labels ----

check('Predicted labels sit on the predicted events only; in the Americas the one confirmed event with a predicted start time says so', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const rows = await page.eval(`[...document.querySelectorAll('#calendar .agenda li')].map((li) => [li.getAttribute('data-id'), (li.querySelector('.badge.predicted') || {}).textContent || ''])`);
  for (const [id, badge] of rows) assert.equal(badge, id.startsWith('world-boss-') ? 'Predicted' : id === 'battleground-bonus' ? 'Predicted time' : '', id);
  assert.ok(rows.some(([id]) => id === 'battleground-bonus'));
  assert.ok(rows.length > 30, `${rows.length} calendar rows`);
  await page.close();
});

// ---- Personalization ----

check('stars, hide and restore, categories, Starred, compact, times and theme are saved and come back after reload', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  await click(page, '#now-list [data-id="hallows-end"] [data-star]');
  await click(page, '#next-list [data-id="darkmoon-faire"] [data-hide]');
  await click(page, '[data-category="outdoor"]');
  await click(page, '#compact-btn');
  await page.eval(`(() => { const s = document.getElementById('time-mode'); s.value = 'both'; s.dispatchEvent(new Event('change')); })()`);
  await click(page, '#theme-btn'); // dark -> light
  await page.reload();
  assert.equal(await page.eval(`document.querySelector('#now-list [data-id="hallows-end"] [data-star]').getAttribute('aria-pressed')`), 'true');
  assert.ok(!(await rowNames(page)).includes('Darkmoon Faire') && !(await rowNames(page)).includes('Aqir Invasion'));
  assert.equal(await text(page, '#hidden-btn'), 'Hidden (1)');
  assert.equal(await page.eval(`document.body.classList.contains('compact')`), true);
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), 'light');
  assert.match(await text(page, '#next-list .row .when'), /UTC/);
  await click(page, '[data-quick="starred"]');
  assert.deepEqual(await cardNames(page), ["Hallow's End"]);
  assert.equal(await page.eval(`document.querySelectorAll('#next-list .row').length`), 0);
  await click(page, '[data-quick="starred"]'); // Starred again: everything
  await click(page, '#hidden-btn');
  await click(page, '[data-unhide="darkmoon-faire"]');
  assert.equal(await text(page, '#hidden-btn'), 'Hidden (0)');
  assert.ok((await rowNames(page)).includes('Darkmoon Faire'));
  await page.close();
});

check('a starred event becomes the summary\'s "Next starred event", even an hourly one', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { starred: ['aqir-invasion'] } });
  assert.match(await text(page, '#summary .next'), /^Next starred eventAqir Invasion: Zul'Aman\s*Predicted/);
  await page.close();
});

check('broken saved settings fall back to the defaults instead of breaking the page', async () => {
  const page = await chrome.newPage();
  await page.send('Storage.clearDataForOrigin', { origin: BASE.slice(0, -1), storageTypes: 'all' });
  await page.emulate({ timezone: 'America/Chicago', locale: 'en-US' });
  await page.startClockAt(utc('2026-10-28T01:30:00Z'));
  await page.beforeLoad(`localStorage.setItem('wowtracker:v1:prefs', '{"region":"mars","starred":"x","categories":[1,2],"aheadHours":"lots"'); localStorage.setItem('wowtracker:v1:news', '[]');`);
  await page.goto(BASE);
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await page.eval(`document.querySelector('[data-region="us"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await page.eval(`document.getElementById('ahead').value`), '168');
  assert.ok((await cardNames(page)).length >= 3);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('UTC display shows every time in UTC, with UTC days', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { timeMode: 'utc' } });
  assert.match(await text(page, '#clock-now'), /^01:30:0\d UTC$/);
  assert.match(await text(page, '[data-reset="daily"] .sub'), /^Wed 15:00 UTC$/);
  assert.match(await text(page, '#coming-hint'), /in UTC/);
  await page.close();
});

// ---- Empty and missing data ----

check('with no events the resets still count down and every list says it is empty', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: EMPTY_BASE });
  assert.match(await text(page, '[data-reset="weekly"]'), /in 6d 13h/);
  assert.equal(await page.eval(`document.getElementById('now-empty').hidden`), false);
  assert.equal(await page.eval(`document.getElementById('next-empty').hidden`), false);
  assert.match(await text(page, '#calendar'), /^October 2026Nothing you follow this month\.November 2026Nothing you follow this month\.December 2026Not known yet from/);
  // This server has no news.json (like github.io); the 404 is the only thing allowed, and news says so.
  await page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  assert.deepEqual(page.problems.filter((p) => !/^HTTP 404 \S+\/news\.json$/.test(p)), []);
  await page.close();
});

check('without the data file the page says the schedule did not load, with no script errors', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: MISSING_BASE });
  assert.match(await text(page, '#clock-notice'), /schedule data did not load/);
  assert.ok(page.problems.every((p) => /404|failed: net::ERR_ABORTED/.test(p)), page.problems.join('\n'));
  await page.close();
});

// ---- News ----

const newsTitles = (page) => page.eval(`[...document.querySelectorAll('#news-list li a')].map((a) => a.firstChild.textContent)`);
const newsAsked = (page) => page.requests.filter((u) => u.includes('news.json')).length;

check('news opens under the resets once the page has loaded: three headlines, Show all and Collapse are saved, shop posts go by category only', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const tops = await page.eval(`['.summary', '#news', '#filters', '#now-list'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top))`);
  assert.deepEqual([...tops].sort((a, b) => a - b), tops, `resets, news, filters, Happening now in that order (${tops})`);
  await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`);
  const [asked, loaded] = await page.eval(`[(performance.getEntriesByType('resource').find((e) => e.name.endsWith('/news.json')) || { startTime: -1 }).startTime, performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd]`);
  assert.ok(asked > loaded, `news.json was asked for at ${Math.round(asked)} ms, after the page loaded at ${Math.round(loaded)} ms`);
  const three = await newsTitles(page);
  assert.equal(three[0], 'Hotfixes: October 27, 2026');
  assert.ok(three.some((t) => /WoW: Forever/.test(t)), 'WoW: Forever posts are not filtered out');
  const links = await page.eval(`[...document.querySelectorAll('#news-list a')].map((a) => [a.href, a.target, a.rel])`);
  for (const [href, target, rel] of links) { assert.match(href, /^https:\/\/news\.blizzard\.com\/en-us\//); assert.equal(target, '_blank'); assert.match(rel, /noopener/); }
  assert.equal(await page.eval(`document.querySelectorAll('#news-list b, #news-list script').length`), 0);
  // Show all brings the rest; shop posts stay out (by Blizzard's category) until asked for. Both are saved.
  assert.equal(await text(page, '#news-all'), 'Show all 8');
  await click(page, '#news-all');
  assert.equal((await newsTitles(page)).length, 8);
  assert.equal(await page.eval(`document.getElementById('news-all').getAttribute('aria-expanded')`), 'true');
  await page.reload(); // before any other choice is saved, so Show all has to be saved by itself
  await page.waitFor(`document.querySelectorAll('#news-list li a').length === 8`);
  assert.equal(await text(page, '#news-all'), 'Show fewer', 'Show all is saved');
  assert.ok((await texts(page, '#news-list .cat')).every((c) => !/^(shop now|sale|on sale|pre-purchase)$/i.test(c)));
  assert.ok((await newsTitles(page)).includes('Hotfixes: a mount sale price shown wrong in the shop is fixed'), 'a game post that mentions a sale stays');
  assert.equal(await text(page, '#news-shop'), 'Show 5 shop posts');
  await click(page, '#news-shop');
  assert.ok((await texts(page, '#news-list .cat')).includes('Shop Now'));
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#news-list li a').length === 8`);
  assert.equal(await text(page, '#news-shop'), 'Hide shop posts', 'the shop choice is saved');
  assert.equal(await text(page, '#news-all'), 'Show fewer', 'Show all is saved');
  await click(page, '#news-shop');
  await click(page, '#news-all');
  assert.equal((await newsTitles(page)).length, 3);
  // Collapse is saved, and a collapsed panel asks for nothing (the saved copy is cleared, so it would have to).
  await click(page, '#news-toggle');
  assert.equal(await page.eval(`document.getElementById('news-body').hidden`), true);
  assert.equal(await text(page, '#news-toggle'), 'Show news');
  assert.equal(await page.eval(`document.getElementById('news-toggle').getAttribute('aria-expanded')`), 'false');
  await page.eval(`localStorage.removeItem('wowtracker:v1:news')`);
  const before = newsAsked(page);
  await page.reload();
  await sleep(2500);
  assert.equal(newsAsked(page), before, 'a collapsed panel asks nothing on load');
  assert.equal(await page.eval(`document.getElementById('news-body').hidden`), true, 'collapsed is saved');
  await click(page, '#news-toggle');
  await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`);
  assert.equal(newsAsked(page), before + 1);
  await page.close();
});

check('a slow news answer never holds up the countdowns or moves Happening now, and v0.1 settings come back with news open', async () => {
  for (const [width, mobile, slack] of [[1280, false, 2], [390, true, 70]]) {
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: SLOW_NEWS, width, height: 844, mobile, prefs: { region: 'us', newsOpen: false, newsShop: false } });
    assert.ok((await text(page, '#clock-now')).length > 0 && (await cardNames(page)).length >= 3, 'the dashboard is drawn while news is still on its way');
    assert.equal(await page.eval(`document.querySelectorAll('#news-list li.ph').length`), 3, 'three lines hold the space');
    const first = await page.eval(`Math.round(document.getElementById('now-title').getBoundingClientRect().top + scrollY)`);
    await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`, 8000);
    const after = await page.eval(`Math.round(document.getElementById('now-title').getBoundingClientRect().top + scrollY)`);
    assert.ok(Math.abs(after - first) <= slack, `at ${width} px Happening now moved ${after - first} px when the headlines arrived`);
    if (mobile) assert.ok(after <= 760, `at 390 x 844 Happening now starts at ${after} px with news open`);
    await page.close();
  }
});

check('a headline too long for one line ends in an ellipsis and never widens the page, from 1024 px down to the phone layout', async () => {
  const feed = JSON.parse(FEED);
  for (const item of feed.contentItems) item.properties.title = 'The Adventure Begins in WoW: Forever, Stay Connected with Discord, and Taldramir Takes Shape in WoW Weekly, Plus Hotfixes, a Gamepad Guide and Everything Else That Happened This Week';
  const url = await site(DIR, { sendDate: false, news: { body: JSON.stringify(feed) } });
  for (const w of [1024, 900, 768, 660]) { // 640 and under is the phone layout: two lines, clamped
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), url, width: w });
    await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`);
    const m = await page.eval(`(() => { const a = document.querySelector('#news-list li a'); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, lines: Math.round(a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight)), cut: a.scrollWidth > a.clientWidth }; })()`);
    assert.ok(m.sw <= m.cw, `${w} px: the page is ${m.sw} px wide in ${m.cw}`);
    assert.deepEqual([m.lines, m.cut], [1, true], `${w} px: one line, cut`);
    await page.close();
  }
});

check('when news.json is missing the section links to Blizzard News and the timers carry on', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: NO_NEWS });
  await page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  assert.equal(await page.eval(`document.querySelector('#news-note a').href`), 'https://news.blizzard.com/en-us/feed/world-of-warcraft');
  assert.ok((await cardNames(page)).length >= 3);
  await page.close();
});

check('opened from a file: the page works, news links out, nothing errors', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: pathToFileURL(join(DIR, 'index.html')).href, prefs: null });
  assert.ok((await cardNames(page)).length >= 3);
  await page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  assert.equal(newsAsked(page), 0, 'a file never asks for news.json');
  assert.deepEqual(page.problems, []);
  await page.close();
});

// The page as it is published: Chrome answers for radmagelabs.com/wow/ and the GitHub Pages address from
// this build (nothing is deployed), and news.json only where RadMage Labs would pass it through.
async function asPublished(base, newsBody) {
  const page = await chrome.newPage();
  const root = new URL(base).pathname, asked = [];
  page.on('Fetch.requestPaused', async (p) => {
    const u = new URL(p.request.url);
    let rel = decodeURIComponent(u.pathname.slice(root.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    let status = 200, body = Buffer.alloc(0), type = 'text/plain';
    if (rel === 'news.json') { asked.push(u.href); if (newsBody) { body = Buffer.from(newsBody); type = 'application/json'; } else status = 404; }
    else if (existsSync(join(DIR, rel))) { body = readFileSync(join(DIR, rel)); type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream'; }
    else status = 404;
    try {
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Date', value: new Date().toUTCString() }], body: (p.request.method === 'HEAD' ? Buffer.alloc(0) : body).toString('base64') });
    } catch (e) { /* the page went away */ }
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: `${new URL(base).origin}/*` }] });
  await page.emulate({ timezone: 'America/Chicago', locale: 'en-US' });
  await page.viewport(1280, 900, false);
  await page.startClockAt(utc('2026-10-28T01:30:00Z'));
  await page.goto(base);
  await page.waitFor("document.querySelector('#summary li') !== null");
  return { page, asked };
}

check('news.json is asked for only where config.js says it is passed through: radmagelabs.com yes, GitHub Pages never', async () => {
  const labs = await asPublished('https://radmagelabs.com/wow/', FEED);
  await labs.page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`);
  assert.deepEqual(labs.asked, ['https://radmagelabs.com/wow/news.json']);
  assert.deepEqual(labs.page.problems, []);
  await labs.page.close();
  const pages = await asPublished('https://radmageirl.github.io/wowtracker/', null);
  await pages.page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  await sleep(2500);
  assert.deepEqual(pages.asked, [], 'GitHub Pages has no news.json, so it is never asked for');
  assert.equal(await pages.page.eval(`document.querySelector('#news-note a').href`), 'https://news.blizzard.com/en-us/feed/world-of-warcraft');
  assert.equal(await pages.page.eval(`document.querySelectorAll('#news-list li').length`), 0, 'no empty lines held for headlines that will not come');
  assert.deepEqual(pages.page.problems, [], 'no 404, no console error');
  await pages.page.close();
});

// ---- Search and details ----

const typeSearch = async (page, q) => { await page.eval(`(() => { const i = document.getElementById('search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(400); };

check('search narrows every list as you type, forgives spelling and aliases, says what it found, and Escape clears it without saving', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { hidden: ['world-boss-cragpine'] } });
  const all = await cardNames(page);
  await typeSearch(page, 'luashal');
  assert.deepEqual(await cardNames(page), ["Lu'ashal"]);
  assert.ok((await texts(page, '#calendar .agenda .name')).every((n) => n === "Lu'ashal"));
  assert.equal(await text(page, '#search-status'), '1 event matches.');
  await typeSearch(page, 'haloween'); // a letter short of the alias Halloween
  assert.deepEqual(await cardNames(page), ["Hallow's End"]);
  await typeSearch(page, 'cragpine'); // hidden: found, and the status says why it is not listed
  assert.equal(await text(page, '#search-status'), 'No event you follow matches "cragpine". 1 more is hidden, not starred, or in a category you turned off.');
  await typeSearch(page, 'xyzzy');
  assert.match(await text(page, '#calendar'), /Nothing on the calendar matches your search\./);
  assert.equal(await page.eval(`document.querySelectorAll('#calendar .gap').length > 0 && [...document.querySelectorAll('#calendar .gap')].every((g) => /^Nothing after/.test(g.textContent))`), true, 'no "Not known yet" for categories nothing matched');
  await page.eval(`document.getElementById('search').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  assert.equal(await page.eval(`document.getElementById('search').value`), '');
  assert.deepEqual(await cardNames(page), all);
  await typeSearch(page, 'legion');
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await page.eval(`document.getElementById('search').value`), '', 'a search is not saved');
  assert.deepEqual(await cardNames(page), all);
  await page.close();
});

// ---- Quick filters: Today, This week, Starred, Holidays ----

const pressedQuick = (page) => page.eval(`[...document.querySelectorAll('[data-quick]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.quick)`);
/** Every listed window (Coming up rows, the week, the calendar) as [event id, start, end] from the engine, in the page's region. */
const listedWindows = (page, data, region, sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((b) => [b.dataset.details, Number(b.dataset.start)])`)
  .then((xs) => xs.map(([id, start]) => { const e = data.events.find((x) => x.id === id); const w = Engine.windows(e.schedules[region], start, start + 1).find((x) => x.start === start); return [id, start, w ? w.end : NaN]; }));

check('Today keeps what is on at some point today, in every list, up to the next local midnight; hidden events stay out; nothing is saved and a reload starts without it', async () => {
  const at = utc('2026-11-10T18:00:00Z'), dayStart = utc('2026-11-10T06:00:00Z'), dayEnd = utc('2026-11-11T06:00:00Z');
  const page = await open({ at, prefs: { hidden: ['aqir-invasion'] } });
  const DATA = require(join(DIR, 'events-data.js'));
  const before = await stored(page), cards = await cardNames(page);
  const rowStarts = () => page.eval(`[...document.querySelectorAll('#next-list .row')].map((r) => Number(r.dataset.start))`);
  assert.ok((await rowStarts()).some((s) => s >= dayEnd), 'without it Coming up runs past midnight');
  assert.deepEqual(await pressedQuick(page), []);
  await click(page, '[data-quick="today"]');
  assert.deepEqual(await pressedQuick(page), ['today']);
  assert.equal(await text(page, '#quick-status'), 'Only what is on today (Tue, Nov 10): 5 events.'); // ended this morning, on now, later today; Aqir Invasion hidden
  assert.deepEqual(await cardNames(page), cards, 'what is on now is on today');
  const starts = await rowStarts();
  assert.ok(starts.length && starts.every((s) => s > at && s < dayEnd), 'Coming up: only later today');
  assert.match(await text(page, '#coming-hint'), /^next 7 days, today only, your time/);
  for (const sel of ['#week-grid [data-details]', '#calendar [data-details]']) {
    for (const [id, s, e] of await listedWindows(page, DATA, 'us', sel)) assert.ok((e > dayStart && s < dayEnd) || id === 'curse-surge', `${sel}: ${id} ${new Date(s).toISOString()}`);
  }
  const firstWeek = await texts(page, '#week-grid .week-col:first-child li [data-details]');
  assert.ok(firstWeek.includes('Arena Skirmish Bonus Event') && firstWeek.includes("Thorm'belan"), firstWeek.join(', '));
  assert.equal(await text(page, '#week-grid .week-col:last-child .none'), 'Nothing that matches is scheduled.');
  assert.equal(await page.eval(`document.querySelectorAll('#calendar .month').length`), 1, 'the calendar shows this month only');
  assert.ok(!(await texts(page, '#next-list .name, #week-grid [data-details], #calendar [data-details]')).some((n) => /Aqir/.test(n)), 'a hidden event stays hidden');
  assert.deepEqual(await stored(page), before, 'nothing saved');
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.deepEqual([await pressedQuick(page), await text(page, '#quick-status')], [[], '']);
  assert.ok((await rowStarts()).some((s) => s >= dayEnd), 'after a reload, everything again');
  await page.close();
  // Late in the evening: the half-hourly slots after midnight belong to tomorrow and leave Coming up.
  const late = await open({ at: utc('2026-11-10T05:10:00Z') });
  const lateRows = () => late.eval(`[...document.querySelectorAll('#next-list .row')].map((r) => Number(r.dataset.start))`);
  assert.ok((await lateRows()).some((s) => s >= utc('2026-11-10T06:00:00Z')));
  await click(late, '[data-quick="today"]');
  const todayRows = await lateRows();
  assert.ok(todayRows.length >= 1 && todayRows.every((s) => s < utc('2026-11-10T06:00:00Z')), todayRows.map((s) => new Date(s).toISOString()).join());
  await late.close();
  // Forever on a Sunday: today's fishing contest in the calendar, not the Sundays after it.
  const sunday = await open({ at: utc('2026-11-15T18:00:00Z'), url: `${BASE}#forever` });
  const contests = () => sunday.eval(`[...document.querySelectorAll('#calendar [data-details="stranglethorn-fishing-extravaganza"]')].map((b) => Number(b.dataset.start))`);
  assert.ok((await contests()).length > 2);
  await click(sunday, '[data-quick="today"]');
  assert.deepEqual(await contests(), [utc('2026-11-15T20:00:00Z')]);
  await sunday.close();
});

check('This week keeps the week the overview shows first (the reset week; Monday to Monday in Forever); Today and This week are one at a time, and pressing again turns it off', async () => {
  const at = utc('2026-11-10T18:00:00Z'), weekEnd = utc('2026-11-17T15:00:00Z');
  const page = await open({ at });
  await click(page, '[data-quick="week"]');
  assert.match(await text(page, '#quick-status'), /^Only what is on this reset week \(Tue, Nov 10 to Tue, Nov 17\): \d+ events\.$/);
  const starts = await page.eval(`[...document.querySelectorAll('#next-list .row')].map((r) => Number(r.dataset.start))`);
  assert.ok(starts.every((s) => s < weekEnd) && starts.some((s) => s > utc('2026-11-11T06:00:00Z')), 'more than today, less than the week');
  assert.ok((await texts(page, '#week-grid .week-col:first-child li [data-details]')).includes('Moonkin Festival'));
  await click(page, '[data-quick="today"]');
  assert.deepEqual(await pressedQuick(page), ['today'], 'Today replaces This week');
  await click(page, '[data-quick="today"]');
  assert.deepEqual([await pressedQuick(page), await text(page, '#quick-status')], [[], '']);
  await page.close();
  const forever = await open({ at, url: `${BASE}#forever` });
  await click(forever, '[data-quick="week"]');
  assert.match(await text(forever, '#quick-status'), /^Only what is on this week \(Mon, Nov 9 to Mon, Nov 16\): \d+ events\.$/);
  assert.ok((await texts(forever, '#next-list .name')).every((n) => n === 'Stranglethorn Fishing Extravaganza'), 'Sunday\'s contest, nothing after Monday');
  assert.deepEqual(forever.problems, []);
  await forever.close();
});

check('Holidays keeps only holidays without touching the saved categories; Starred, a search and hidden events still narrow it; with Holidays turned off in the categories it says so', async () => {
  const page = await open({ at: utc('2026-11-24T18:00:00Z'), prefs: { starred: ['pilgrims-bounty', 'darkmoon-faire'], hidden: ['day-of-the-dead'] } });
  const DATA = require(join(DIR, 'events-data.js'));
  const holiday = new Set(DATA.events.filter((e) => e.category === 'holiday').map((e) => e.id));
  const before = await stored(page), chips = () => page.eval(`[...document.querySelectorAll('#category-chips .chip')].map((c) => c.getAttribute('aria-pressed')).join()`);
  const chipsBefore = await chips();
  await click(page, '[data-quick="holidays"]');
  const ids = await page.eval(`[...document.querySelectorAll('#now-list [data-id], #next-list .row, #week-grid [data-details], #calendar [data-details]')].map((x) => x.dataset.id || x.dataset.details)`);
  assert.ok(ids.length > 3 && ids.every((id) => holiday.has(id)), ids.join(', '));
  assert.deepEqual(await cardNames(page), ["Pilgrim's Bounty", "WoW's 22nd Anniversary"]);
  assert.match(await text(page, '#quick-status'), /^Only holidays: \d+ events\.$/);
  assert.match(await text(page, '#filters-summary'), /^Holidays · all categories · /);
  assert.equal(await chips(), chipsBefore, 'the category chips are as saved');
  await click(page, '[data-quick="today"]');
  assert.match(await text(page, '#quick-status'), /^Only holidays today \(Tue, Nov 24\): 2 events\.$/);
  await click(page, '[data-quick="starred"]'); // the saved Starred filter, as before
  assert.deepEqual(await cardNames(page), ["Pilgrim's Bounty"]);
  assert.equal(JSON.parse((await stored(page))['wowtracker:v1:prefs']).filter, 'starred', 'Starred is saved, as it always was');
  await click(page, '[data-quick="starred"]');
  await click(page, '[data-quick="today"]');
  await typeSearch(page, 'veil');
  assert.deepEqual([...new Set(await texts(page, '#calendar .agenda .name'))], ['Feast of Winter Veil'], 'a search narrows Holidays further');
  await typeSearch(page, '');
  await click(page, '.chip[data-cat="holiday"]'); // turned off in the saved categories
  assert.match(await text(page, '#quick-status'), /^Only holidays: 0 events\. Holidays is turned off in your categories; turn it on there to see them\.$/);
  assert.match(await text(page, '#calendar'), /Nothing on the calendar matches your filters\./);
  await click(page, '.chip[data-cat="holiday"]');
  await click(page, '[data-quick="holidays"]');
  const after = await stored(page);
  assert.deepEqual(JSON.parse(after['wowtracker:v1:prefs']).categories.sort(), DATA.categories.map((c) => c.id).sort(), 'every category still followed');
  assert.notEqual(after['wowtracker:v1:prefs'], before['wowtracker:v1:prefs'], 'only the reader\'s own changes were written (Starred, the chip)');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Export to calendar takes Holidays and Starred from the quick filters but not Today or This week, and says so; on a phone the folded filters name them', async () => {
  const page = await open({ at: utc('2026-11-24T18:00:00Z') });
  const count = async () => { await click(page, '#export-btn'); const n = Number((/^Download (\d+)/.exec(await text(page, '#export-go')) || [])[1]); await page.eval(`document.getElementById('export-dialog').close()`); return n; };
  const all = await count();
  await click(page, '[data-quick="today"]');
  assert.equal(await count(), all, 'Today does not shorten a calendar file');
  await click(page, '#export-btn');
  assert.match(await text(page, '#export-scope'), /^Americas, with your filters: all categories · 7 days · Local\. Hidden events are left out\. Today and This week do not apply: the range is chosen here\.$/);
  await page.eval(`document.getElementById('export-dialog').close()`);
  await click(page, '[data-quick="holidays"]');
  await click(page, '#export-btn');
  const file = await saved(page, () => click(page, '#export-go'));
  const entries = icsEvents(file.text);
  assert.ok(entries.length >= 2 && entries.every((x) => x.CATEGORIES === 'Holidays'), entries.map((x) => x.SUMMARY).join(', '));
  await page.close();
  const phone = await open({ at: utc('2026-11-24T18:00:00Z'), width: 390, height: 844, mobile: true });
  await click(phone, '#filters-toggle');
  await click(phone, '[data-quick="week"]');
  await click(phone, '#filters-toggle');
  assert.equal(await phone.eval(`document.querySelector('[data-quick="week"]').offsetParent`), null, 'folded with the filters');
  assert.match(await text(phone, '#filters-summary'), /^This week · all categories · 7 days · Local$/);
  await phone.close();
});

check('a name opens its details from the data only: when, how long, both regions, how sure, coverage and sources; Escape returns focus', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const DATA = require(join(DIR, 'events-data.js'));
  // Keyboard: focus the name and press Enter.
  await page.eval(`document.querySelector('#now-list [data-details="world-boss-luashal"]').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page.waitFor(`document.getElementById('details').open`);
  const dl = await page.eval(`Object.fromEntries([...document.querySelectorAll('#details dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))`);
  const luashal = DATA.events.find((e) => e.id === 'world-boss-luashal');
  assert.equal(await text(page, '#details-title'), "Lu'ashal");
  assert.match(dl.When, /^On now, ends Tue, Nov 3, 9:00 AM · ends in 6d 13h/);
  assert.equal(dl['How long'], '7 days, once every 28 days');
  assert.equal(dl.Europe, 'Starts Tue, Oct 27, 11:00 PM (Predicted)', 'Europe is still in the week before (its reset is Wednesday 04:00 UTC)');
  assert.equal(dl.Where, luashal.zone);
  assert.equal(dl['How sure'], `Predicted. ${luashal.basis}`);
  assert.match(dl.Data, /^Known until Tue, Dec 1, 9:00 AM\. After that: not known yet/);
  assert.equal('About' in dl, false, 'no description where the data has none');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#details .details-sources a')].map((a) => a.href)`), luashal.sources.map((s) => s.url));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.getElementById('details').open`);
  await sleep(100);
  assert.equal(await page.eval(`document.activeElement.getAttribute('data-details')`), 'world-boss-luashal', 'focus is back on the name');
  // Starring from the dialog rebuilds the lists behind it; Escape still lands on the (new) name.
  await click(page, '#now-list [data-details="world-boss-luashal"]');
  await click(page, '#details [data-star]');
  assert.equal(await page.eval(`document.activeElement.closest('#details') !== null`), true, 'focus stays in the dialog');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.getElementById('details').open`);
  await sleep(100);
  assert.equal(await page.eval(`document.activeElement.getAttribute('data-details')`), 'world-boss-luashal', 'focus finds the rebuilt name');
  await click(page, '#now-list [data-star="world-boss-luashal"]'); // unstar again
  // From the Americas, the European line of a holiday says its start time there is Predicted time.
  await click(page, '#calendar [data-details="wow-anniversary"]');
  assert.match(await page.eval(`[...document.querySelectorAll('#details dt')].find((dt) => dt.textContent === 'Europe').nextElementSibling.textContent`), /^Starts Tue, Nov 17, 3:00 AM \(Predicted time\)$/);
  await click(page, '#details [data-close]');
  // A dated holiday from the calendar, in Europe: the start time is Predicted time, the dates are not.
  await click(page, '[data-region="eu"]');
  await click(page, '#calendar [data-details="wow-anniversary"]');
  const eu = await page.eval(`Object.fromEntries([...document.querySelectorAll('#details dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))`);
  assert.match(eu['How sure'], /^Predicted time\. The dates are confirmed; the start time in this region is not\./);
  assert.equal(eu['How long'], '21 days');
  assert.match(eu.Data, /^Known through Mar 31, 2027\./);
  assert.match(eu.Americas, /^Starts Tue, Nov 17, 12:00 PM$/);
  // Star from the dialog stays in it; Hide closes it and hides the event.
  await click(page, '#details [data-star]');
  assert.equal(await page.eval(`document.getElementById('details').open`), true);
  assert.equal(await text(page, '#details .star-label'), 'Starred');
  await click(page, '#details [data-hide]');
  assert.equal(await page.eval(`document.getElementById('details').open`), false);
  assert.equal(await page.eval(`document.querySelectorAll('#calendar [data-details="wow-anniversary"]').length`), 0);
  await page.close();
});

check('on a phone the details fit the screen without sideways scrolling, and Close is reachable', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), width: 390, height: 844, mobile: true });
  await click(page, '#now-list [data-details="hallows-end"]');
  const box = await page.eval(`(() => { const d = document.getElementById('details').getBoundingClientRect(), c = document.querySelector('#details [data-close]').getBoundingClientRect(); return { left: d.left, right: d.right, h: d.height, sw: document.getElementById('details').scrollWidth, cw: document.getElementById('details').clientWidth, close: c.height, closeTop: c.top }; })()`);
  assert.ok(box.left >= 0 && box.right <= 390 && box.sw <= box.cw, JSON.stringify(box));
  assert.ok(box.close >= 28 && box.closeTop >= 0 && box.h <= 844, JSON.stringify(box));
  await page.close();
});

check('Curse Surges: the Details name the place of each slot and the order, labeled Predicted; search finds a place; a reminder names the place', async () => {
  const page = await open({ at: utc('2026-11-08T20:10:00Z'), prefs: { starred: ['curse-surge'] }, reminders: { on: true, lead: 30, notify: false, hourly: true } });
  assert.ok((await cardNames(page)).includes("Curse Surge: The Broodmother's Nest"), 'the 20:00 UTC slot, as Wowhead showed it');
  await click(page, '#now-list [data-details="curse-surge"]');
  const d = await text(page, '#details-body');
  assert.match(d, /^Curse Surge: The Broodmother's Nest/);
  assert.match(d, /Predicted/);
  assert.match(d, /In turnThe Broodmother's Nest, The Looming Mutagenitor, Mlurkkr Massacre, Siege at the Whispering Marsh, The Malformed Leviathan, then again; the next one every 30 minutes\./);
  assert.match(d, /How long30 minutes, every 30 minutes/);
  assert.match(d, /EuropeMlurkkr Massacre: On now, ends Sun, Nov 8, 2:30 PM \(Predicted\)/, "Europe is at another place at the same time");
  assert.match(d, /LaterCurse Surge: The Looming Mutagenitor: /);
  assert.match(d, /Blizzard says Curse Surges rotate every 30 minutes/);
  await page.eval(`document.getElementById('details').close()`);
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  assert.match((await trayText(page))[0], /^Curse Surge: The Looming Mutagenitor \(Predicted\) starts in 19m \d\ds · 2:30 PM$/);
  await click(page, '#filters-toggle');
  await page.eval(`(() => { const i = document.getElementById('search'); i.value = 'mutagenitor'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.waitFor(`document.getElementById('search-status').textContent.startsWith('1 event matches')`, 3000);
  assert.deepEqual(await cardNames(page), ["Curse Surge: The Broodmother's Nest"]);
  await click(page, '[data-region="eu"]');
  assert.ok((await cardNames(page)).includes('Curse Surge: Mlurkkr Massacre'), 'Europe is two places ahead');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('details from the weekly overview describe the slot on now, not the week\'s first; the other region\'s line is the same occurrence there', async () => {
  const page = await open({ at: utc('2026-11-08T20:10:00Z') });
  const dl = () => page.eval(`Object.fromEntries([...document.querySelectorAll('#details dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))`);
  // The week's line for Curse Surges opens the 20:00 UTC slot, not Tuesday's first one.
  await click(page, '#week-grid .week-col:first-child [data-details="curse-surge"]');
  let d = await dl();
  assert.equal(await text(page, '#details-title'), "Curse Surge: The Broodmother's Nest");
  assert.match(d.When, /^On now, ends Sun, Nov 8, 2:30 PM/);
  assert.match(d.Later, /^Curse Surge: The Looming Mutagenitor: Sun, Nov 8, 2:30 PM/);
  assert.equal(d.Europe, 'Mlurkkr Massacre: On now, ends Sun, Nov 8, 2:30 PM (Predicted)');
  assert.equal(await page.eval(`Number(document.querySelector('#details [data-ics]').dataset.start)`), utc('2026-11-08T20:00:00Z'), 'Add to calendar saves this slot');
  await page.eval(`document.getElementById('details').close()`);
  await click(page, '#week-grid .week-col:first-child [data-details="aqir-invasion"]');
  d = await dl();
  assert.match(d.When, /^(On now|Starts Sun, Nov 8, 3:00 PM)/, d.When);
  assert.doesNotMatch(JSON.stringify(d), /Nov 3/, 'nothing from the start of the week');
  await page.eval(`document.getElementById('details').close()`);
  // Next week's line opens that week's first slot, which is still to come.
  await click(page, '#week-grid .week-col:last-child [data-details="curse-surge"]');
  assert.match((await dl()).When, /^Starts Tue, Nov 10, 9:00 AM/);
  await page.eval(`document.getElementById('details').close()`);
  // This week's Faire has ended in both regions, and Europe's line says so instead of "On now" or December's.
  await click(page, '#week-grid .week-col:first-child [data-details="darkmoon-faire"]');
  d = await dl();
  assert.deepEqual([d.When, d.Europe], ['Ended Sun, Nov 8, 1:00 AM', 'Ended Sat, Nov 7, 5:00 PM (Predicted time)']);
  await page.eval(`document.getElementById('details').close()`);
  // A January Darkmoon Faire from the calendar: Europe's line is Europe's January Faire, not the next one.
  await page.eval(`[...document.querySelectorAll('#calendar [data-details="darkmoon-faire"]')].find((b) => new Date(Number(b.dataset.start)).getUTCMonth() === 0).click()`);
  d = await dl();
  assert.match(d.When, /^Starts Sun, Jan 3, /);
  assert.match(d.Europe, /^Starts Sat, Jan 2, 5:00 PM \(Predicted time\)$/);
  assert.deepEqual(page.problems, []);
  await page.close();
});

// ---- Calendar export ----

/** Runs action and returns the text of the one file the browser saves meanwhile. */
async function saved(page, action, ext = '.ics') {
  const dir = mkdtempSync(join(tmpdir(), 'wowtracker-ics-'));
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await action();
  for (let i = 0; i < 50; i++) {
    const files = readdirSync(dir).filter((f) => f.endsWith(ext));
    if (files.length) { await sleep(100); return { name: files[0], text: readFileSync(join(dir, files[0]), 'utf8') }; }
    await sleep(100);
  }
  throw new Error(`no ${ext} file was saved`);
}
const Ics = require(join(DIR, 'js', 'ics.js'));
const Engine = require(join(DIR, 'js', 'schedule.js'));

check('Export to calendar saves what the filters show, on now and coming up, as the engine has it; hidden and hourly events stay out; nothing is sent', async () => {
  const at = utc('2026-10-28T01:30:00Z');
  const page = await open({ at, prefs: { hidden: ['day-of-the-dead'] } });
  await click(page, '#export-btn');
  assert.equal(await page.eval(`document.getElementById('export-dialog').open`), true);
  assert.equal(await text(page, '#export-scope'), 'Americas, with your filters: all categories · 7 days · Local · 1 hidden. Hidden events are left out.');
  assert.match(await text(page, '#export-notes'), /Left out: Aqir Invasion, Curse Surge \(repeat every hour or more often\)/);
  const before = page.requests.length;
  const file = await saved(page, () => click(page, '#export-go'));
  assert.equal(page.requests.filter((u, i) => i >= before && !u.startsWith('blob:')).length, 0, 'the export asks nothing of the network');
  assert.equal(file.name, 'wowtracker-americas-2026-10-28.ics');
  // The windows the engine gives for the same filters: overlapping now .. now + 7 days, not hidden, not hourly.
  const DATA = require(join(DIR, 'events-data.js'));
  const expected = DATA.events.filter((e) => e.id !== 'day-of-the-dead' && !['aqir-invasion', 'curse-surge'].includes(e.id))
    .flatMap((e) => (e.schedules.us ? Engine.windows(e.schedules.us, at, at + 7 * 86400000).map((w) => `${Ics.stamp(w.start)} ${Ics.stamp(w.end)} ${w.name || e.name}${e.status === 'predicted' ? ' (Predicted)' : ''}`) : []))
    .sort();
  const got = icsEvents(file.text).map((x) => `${x.DTSTART} ${x.DTEND} ${x.SUMMARY}`).sort();
  assert.deepEqual(got, expected);
  assert.ok(got.length >= 4 && got.some((g) => g.endsWith("Lu'ashal (Predicted)")), got.join('\n'));
  await page.close();
});

check('the export choices: everything known, and predicted events left out when unticked', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  await click(page, '#export-btn');
  const count = async () => Number((/^Download (\d+)/.exec(await text(page, '#export-go')) || [])[1]);
  const soon = await count();
  await page.eval(`(() => { const r = document.querySelector('input[name="export-range"][value="all"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const all = await count();
  assert.ok(all > soon, `${all} > ${soon}`);
  assert.match(await text(page, '#export-all-label'), new RegExp(`^Everything known, through Mar 31, 2027 \\(${all}\\)$`));
  await page.eval(`(() => { const c = document.getElementById('export-predicted'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const withoutPredicted = await count();
  assert.ok(withoutPredicted < all, 'unticking leaves the predicted events out of the count');
  const file = await saved(page, () => click(page, '#export-go'));
  const titles = icsEvents(file.text).map((x) => x.SUMMARY);
  assert.equal(titles.length, withoutPredicted, 'the file holds what the button said');
  assert.ok(!titles.some((t) => t.endsWith('(Predicted)')), 'no predicted events');
  assert.ok(titles.includes('Darkmoon Faire') && titles.includes('Noblegarden'), 'through the end of the data');
  await page.close();
});

check('Add to calendar in the details saves that one occurrence with a stable identifier; in Europe the title says (Predicted time)', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { region: 'eu' } });
  await click(page, '#now-list [data-details="hallows-end"]');
  const one = await saved(page, () => click(page, '#details [data-ics]'));
  const [e] = icsEvents(one.text);
  assert.equal(icsEvents(one.text).length, 1);
  assert.equal(one.name, 'wowtracker-hallows-end-2026-10-19.ics');
  assert.deepEqual([e.DTSTART, e.DTEND, e.SUMMARY, e.STATUS], ['20261019T080000Z', '20261102T090000Z', "Hallow's End (Predicted time)", 'TENTATIVE']);
  assert.equal(e.UID, Ics.uid(`hallows-end|eu|${Date.parse('2026-10-19T08:00:00Z')}`));
  assert.match(e.DESCRIPTION, /^Predicted time: the dates are confirmed\\; the start time on European realms is not\./);
  assert.match(e.DESCRIPTION, /Sources: .*https:\/\//);
  const again = await saved(page, () => click(page, '#details [data-ics]'));
  assert.equal(icsEvents(again.text)[0].UID, e.UID, 'exporting again gives the same identifier');
  await page.close();
});

check('at the moment a bonus week ends it is not exported, and the next one is', async () => {
  const page = await open({ at: utc('2026-11-10T14:00:00Z') });
  await click(page, '#export-btn');
  const file = await saved(page, () => click(page, '#export-go'));
  const titles = icsEvents(file.text).map((x) => x.SUMMARY);
  assert.ok(!titles.includes('Midnight Dungeon Event'), 'ended at 14:00 UTC (half-open window)');
  assert.ok(titles.includes('Arena Skirmish Bonus Event') && titles.includes('Cragpine (Predicted)'), titles.join(', '));
  await page.close();
});

check('the built site serves the four calendar feeds next to the page as text/calendar, byte for byte with CRLF, and nothing on the page links to them yet', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z') });
  for (const f of ['retail-americas', 'retail-europe', 'forever-americas', 'forever-europe']) {
    const got = await page.eval(`fetch('calendar/${f}.ics').then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() }))`);
    assert.deepEqual([got.status, got.type], [200, 'text/calendar; charset=utf-8'], f);
    assert.equal(got.text, readFileSync(join(DIR, 'calendar', `${f}.ics`), 'utf8'), f);
    assert.ok(got.text.startsWith('BEGIN:VCALENDAR\r\n') && !/[^\r]\n/.test(got.text), `${f}: CRLF`);
  }
  assert.equal(await page.eval(`[...document.querySelectorAll('a[href]')].filter((a) => /calendar\\/|webcal:/.test(a.getAttribute('href'))).length`), 0, 'no subscribe link until the real-client test passes');
  await page.close();
});

// ---- Reminders ----

const REM_ON = { on: true, lead: 15, notify: false, hourly: false };
const THORM = { starred: ['world-boss-thormbelan'] }; // Americas: 2026-11-10 15:00 UTC, Predicted
const trayText = (page) => page.eval(`[...document.querySelectorAll('#reminders-tray .reminder')].map((r) => r.querySelector('p').textContent)`);
/** Moves the page's clock to iso, as a sleep, a wake or a clock change would. */
const jumpClock = (page, iso) => page.eval(`(() => { const base = Date.now, extra = ${Date.parse(iso)} - Date.now(); Date.now = () => base() + extra; })()`);
/** A stand-in for the browser's notifications: records what is shown and asked, answers as told. */
const FAKE_NOTIFICATIONS = (answer, broken = false) => `(() => {
  window.__notes = []; window.__asked = 0; let perm = 'default';
  window.Notification = class { constructor(t, o) { if (${broken}) throw new TypeError('Illegal constructor'); window.__notes.push({ t, o }); }
    static get permission() { return perm; }
    static requestPermission() { window.__asked++; perm = ${JSON.stringify(answer)}; return Promise.resolve(perm); } };
})()`;

check('reminders are off by default; the dialog turns them on, sets the lead and hourly events, and says they need the page open; all saved', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.equal(await text(page, '#reminders-btn'), 'Reminders: off');
  // It opens a dialog, so it is not announced as a toggle; on, it looks pressed all the same.
  const look = () => page.eval(`(() => { const b = document.getElementById('reminders-btn'); return [b.hasAttribute('aria-pressed'), b.getAttribute('aria-haspopup'), getComputedStyle(b).borderColor]; })()`);
  const off = await look();
  assert.deepEqual(off.slice(0, 2), [false, 'dialog']);
  await click(page, '#reminders-btn');
  assert.equal(await page.eval(`document.getElementById('reminders-dialog').open`), true);
  assert.match(await text(page, '#reminders-dialog'), /only while WoW Tracker is open in a tab/);
  assert.deepEqual(await page.eval(`[document.getElementById('rem-on').checked, document.getElementById('rem-lead').disabled]`), [false, true]);
  await click(page, '#rem-on');
  await page.eval(`(() => { const s = document.getElementById('rem-lead'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click(page, '#rem-hourly');
  assert.equal(await text(page, '#reminders-btn'), 'Reminders: 5 min');
  const on = await look();
  assert.equal(on[0], false, 'still no aria-pressed');
  assert.equal(on[2], await page.eval(`(() => { const b = document.createElement('button'); b.className = 'btn small'; b.setAttribute('aria-pressed', 'true'); document.body.append(b); const c = getComputedStyle(b).borderColor; b.remove(); return c; })()`), 'drawn like a pressed button');
  assert.notEqual(on[2], off[2]);
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await text(page, '#reminders-btn'), 'Reminders: 5 min');
  assert.deepEqual(await page.eval(`JSON.parse(localStorage.getItem('wowtracker:v1:reminders'))`), { on: true, lead: 5, notify: false, hourly: true });
  await page.close();
});

check('a starred event\'s reminder shows on the page lead minutes before it starts, says Predicted, and is never shown twice: not after a reload, not in a second tab', async () => {
  const at = utc('2026-11-10T14:44:56Z');
  const one = await open({ at, prefs: THORM, reminders: REM_ON });
  const two = await open({ at, keepStorage: true });
  await sleep(6000); // both tabs pass 14:45:00, the reminder moment
  const shown = [...await trayText(one), ...await trayText(two)];
  assert.equal(shown.length, 1, `shown once across two tabs: ${JSON.stringify(shown)}`);
  assert.match(shown[0], /^Thorm'belan \(Predicted\) starts in 14m \d\ds · 9:00 AM$/);
  const tab = (await trayText(one)).length ? one : two;
  assert.doesNotMatch(await tab.eval(`document.getElementById('reminders-tray').textContent`), /null|undefined/, 'one notice: no bar, nothing stray');
  assert.equal(await tab.eval(`document.getElementById('reminders-expand') === null && document.getElementById('reminders-clear') === null`), true);
  assert.match(await tab.eval('document.title'), /^\(1\) WoW Tracker/);
  await tab.reload();
  await tab.waitFor("document.querySelector('#summary li') !== null");
  await sleep(2500);
  assert.deepEqual(await trayText(tab), [], 'not again after a reload');
  await one.close(); await two.close();
});

check('nothing stale: a reminder whose event started during sleep or a clock jump, or before the page opened, is not shown; waking inside the reminder time shows it', async () => {
  const late = await open({ at: utc('2026-11-10T14:44:58Z'), prefs: THORM, reminders: REM_ON });
  await jumpClock(late, '2026-11-10T15:00:30Z'); // asleep across 14:45 and the 15:00 start
  await sleep(3500);
  assert.deepEqual(await trayText(late), []);
  await late.close();
  const after = await open({ at: utc('2026-11-10T15:00:10Z'), prefs: THORM, reminders: REM_ON });
  await sleep(2500);
  assert.deepEqual(await trayText(after), [], 'opened after the start');
  await after.close();
  const wake = await open({ at: utc('2026-11-10T14:00:00Z'), prefs: THORM, reminders: REM_ON });
  await sleep(1500);
  assert.deepEqual(await trayText(wake), []);
  await jumpClock(wake, '2026-11-10T14:52:00Z'); // wakes inside the 15 minutes
  await wake.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  await wake.close();
});

check('a shown reminder goes when its event is hidden, unstarred or the region changes; Dismiss removes it; hourly events only when asked', async () => {
  const page = await open({ at: utc('2026-11-10T14:50:00Z'), prefs: THORM, reminders: REM_ON });
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  await click(page, '[data-region="eu"]');
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 0`, 3000);
  await page.close();
  for (const act of ['#next-list [data-hide="world-boss-thormbelan"]', '#next-list [data-star="world-boss-thormbelan"]', '#reminders-tray [data-dismiss]']) {
    const p = await open({ at: utc('2026-11-10T14:50:00Z'), prefs: THORM, reminders: REM_ON });
    await p.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
    await click(p, act);
    await p.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 0`, 3000);
    assert.equal(await p.eval('document.title.startsWith("(")'), false, act);
    await p.close();
  }
  const aqir = await open({ at: utc('2026-11-08T16:50:00Z'), prefs: { starred: ['aqir-invasion'] }, reminders: REM_ON });
  await sleep(2500);
  assert.deepEqual(await trayText(aqir), [], 'hourly events are left out unless asked for');
  await click(aqir, '#reminders-btn');
  await click(aqir, '#rem-hourly');
  await aqir.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  assert.match((await trayText(aqir))[0], /^Aqir Invasion: Eversong Woods \(Predicted\) starts in/);
  await aqir.close();
});

check('browser notifications only after the reader ticks the box and the browser allows them; silent, one per reminder; refused or unsupported keeps them on the page', async () => {
  const granted = await open({ at: utc('2026-11-10T14:44:30Z'), prefs: THORM, reminders: REM_ON, before: FAKE_NOTIFICATIONS('granted') });
  assert.equal(await granted.eval('window.__asked'), 0, 'never asked on load');
  await click(granted, '#reminders-btn');
  await click(granted, '#rem-notify');
  await granted.waitFor(`window.__asked === 1 && document.getElementById('rem-notify').checked`);
  await granted.waitFor(`window.__notes.length === 1`, 40000);
  const note = await granted.eval('window.__notes[0]');
  assert.match(note.t, /^Thorm'belan \(Predicted\) starts in /);
  assert.match(note.o.body, /The time is a prediction, not published by Blizzard\./);
  assert.equal(note.o.silent, true);
  assert.equal(note.o.tag, `us|world-boss-thormbelan|${utc('2026-11-10T15:00:00Z')}|15`);
  assert.equal((await trayText(granted)).length, 1, 'the page notice shows too');
  await granted.close();
  const denied = await open({ at: utc('2026-11-10T14:50:00Z'), prefs: THORM, reminders: REM_ON, before: FAKE_NOTIFICATIONS('denied') });
  await click(denied, '#reminders-btn');
  await click(denied, '#rem-notify');
  await denied.waitFor(`window.__asked === 1`);
  await sleep(300);
  assert.equal(await denied.eval(`document.getElementById('rem-notify').checked`), false);
  assert.match(await text(denied, '#rem-notify-status'), /blocked for this site/);
  await denied.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  assert.equal(await denied.eval('window.__notes.length'), 0);
  await denied.close();
  const unticked = await open({ at: utc('2026-11-10T14:50:00Z'), prefs: THORM, reminders: REM_ON, before: FAKE_NOTIFICATIONS('granted') + `;window.Notification.requestPermission();` });
  await unticked.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 5000);
  assert.equal(await unticked.eval('window.__notes.length'), 0, 'allowed by the browser but not ticked: no notification');
  await unticked.close();
  const broken = await open({ at: utc('2026-11-10T14:44:57Z'), prefs: THORM, reminders: { ...REM_ON, notify: true }, before: FAKE_NOTIFICATIONS('granted', true) + `;window.Notification.requestPermission();` });
  await broken.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 8000);
  await click(broken, '#reminders-btn');
  assert.match(await text(broken, '#rem-notify-status'), /does not let a page show notifications/);
  await broken.close();
});

// ---- Several reminders at once ----

// Thorm'belan, the Arena Skirmish bonus week and the hourly Aqir Invasion all start 2026-11-10 15:00 UTC in the Americas.
const AT_ONCE = { starred: ['world-boss-thormbelan', 'arena-skirmish-bonus', 'aqir-invasion'] };
const REM_HOURLY = { ...REM_ON, hourly: true };
const shownReminders = (page) => page.eval(`[...document.querySelectorAll('#reminders-tray .reminder')].filter((r) => r.offsetParent !== null).map((r) => r.querySelector('strong').textContent)`);
/** Test only: two copies of Thorm'belan put into the data before the page reads it, at 15:00 and 15:05 UTC. */
const TWO_MORE = `(() => { let d; Object.defineProperty(window, 'WOW_DATA', { configurable: true, get: () => d, set: (v) => {
  const base = v.events.find((e) => e.id === 'world-boss-thormbelan');
  for (const [n, later] of [['b', 0], ['c', 5]]) {
    const copy = JSON.parse(JSON.stringify(base));
    copy.id = 'world-boss-thormbelan-' + n; copy.name = "Thorm'belan " + n.toUpperCase(); copy.schedules.us.offsetMin += later;
    v.events.push(copy);
  }
  d = v; } }); })()`;

check('on a phone several reminders at once show one notice and "+2 more", which opens the rest as one-line rows; Dismiss, Dismiss all, and each read out once', async () => {
  const page = await open({ at: utc('2026-11-10T14:50:00Z'), width: 390, height: 844, mobile: true, prefs: AT_ONCE, reminders: REM_HOURLY });
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 3`, 5000);
  assert.equal((await shownReminders(page)).length, 1, 'one notice on a phone');
  assert.equal(await text(page, '#reminders-expand'), '+2 more reminders');
  assert.equal(await page.eval(`document.getElementById('reminders-expand').getAttribute('aria-expanded')`), 'false');
  const folded = await page.eval(`document.getElementById('reminders-tray').getBoundingClientRect().height`);
  assert.ok(folded < 130, `${folded} px tall with three reminders`);
  await click(page, '#reminders-expand');
  assert.equal((await shownReminders(page)).length, 3);
  assert.equal(await page.eval(`document.getElementById('reminders-expand').getAttribute('aria-expanded')`), 'true');
  assert.equal(await text(page, '#reminders-expand'), 'Show fewer');
  const rows = await page.eval(`[...document.querySelectorAll('#reminders-more .reminder')].map((r) => Math.round(r.getBoundingClientRect().height))`);
  assert.ok(rows.length === 2 && rows.every((x) => x <= 34), `one-line rows: ${rows}`);
  assert.equal(await page.eval(`(() => { const m = document.getElementById('reminders-more'), r = m.getBoundingClientRect(); return m.scrollWidth <= m.clientWidth && [...m.querySelectorAll('.reminder, [data-dismiss]')].every((e) => e.getBoundingClientRect().right <= r.right + 0.5); })()`), true, 'each row and its Dismiss fit inside the panel');
  const box = await page.eval(`(() => { const r = document.getElementById('reminders-tray').getBoundingClientRect(); return [r.left, r.right, innerWidth, r.height]; })()`);
  assert.ok(box[0] >= 0 && box[1] <= box[2] && box[3] < 240, JSON.stringify(box));
  assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
  assert.match((await texts(page, '#reminders-more .reminder p'))[0], / starts in \d+m \d\ds · 9:00 AM$/, 'the rows count down too');
  // The tray is not a live region (its countdowns would be read out every second); new reminders are, once.
  assert.equal(await page.eval(`document.getElementById('reminders-tray').closest('[aria-live], [role="status"], [role="alert"]') === null`), true);
  await page.waitFor(`(document.getElementById('reminders-say').textContent.match(/Reminder:/g) || []).length === 3`, 3000);
  assert.match(await text(page, '#reminders-say'), /^Reminder: .+ starts in .+, 9:00 AM\. Reminder: /);
  await page.eval(`(() => { const b = document.querySelector('#reminders-more [data-dismiss]'); b.focus(); b.click(); })()`);
  assert.equal(await page.eval(`document.querySelectorAll('#reminders-tray .reminder').length`), 2);
  assert.equal(await page.eval(`document.activeElement.hasAttribute('data-dismiss')`), true, 'focus stays on a Dismiss in the tray');
  assert.match(await page.eval('document.title'), /^\(2\) WoW Tracker/);
  await page.eval(`(() => { const b = document.getElementById('reminders-clear'); b.focus(); b.click(); })()`);
  assert.equal(await page.eval(`document.getElementById('reminders-tray').hidden`), true);
  assert.equal(await page.eval('document.title.startsWith("(")'), false);
  assert.equal(await page.eval('document.activeElement.id'), 'coming-title', 'focus goes somewhere sensible, not to the page body');
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  await sleep(2000);
  assert.deepEqual(await trayText(page), [], 'dismissed reminders do not come back');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('on a desktop at most three notices show, soonest first, the rest behind "+N more"; narrowing the window to a phone leaves one', async () => {
  const page = await open({ at: utc('2026-11-10T14:50:00Z'), prefs: { starred: [...AT_ONCE.starred, 'world-boss-thormbelan-b', 'world-boss-thormbelan-c'] }, reminders: REM_HOURLY, before: TWO_MORE });
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 5`, 5000);
  const first = await shownReminders(page);
  assert.equal(first.length, 3);
  assert.ok(!first.includes("Thorm'belan C (Predicted)"), `the 15:05 start is not among the first three: ${first}`);
  assert.equal(await text(page, '#reminders-expand'), '+2 more reminders');
  const folded = await page.eval(`document.getElementById('reminders-tray').getBoundingClientRect().height`);
  // Relative to the window, not a pixel count: a notice can take two lines with other fonts (262 px on CI's Linux, 242 on Windows).
  assert.ok(folded <= (await page.eval('innerHeight')) / 3, `${folded} px with three notices and the bar`);
  await click(page, '#reminders-expand');
  const all = await shownReminders(page);
  assert.equal(all.length, 5);
  assert.equal(all[4], "Thorm'belan C (Predicted)", 'soonest first');
  const tall = await page.eval(`document.getElementById('reminders-tray').getBoundingClientRect().height`);
  assert.ok(tall <= (await page.eval('innerHeight')) / 2, `${tall} px with five reminders open`);
  await page.viewport(390, 844, true);
  await page.waitFor(`document.querySelectorAll('#reminders-tray .reminder-list .reminder').length === 1`, 3000);
  await click(page, '#reminders-expand'); // it stayed open: fold it
  assert.equal(await text(page, '#reminders-expand'), '+4 more reminders');
  assert.equal((await shownReminders(page)).length, 1);
  await page.close();
});

// ---- Your checklist ----

const TASKS = { tasks: [{ id: 'wq', name: 'World quests', kind: 'daily' }, { id: 'vault', name: 'Claim the Great Vault', kind: 'weekly' }], done: {} };
const ticks = (page) => page.eval(`[...document.querySelectorAll('#checklist [data-task]')].map((b) => b.getAttribute('data-task') + ':' + b.checked).join(' ')`);
const savedChecklist = async (page) => JSON.parse(await page.eval(`localStorage.getItem('wowtracker:v1:checklist')`));

check('your checklist sits after Coming up as one folded line with nothing added; tasks are added, ticked, renamed, moved and deleted, and come back after a reload', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z') });
  const order = await page.eval(`[...document.querySelectorAll('main > section')].map((s) => s.getAttribute('aria-labelledby'))`);
  assert.deepEqual(order.slice(order.indexOf('coming-title'), order.indexOf('coming-title') + 3), ['coming-title', 'checklist-title', 'week-title']);
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:checklist')`), null, 'nothing is added on its own');
  assert.equal(await text(page, '#checklist-count'), 'No tasks yet');
  assert.equal(await page.eval(`document.getElementById('checklist-body').hidden`), true);
  const folded = await page.eval(`document.getElementById('checklist').getBoundingClientRect().height`);
  assert.ok(folded < 50, `${folded} px folded`);
  await click(page, '#cl-toggle');
  assert.equal(await page.eval(`document.getElementById('cl-toggle').getAttribute('aria-expanded')`), 'true');
  assert.match(await text(page, '#checklist-note'), /the game is not read, so finishing something in game does not tick it here/);
  assert.match(await text(page, '#checklist-groups'), /No tasks yet\. Add your own below, or start from Suggestions\./);
  const add = (name, kind, enter) => page.eval(`(() => { const i = document.getElementById('cl-name'); i.value = ${JSON.stringify(name)}; document.getElementById('cl-kind').value = '${kind}';
    ${enter ? "i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))" : "document.getElementById('cl-add').click()"}; })()`);
  await add('World quests', 'daily', false);
  await add('Great Vault', 'weekly', true);
  assert.equal(await page.eval(`document.getElementById('cl-name').value`), '', 'the box empties after Add');
  await add('  world QUESTS ', 'daily', false);
  assert.match(await text(page, '#cl-status'), /"world QUESTS" is already on your daily list/);
  await add('   ', 'daily', false);
  assert.match(await text(page, '#cl-status'), /Type a name/);
  assert.deepEqual(await texts(page, '#checklist .cl-name'), ['World quests', 'Great Vault']);
  assert.equal(await text(page, '#checklist-count'), '0 of 1 today · 0 of 1 this week');
  assert.match(await text(page, '#checklist [data-kind="daily"] h3'), /clears Wed 9:00 AM$/);
  assert.match(await text(page, '#checklist [data-kind="weekly"] h3'), /clears Tue, Nov 17, 9:00 AM$/);
  await click(page, '#checklist [data-kind="daily"] [data-task]');
  assert.equal(await text(page, '#checklist-count'), '1 of 1 today · 0 of 1 this week');
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await page.eval(`document.getElementById('checklist-body').hidden`), false, 'an opened checklist stays open');
  assert.equal(await text(page, '#checklist-count'), '1 of 1 today · 0 of 1 this week');
  await click(page, '#cl-edit');
  assert.equal(await page.eval(`document.getElementById('cl-edit').getAttribute('aria-pressed')`), 'true');
  const set = (sel, value, enter) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(value)};
    e.dispatchEvent(${enter ? "new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })" : "new Event('change', { bubbles: true })"}); })()`);
  await set('#checklist [data-kind="weekly"] [data-rename]', 'Claim the Great Vault', true);
  assert.match(await page.eval('document.activeElement.getAttribute("data-fkey")'), /^cl:[a-z0-9]+:name$/, 'Enter saves and keeps focus in the name');
  await set('#checklist [data-kind="daily"] [data-kind-of]', 'weekly', false);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#checklist [data-kind="weekly"] [data-rename]')].map((i) => i.value)`), ['World quests', 'Claim the Great Vault']);
  await set('#checklist [data-rename]', '', false);
  assert.match(await text(page, '#cl-status'), /A task needs a name/);
  await page.eval(`(() => { const b = [...document.querySelectorAll('#checklist [data-delete]')][1]; b.focus(); b.click(); })()`);
  assert.match(await text(page, '#cl-status'), /Deleted "Claim the Great Vault"/);
  assert.equal(await page.eval(`document.activeElement.getAttribute('data-delete') !== null`), true, 'focus moves to the next Delete');
  await click(page, '#cl-edit');
  assert.deepEqual(await texts(page, '#checklist .cl-name'), ['World quests']);
  assert.equal(await text(page, '#checklist-count'), '0 of 1 this week', 'moved to weekly, it starts unticked there');
  const stored = await savedChecklist(page);
  assert.deepEqual([stored.tasks.map((x) => [x.name, x.kind]), stored.done], [[['World quests', 'weekly']], {}]);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('the checklist clears at the reset on a running page in both regions: a daily reset leaves weekly ticks, the weekly reset clears both', async () => {
  // Americas, Wednesday 15:00 UTC: a daily reset only.
  const us = await open({ at: utc('2026-11-11T14:59:57Z'), prefs: { checklistOpen: true }, checklist: { ...TASKS, done: { 'us:daily:2026-11-10T15:00Z': ['wq'], 'us:weekly:2026-11-10T15:00Z': ['vault'] } } });
  assert.equal(await ticks(us), 'wq:true vault:true');
  await us.waitFor(`document.querySelector('#checklist [data-task="wq"]').checked === false`, 8000);
  assert.equal(await ticks(us), 'wq:false vault:true');
  assert.equal(await text(us, '#checklist-count'), '0 of 1 today · 1 of 1 this week');
  await us.close();
  // Europe, Wednesday 04:00 UTC: the daily and the weekly reset at once.
  const eu = await open({ at: utc('2026-11-11T03:59:57Z'), prefs: { region: 'eu', checklistOpen: true }, checklist: { ...TASKS, done: { 'eu:daily:2026-11-10T04:00Z': ['wq'], 'eu:weekly:2026-11-04T04:00Z': ['vault'] } } });
  assert.equal(await ticks(eu), 'wq:true vault:true');
  await eu.waitFor(`document.querySelector('#checklist [data-task="vault"]').checked === false`, 8000);
  assert.equal(await ticks(eu), 'wq:false vault:false');
  await eu.close();
});

check('the checklist after a reload, a sleep across the reset and three weeks away: the current period keeps its ticks, a past one comes back unticked and is pruned', async () => {
  const done = { 'us:daily:2026-11-09T15:00Z': ['wq'], 'us:weekly:2026-11-03T15:00Z': ['vault'] };
  const page = await open({ at: utc('2026-11-10T12:00:00Z'), prefs: { checklistOpen: true }, checklist: { ...TASKS, done } });
  assert.equal(await ticks(page), 'wq:true vault:true');
  await page.reload();
  await page.waitFor("document.querySelector('#checklist [data-task]') !== null");
  assert.equal(await ticks(page), 'wq:true vault:true', 'a reload inside the period keeps the ticks');
  await jumpClock(page, '2026-11-10T16:00:00Z'); // asleep across Tuesday's resets
  await page.waitFor(`document.querySelector('#checklist [data-task="vault"]').checked === false`, 5000);
  assert.equal(await ticks(page), 'wq:false vault:false');
  await page.close();
  const later = await open({ at: utc('2026-12-01T12:00:00Z'), keepStorage: true });
  assert.deepEqual(await savedChecklist(later), { tasks: TASKS.tasks, done: {} }, 'ticks from three weeks ago are pruned on load; the tasks stay');
  assert.equal(await text(later, '#checklist-count'), '0 of 1 today · 0 of 1 this week');
  await later.close();
});

check('tasks are shared by both regions and ticks kept per region, so switching region and back loses nothing', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: { checklistOpen: true }, checklist: TASKS });
  await click(page, '#checklist [data-task="vault"]');
  assert.equal(await ticks(page), 'wq:false vault:true');
  await click(page, '[data-region="eu"]');
  assert.equal(await ticks(page), 'wq:false vault:false', 'Europe has its own week');
  assert.match(await text(page, '#checklist-note'), /They clear at the Europe daily and weekly resets; each region keeps its own\./);
  await click(page, '#checklist [data-task="wq"]');
  await click(page, '[data-region="us"]');
  assert.equal(await ticks(page), 'wq:false vault:true');
  await click(page, '[data-region="eu"]');
  assert.equal(await ticks(page), 'wq:true vault:false');
  const stored = await savedChecklist(page);
  assert.deepEqual(stored.tasks, TASKS.tasks);
  assert.deepEqual(Object.keys(stored.done).sort(), ['eu:daily:2026-11-10T04:00Z', 'us:weekly:2026-11-10T15:00Z']);
  await page.close();
});

check('suggested tasks are only offered: nothing is added until picked, picked ones are added, and those on the list are marked', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z') });
  await click(page, '#cl-toggle');
  await click(page, '#cl-suggest');
  assert.equal(await page.eval(`document.getElementById('suggest-dialog').open`), true);
  assert.match(await text(page, '#suggest-dialog'), /not every one fits every character, and none of them is checked against the game/);
  assert.ok(await page.eval(`document.querySelectorAll('#suggest-groups [data-template]').length`) >= 8);
  assert.equal(await page.eval(`document.querySelectorAll('#suggest-groups [data-template]:checked').length`), 0, 'none is picked for you');
  assert.equal(await page.eval(`document.getElementById('suggest-add').disabled`), true);
  await click(page, '#suggest-groups [data-template="vault-claim"]');
  await click(page, '#suggest-groups [data-template="world-quests"]');
  assert.equal(await text(page, '#suggest-add'), 'Add 2 tasks');
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:checklist')`), null, 'nothing is saved before Add');
  await click(page, '#suggest-add');
  assert.equal(await page.eval(`document.getElementById('suggest-dialog').open`), false);
  assert.deepEqual(await texts(page, '#checklist .cl-name'), ['World quests', 'Claim the Great Vault']);
  assert.match(await text(page, '#cl-status'), /Added 2 tasks/);
  await click(page, '#cl-suggest');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#suggest-groups [data-template]:disabled')].map((x) => x.getAttribute('data-template'))`), ['world-quests', 'vault-claim']);
  assert.match(await text(page, '#suggest-groups'), /Claim the Great Vault \(on your list\)/);
  await page.close();
});

check('an open checklist is not rebuilt on the one-second tick, and an idle page with it still restyles about once a second', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: { checklistOpen: true }, checklist: TASKS });
  await page.eval(`window.__cl = 0; new MutationObserver((m) => { window.__cl += m.length; }).observe(document.getElementById('checklist'), { childList: true, subtree: true, characterData: true, attributes: true })`);
  await page.send('Performance.enable', {});
  const recalcs = async () => (await page.send('Performance.getMetrics', {})).metrics.find((m) => m.name === 'RecalcStyleCount').value;
  const before = await recalcs();
  await sleep(3000);
  const n = (await recalcs()) - before;
  assert.equal(await page.eval('window.__cl'), 0, 'no change to the checklist in 3 s');
  assert.ok(n < 20, `${n} style recalculations in 3 s`);
  await page.close();
});

check('a task name being typed in Edit survives the rebuild at the reset: text, cursor and focus stay, and Enter then saves it', async () => {
  const page = await open({ at: utc('2026-11-11T14:59:56Z'), prefs: { checklistOpen: true }, checklist: TASKS });
  await click(page, '#cl-edit');
  const before = await text(page, '#checklist [data-kind="daily"] h3');
  await page.eval(`(() => { const i = document.querySelector('#checklist [data-rename="wq"]'); i.focus(); i.value = 'World quests and Abundance'; i.setSelectionRange(13, 13); })()`);
  await page.waitFor(`document.querySelector('#checklist [data-kind="daily"] h3').textContent !== ${JSON.stringify(before)}`, 8000);
  assert.match(await text(page, '#checklist [data-kind="daily"] h3'), /clears Thu 9:00 AM$/, 'rebuilt at the reset');
  assert.deepEqual(await page.eval(`(() => { const a = document.activeElement; return [a.getAttribute('data-rename'), a.value, a.selectionStart, a.selectionEnd]; })()`), ['wq', 'World quests and Abundance', 13, 13]);
  assert.equal((await savedChecklist(page)).tasks[0].name, 'World quests', 'not saved yet');
  await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  assert.equal((await savedChecklist(page)).tasks[0].name, 'World quests and Abundance');
  await page.close();
});

// ---- Settings backup ----

const setBackup = (page, value) => page.eval(`(() => { const t = document.getElementById('backup-in'); t.value = ${JSON.stringify(value)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);

check('Back up settings: Copy and Download give one line that brings back settings, stars, hidden events, reminders and the checklist after storage is cleared, only after Replace', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: { region: 'eu', starred: ['hallows-end', 'darkmoon-faire'], hidden: ['moonkin-festival'], theme: 'light', checklistOpen: true },
    reminders: { ...REM_ON, lead: 30 }, checklist: { ...TASKS, done: { 'eu:weekly:2026-11-04T04:00Z': ['vault'] } } });
  await click(page, '#backup-btn');
  assert.equal(await page.eval(`document.getElementById('backup-dialog').open`), true);
  assert.match(await text(page, '#backup-dialog'), /Safari can remove them by itself after 7 days/);
  assert.equal(await text(page, '#backup-what'), 'This browser now: Europe · reminders 30 min before. Retail: 2 starred · 1 hidden · 2 checklist tasks. Forever: nothing saved.');
  const sentBefore = page.requests.length;
  await click(page, '#backup-copy');
  await page.waitFor(`navigator.clipboard.readText().then((t) => t.startsWith('{"app":"wowtracker"'))`);
  const copied = await page.eval('navigator.clipboard.readText()');
  assert.equal(copied.includes('\n'), false, 'one line');
  const file = await saved(page, () => click(page, '#backup-download'), '.json');
  assert.equal(file.name, 'wowtracker-settings-2026-11-10.json');
  assert.deepEqual(JSON.parse(file.text).editions, JSON.parse(copied).editions);
  assert.deepEqual([JSON.parse(copied).format, Object.keys(JSON.parse(copied).editions)], [2, ['retail']], 'Forever has nothing saved, so it is not in the backup');
  assert.deepEqual(page.requests.slice(sentBefore).filter((u) => !u.startsWith('blob:') && !u.includes('?clock=')), [], 'nothing is sent');
  // The browser forgets everything (cleared site data, or Safari after 7 days).
  await page.eval('localStorage.clear()');
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await page.eval(`document.querySelector('[data-region="us"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await text(page, '#checklist-count'), 'No tasks yet');
  await click(page, '#backup-btn');
  await setBackup(page, copied);
  await click(page, '#backup-check');
  assert.deepEqual(await texts(page, '#backup-result .backup-plan li'), [
    'Shared settings: Europe · reminders 30 min before. Changes the region, theme and reminders.',
    'Retail: 2 starred · 1 hidden · 2 checklist tasks. Replaces 0 starred · 0 hidden · no checklist tasks.',
    'Forever: not in this backup, so it stays as it is.']);
  assert.match(await text(page, '#backup-result'), /^This backup can be restored\. Made Tue, Nov 10, 12:00 PM with v\d+\.\d+\.\d+\. Restoring it changes this browser like this:/);
  assert.match(await text(page, '#backup-result'), /The game version on screen stays Retail\./);
  assert.equal(await page.eval('document.activeElement.id'), 'backup-apply');
  assert.doesNotMatch(await text(page, '#backup-result'), /null|undefined/);
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:checklist')`), null, 'nothing replaced before the confirmation');
  await click(page, '#backup-cancel');
  assert.equal(await text(page, '#backup-result'), 'Nothing was changed.');
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:checklist') === null && localStorage.getItem('wowtracker:v1:prefs') === null`), true);
  await click(page, '#backup-check');
  await click(page, '#backup-apply');
  assert.match(await text(page, '#backup-result'), /^Restored: the shared settings and reminders, and the stars, hidden events, categories and checklist of Retail\.$/);
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:edition') === null && localStorage.getItem('wowtracker:v1:forever:prefs') === null`), true, 'no edition choice and nothing of Forever written');
  const check2 = async () => {
    assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), 'light');
    assert.equal(await text(page, '#reminders-btn'), 'Reminders: 30 min');
    assert.equal(await text(page, '#hidden-btn'), 'Hidden (1)');
    assert.deepEqual(JSON.parse(await page.eval(`localStorage.getItem('wowtracker:v1:prefs')`)).starred, ['hallows-end', 'darkmoon-faire']);
    assert.equal(await ticks(page), 'wq:false vault:true');
  };
  await check2();
  await page.reload();
  await page.waitFor("document.querySelector('#checklist [data-task]') !== null");
  await check2();
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('a damaged, foreign, newer or oversized backup is refused with a reason and changes nothing; a backup file opens; odd entries are left out and shown as text', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: { starred: ['hallows-end'] }, checklist: TASKS });
  const stored = () => page.eval(`JSON.stringify(['prefs', 'reminders', 'checklist'].map((k) => localStorage.getItem('wowtracker:v1:' + k)))`);
  const before = await stored();
  await click(page, '#backup-btn');
  for (const [value, reason] of [
    ['', /Paste a backup first/],
    ['{"app": "wowtracker", "prefs": {', /not valid JSON/],
    ['{"app": "gw2timer", "format": 1, "prefs": {}}', /valid JSON but not a WoW Tracker backup/],
    ['{"app": "wowtracker", "format": 9, "prefs": {}}', /made by a newer WoW Tracker/],
    ['{"app": "wowtracker", "format": 1, "edition": "classic", "prefs": {}}', /game version this WoW Tracker does not have/],
    ['{"app": "wowtracker", "format": 2, "editions": {"retail": "all"}}', /backup is damaged/],
    ['{"app": "wowtracker", "format": 2}', /holds no settings/],
    ['{"app": "wowtracker", "format": 1}', /holds no settings/],
    ['x'.repeat(250000), /far larger than a WoW Tracker backup/],
  ]) {
    await setBackup(page, value);
    await click(page, '#backup-check');
    const said = await text(page, '#backup-result');
    assert.match(said, reason);
    assert.match(said, /Nothing was changed\.$/);
    assert.equal(await page.eval(`document.getElementById('backup-apply') === null`), true, `no Replace for ${value.slice(0, 30)}`);
  }
  assert.equal(await stored(), before, 'storage untouched');
  const odd = JSON.stringify({ app: 'wowtracker', format: 1, prefs: { region: 'eu', starred: ['hallows-end', 'gone-event'] }, checklist: { tasks: [{ id: 'x1', name: '<img src=x onerror=alert(1)>', kind: 'daily' }], done: {} } });
  const dir = mkdtempSync(join(tmpdir(), 'wowtracker-backup-'));
  writeFileSync(join(dir, 'backup.json'), odd);
  await page.setFiles('#backup-file', [join(dir, 'backup.json')]);
  await page.waitFor(`document.getElementById('backup-apply') !== null`);
  assert.match(await text(page, '#backup-result'), /1 starred or hidden event is not in this version's schedule data and will be left out\./);
  assert.equal(await page.eval(`document.getElementById('backup-in').value`), odd, 'the file is shown in the box');
  await setBackup(page, odd + ' ');
  assert.equal(await page.eval(`document.getElementById('backup-apply') === null`), true, 'editing the text after a check asks for a new check');
  await click(page, '#backup-check');
  await click(page, '#backup-apply');
  assert.deepEqual(await texts(page, '#checklist .cl-name'), ['<img src=x onerror=alert(1)>']);
  assert.equal(await page.eval(`document.querySelectorAll('#checklist img').length`), 0, 'a name is text, never markup');
  assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true');
  assert.deepEqual(page.problems, []);
  rmSync(dir, { recursive: true, force: true });
  await page.close();
});

// ---- Security and requests ----

check('selecting the backup text with a drag that ends outside the box keeps the dialog open; a click on the backdrop closes it', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z') });
  const mouse = (type, [x, y], buttons) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  const centre = (sel) => page.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  await click(page, '#backup-btn');
  await setBackup(page, '{"app":"wowtracker"}');
  for (const [from, to] of [['#backup-out', '#backup-what'], ['#backup-out', '#backup-copy'], ['#backup-in', '#backup-result']]) {
    const a = await centre(from), b = await centre(to);
    await mouse('mouseMoved', a, 0); await mouse('mousePressed', a, 1);
    for (let i = 1; i <= 4; i++) await mouse('mouseMoved', [a[0] + (b[0] - a[0]) * i / 4, a[1] + (b[1] - a[1]) * i / 4], 1);
    await mouse('mouseReleased', b, 0);
    await sleep(150);
    assert.equal(await page.eval(`document.getElementById('backup-dialog').open`), true, `a drag from ${from} to ${to}`);
  }
  assert.equal(await page.eval(`document.getElementById('backup-in').value`), '{"app":"wowtracker"}', 'the pasted text is still there');
  await mouse('mousePressed', [8, 8], 1); await mouse('mouseReleased', [8, 8], 0);
  await sleep(150);
  assert.equal(await page.eval(`document.getElementById('backup-dialog').open`), false, 'the backdrop closes it');
  await page.close();
});

check('no request leaves the site, and the CSP blocks one that tries', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { newsOpen: true } });
  await page.waitFor(`document.querySelectorAll('#news-list li').length > 0`);
  const outside = page.requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:'));
  assert.deepEqual(outside, []);
  const blocked = await page.eval(`fetch('https://example.com/').then(() => 'allowed', () => 'blocked')`);
  assert.equal(blocked, 'blocked');
  await page.close();
});

check('the clock check corrects a device clock that is three minutes slow', async () => {
  const page = await chrome.newPage();
  await page.emulate({ timezone: 'America/Chicago', locale: 'en-US' });
  await page.beforeLoad(`(() => { const real = Date.now; Date.now = () => real() - 180000; })();`);
  await page.goto(DATED);
  await page.waitFor(`!document.getElementById('clock-notice').hidden`, 15000);
  assert.match(await text(page, '#clock-notice'), /3m 0\ds slow|2m 5\ds slow/);
  await page.close();
});

// ---- Editions: Retail (the default) and Forever, one per page load ----

const pressedEdition = (page) => page.eval(`(document.querySelector('[data-edition][aria-pressed="true"]') || {}).getAttribute ? document.querySelector('[data-edition][aria-pressed="true"]').getAttribute('data-edition') : null`);
/** Clicks an edition and waits for the reloaded page to show it. */
async function switchTo(page, id) {
  await page.eval(`document.querySelector('[data-edition="${id}"]').click()`);
  await page.waitFor(`document.readyState === 'complete' && document.querySelector('[data-edition="${id}"][aria-pressed="true"]') !== null && document.querySelector('#summary li') !== null`, 10000);
}
/** Every WoW Tracker key in this origin's storage, as stored text (except the shared news cache, which the page refreshes on its own). */
const stored = (page) => page.eval(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('wowtracker:') && k !== 'wowtracker:v1:news').sort().map((k) => [k, localStorage.getItem(k)])))`).then(JSON.parse);
const RETAIL_PREFS = { region: 'eu', filter: 'starred', categories: ['holiday', 'darkmoon', 'bonus'], starred: ['feast-of-winter-veil', 'darkmoon-faire'], hidden: ['moonkin-festival'], aheadHours: 72, compact: true, timeMode: 'both', theme: 'light', newsCollapsed: false, newsAll: true, newsShop: false, checklistOpen: true };

check('Retail is the default: with nothing saved and no link the page shows Retail, says so in the game version toggle, and writes nothing about editions', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z') });
  assert.equal(await pressedEdition(page), 'retail');
  assert.equal(await page.eval(`document.querySelector('[data-edition="forever"]').getAttribute('aria-pressed')`), 'false');
  assert.equal(await page.eval(`document.querySelector('.edition').getAttribute('role') + ' ' + document.querySelector('.edition').getAttribute('aria-label')`), 'group Game version');
  assert.match(await text(page, '#summary [data-reset="daily"] .value'), /^in \d/);
  assert.ok((await cardNames(page)).length > 0, 'Retail events are shown');
  await click(page, '[data-quick="starred"]'); // a Retail change: only Retail's own keys are written
  assert.deepEqual(Object.keys(await stored(page)), ['wowtracker:v1:prefs'], 'no edition choice and no Forever key');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('storage isolation: switching to Forever and back, five times, leaves every Retail key byte for byte as it was; Forever keeps its own choices under its own keys, across reloads', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: RETAIL_PREFS, reminders: { on: true, lead: 30, notify: false, hourly: false }, checklist: { ...TASKS, done: { 'eu:weekly:2026-11-04T04:00Z': ['vault'] } } });
  const before = await stored(page);
  assert.deepEqual(Object.keys(before), ['wowtracker:v1:checklist', 'wowtracker:v1:prefs', 'wowtracker:v1:reminders']);
  await switchTo(page, 'forever');
  assert.equal(await pressedEdition(page), 'forever');
  assert.equal(await text(page, '#summary [data-reset="daily"] .value'), 'Not published');
  // Forever's own choices: a category, the Starred filter, the checklist panel.
  await click(page, '.chip[data-cat="holiday"]');
  await click(page, '[data-quick="starred"]');
  await click(page, '[data-quick="starred"]'); // Starred on and off again: Forever's filter written as "all"
  await click(page, '#cl-toggle');
  const forever = JSON.parse((await stored(page))['wowtracker:v1:forever:prefs']);
  assert.deepEqual(forever, { filter: 'all', categories: ['darkmoon', 'outdoor', 'minor'], starred: [], hidden: [], checklistOpen: true });
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await pressedEdition(page), 'forever', 'remembered across a reload');
  assert.equal(await page.eval(`document.querySelector('.chip[data-cat="holiday"]').getAttribute('aria-pressed')`), 'false', 'Forever settings survive a reload');
  for (let i = 0; i < 5; i++) { await switchTo(page, 'retail'); await switchTo(page, 'forever'); }
  await switchTo(page, 'retail');
  const after = await stored(page);
  for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} is unchanged`);
  assert.deepEqual(Object.keys(after), ['wowtracker:v1:checklist', 'wowtracker:v1:edition', 'wowtracker:v1:forever:prefs', 'wowtracker:v1:prefs', 'wowtracker:v1:reminders'], 'the only new keys are the choice and Forever\'s own');
  assert.equal(after['wowtracker:v1:edition'], '"retail"');
  assert.equal(after['wowtracker:v1:forever:prefs'], (await stored(page))['wowtracker:v1:forever:prefs']);
  // Retail as it was: Europe, the Starred view, two stars, one hidden, the checklist open with its tick.
  assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await page.eval(`document.querySelector('[data-quick="starred"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await text(page, '#checklist-count'), '0 of 1 today · 1 of 1 this week');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('shared settings follow the reader between editions: region, theme, times and news set in Forever are what Retail shows, without touching Retail\'s own choices', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), prefs: RETAIL_PREFS });
  const retailOwn = (p) => Object.fromEntries(['filter', 'categories', 'starred', 'hidden', 'checklistOpen'].map((k) => [k, p[k]]));
  const seeded = JSON.parse((await stored(page))['wowtracker:v1:prefs']);
  await switchTo(page, 'forever');
  assert.equal(await page.eval(`document.documentElement.dataset.theme`), 'light', 'the theme came along');
  assert.equal(await page.eval(`document.querySelector('[data-region="eu"]').getAttribute('aria-pressed')`), 'true', 'so did the region');
  await click(page, '[data-region="us"]');
  await click(page, '#theme-btn'); // light to system
  await page.eval(`(() => { const s = document.getElementById('time-mode'); s.value = 'utc'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click(page, '#news-toggle');
  const prefs = JSON.parse((await stored(page))['wowtracker:v1:prefs']);
  assert.deepEqual([prefs.region, prefs.theme, prefs.timeMode, prefs.newsCollapsed], ['us', 'system', 'utc', true]);
  assert.deepEqual(retailOwn(prefs), retailOwn(seeded), 'Retail\'s own fields untouched');
  await switchTo(page, 'retail');
  assert.equal(await page.eval(`document.querySelector('[data-region="us"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await page.eval(`document.getElementById('time-mode').value`), 'utc');
  assert.equal(await page.eval(`document.getElementById('news').classList.contains('is-collapsed')`), true);
  assert.equal(await page.eval(`document.querySelector('[data-quick="starred"]').getAttribute('aria-pressed')`), 'true', 'Retail\'s Starred view is still on');
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('a "#forever" link shows Forever without saving it; the skip link and unknown links change nothing; following a link to another edition in an open tab switches', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever` });
  assert.equal(await pressedEdition(page), 'forever');
  assert.equal((await stored(page))['wowtracker:v1:edition'], undefined, 'a link is not a saved choice');
  await page.goto(BASE);
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await pressedEdition(page), 'retail', 'without the link: the default');
  await page.goto(`${BASE}#classic`);
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.equal(await pressedEdition(page), 'retail', 'an edition this page does not have');
  await click(page, '.skip');
  await sleep(300);
  assert.equal(await pressedEdition(page), 'retail', 'the skip link is not an edition');
  await page.eval(`location.hash = 'forever'`);
  await page.waitFor(`document.querySelector('[data-edition="forever"][aria-pressed="true"]') !== null && document.querySelector('#summary li') !== null`, 10000);
  assert.equal((await stored(page))['wowtracker:v1:edition'], undefined);
  // The toggle saves the choice: Retail from a "#forever" address drops the hash and stays Retail after a reload.
  await switchTo(page, 'retail');
  assert.equal(await page.eval('location.hash'), '');
  assert.equal((await stored(page))['wowtracker:v1:edition'], '"retail"');
  await page.close();
});

check('Forever without published resets: no reset countdown anywhere, calendar weeks in the overview, and the checklist off with its reason, so nothing can clear at a guessed time', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever`, prefs: { checklistOpen: true }, checklist: TASKS });
  const resetsShown = await page.eval(`[...document.querySelectorAll('#summary .reset')].map((li) => li.getAttribute('data-reset') + ': ' + li.querySelector('.value').textContent + (li.querySelector('[data-until]') ? ' (counting)' : ''))`);
  assert.deepEqual(resetsShown, ['daily: Not published', 'weekly: Not published'], 'no Trading Post, no countdown');
  assert.match(await text(page, '#region-line'), /reset times of World of Warcraft: Forever are not published, so this page does not count down to them/);
  assert.match(await text(page, '#week-hint'), /calendar weeks, Monday to Monday in your time \(the weekly reset is not published\)/);
  assert.deepEqual(await texts(page, '#week-grid .week-col h3'), ['This week Mon, Nov 9 to Mon, Nov 16', 'Next week Mon, Nov 16 to Mon, Nov 23']);
  await click(page, '[data-region="eu"]');
  assert.equal(await text(page, '#checklist-count'), 'Off: resets not published');
  assert.match(await text(page, '#checklist-note'), /has not published its reset times for the Europe region, so the checklist is off here rather than clearing at a guessed time/);
  assert.equal(await page.eval(`document.querySelectorAll('#checklist [data-task], #checklist .cl-task').length`), 0, 'no task to tick');
  assert.deepEqual(await page.eval(`[document.querySelector('#checklist .checklist-add').hidden, document.getElementById('cl-suggest').hidden, document.getElementById('cl-edit').hidden]`), [true, true, true]);
  // Retail's checklist (seeded under Retail's key) is untouched by the Forever page.
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:checklist')`), JSON.stringify(TASKS));
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:forever:checklist')`), null);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Forever at 390, 360 and 768 px: nothing scrolls sideways, every control can be reached, and the game version toggle sits beside the title', async () => {
  for (const [w, mobile] of [[390, true], [360, true], [768, false]]) {
    const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever`, width: w, height: 800, mobile, prefs: { checklistOpen: true } });
    await click(page, '#filters-toggle');
    const wide = await page.eval(`[...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > ${w} + 1 || r.left < -1); }).map((e) => e.tagName + '.' + e.className).slice(0, 5)`);
    assert.deepEqual(wide, [], `${w} px`);
    assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, `${w} px: no horizontal scroll`);
    const small = await page.eval(`[...document.querySelectorAll('button, select, a.btn, input')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < (e.type === 'checkbox' ? 18 : 28)).map((e) => e.textContent || e.id || e.type)`);
    assert.deepEqual(small, [], `${w} px`);
    const rows = await page.eval(`(() => { const t = document.querySelector('.brand h1').getBoundingClientRect(), g = document.querySelector('.edition').getBoundingClientRect(); return [Math.round(t.top + t.height / 2), Math.round(g.top + g.height / 2)]; })()`);
    assert.ok(Math.abs(rows[0] - rows[1]) <= 6, `${w} px: the toggle is on the title row (${rows})`);
    assert.deepEqual(page.problems, []);
    await page.close();
  }
});

// ---- Forever's events (the game's calendar data, on each region's server clock) ----

const FOREVER = require(join(DIR, 'forever-data.js'));
const RETAIL_ONLY = ['Timewalking', 'Trading Post', "Pilgrim's Bounty", "Lu'ashal", 'Curse Surge', 'Aqir Invasion', 'Day of the Dead', 'Bonus Event'];
/** The details dialog as label: value lines. */
const detailRows = (page) => page.eval(`[...document.querySelectorAll('#details .details-list dt')].map((dt) => dt.textContent + ': ' + dt.nextElementSibling.textContent)`);

check('Forever shows its own events: the Darkmoon Faire on now, the fishing contest coming up and next, each "Predicted time", a year of calendar, and not one Retail event', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever`, prefs: { aheadHours: 168 } });
  assert.deepEqual(await cardNames(page), ['Darkmoon Faire: Elwynn Forest']);
  assert.deepEqual(await texts(page, '#now-list .event .badge'), ['Darkmoon Faire', 'Predicted time']);
  assert.equal(await text(page, '#now-list .event .where'), 'Elwynn Forest, or at the foot of Thunder Bluff (it alternates)');
  assert.deepEqual(await rowNames(page), ['Stranglethorn Fishing Extravaganza']);
  assert.match(await text(page, '#next-list .row .line2'), /^The coasts of Stranglethorn Vale · 120 min$/);
  assert.match(await text(page, '#summary .next'), /^Next eventStranglethorn Fishing Extravaganza Predicted timein 5d \d+h · Sun, Nov 15, 2:00 PM/);
  // The fishing contest on Sunday 14:00 server time is 14:00 here (US Central), not 16:00 as a Pacific reading would put it.
  assert.equal(await page.eval(`Number(document.querySelector('#next-list .row').dataset.start)`), utc('2026-11-15T20:00:00Z'));
  assert.equal(await text(page, '#calendar-hint'), 'through Nov 7, 2027');
  const months = await texts(page, '#calendar .month h3');
  assert.equal(months.length, 13, months.join(', '));
  assert.match(months[months.length - 1], /^November 2027/);
  assert.match(await text(page, '#calendar'), /Midsummer Fire Festival[\s\S]*Fireworks Spectacular[\s\S]*Harvest Festival[\s\S]*Hallow's End[\s\S]*Nothing after Nov 7, 2027 is in the data yet\.$/);
  const body = await page.eval('document.body.innerText');
  for (const n of RETAIL_ONLY) assert.ok(!body.includes(n), `no Retail event: ${n}`);
  assert.match(await text(page, '#untracked'), /^Not shown as times, because no verified schedule exists: Daily and weekly resets \(.+\); Call to Arms battleground weeks \(.+\); Noblegarden \(the game's calendar data starts it on March 29, 2027 at 10:00 server time but gives no end\); Raids opening \(Blizzard says Barrow Deeps, Hyjal Summit and Onyxia's Lair open on December 9, 2026, without a time\)/);
  // Europe: the same server times on the Central European clock, and no July 4 fireworks (an Americas row).
  await click(page, '[data-region="eu"]');
  assert.equal(await page.eval(`Number(document.querySelector('#next-list .row').dataset.start)`), utc('2026-11-15T13:00:00Z'));
  assert.ok(!(await text(page, '#calendar')).includes('Fireworks Spectacular'));
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Forever details say what the game\'s data says and no more: when, how long, both regions, where, how it repeats, why the time is predicted, how far the data goes, sources and check date', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever` });
  await click(page, '#now-list [data-details="darkmoon-faire"]');
  assert.equal(await text(page, '#details-title'), 'Darkmoon Faire: Elwynn Forest');
  const rows = await detailRows(page);
  const row = (label) => rows.find((r) => r.startsWith(`${label}: `)) || '';
  assert.deepEqual(rows.map((r) => r.split(': ')[0]), ['When', 'How long', 'Region', 'Europe', 'Where', 'Repeats', 'Later', 'How sure', 'Data', 'Sources']);
  assert.match(row('When'), /^When: On now, ends Mon, Nov 16, 4:00 AM · ends in 5d \d+h/);
  assert.equal(row('How long'), 'How long: 7 days');
  assert.equal(row('Region'), 'Region: Americas (Americas and Oceania)');
  assert.match(row('Europe'), /^Europe: On now, ends Sun, Nov 15, 9:00 PM \(Predicted time\)$/);
  assert.equal(row('Where'), 'Where: Elwynn Forest, or at the foot of Thunder Bluff (it alternates)');
  assert.equal(row('Repeats'), "Repeats: About once a month, on dates set in the game's calendar data: from a Monday at 04:00 server time, for 7 days. The place alternates between Elwynn Forest and Thunder Bluff.");
  assert.match(row('Later'), /^Later: Darkmoon Faire: Thunder Bluff: Dec 7 - Dec 14 \(starts Mon, Dec 7, 4:00 AM\)Jan 4 - Jan 11 \(starts Mon, Jan 4, 4:00 AM\)Darkmoon Faire: Thunder Bluff: Feb 8 - Feb 15 \(starts Mon, Feb 8, 4:00 AM\)$/);
  assert.match(row('How sure'), /^How sure: Predicted time\. The dates are confirmed; the start time in this region is not\. The dates and hours are the game's own calendar data, which gives them in server time\. The Americas server clock is read as US Central time: players say so, and it has been seen twice, both in standard time: .+ Blizzard has not said\. Whether these servers change their clocks for daylight saving time has not been seen yet; times from March 14, 2027 assume they do\.$/);
  assert.equal(row('Data'), "Data: Known through Nov 7, 2027. After that: not known yet (only one year of the game's calendar data, from build 1.60.1.70862, is read so far).");
  assert.equal(row('Sources'), 'Sources: Game calendar data (1.60.1.70862) (opens a new tab) · game dataGame calendar text (1.60.1.70862) (opens a new tab) · game dataChecked Nov 8, 2026.');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#details-body .details-sources a')].map((a) => a.href)`), ['https://wago.tools/db2/Holidays?build=1.60.1.70862', 'https://wago.tools/db2/HolidayDescriptions?build=1.60.1.70862']);
  await page.eval(`document.getElementById('details').close()`);
  // A place no source names says so, in the details and on the calendar card's line.
  await typeSearch(page, 'midsummer');
  await click(page, '#calendar [data-details="midsummer-fire-festival"]');
  assert.ok((await detailRows(page)).includes('Where: Not stated in its sources'));
  await page.eval(`document.getElementById('details').close()`);
  // The July 4 fireworks are an Americas row: its details have no Europe line.
  await typeSearch(page, 'fireworks');
  await click(page, '#calendar [data-details="fireworks-spectacular"]');
  const fw = await detailRows(page);
  assert.ok(fw.includes('Repeats: Every year on July 4 from 06:00 server time, for 18 hours, on Americas realms only.') && !fw.some((r) => r.startsWith('Europe: ')), fw.join(' | '));
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('search in Forever finds its events by name, alias, place and Faire location, and nothing from Retail', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever` });
  const found = async (q) => { await typeSearch(page, q); return [...new Set(await texts(page, '#calendar .agenda .name'))]; };
  assert.deepEqual(await found('stv fishing'), ['Stranglethorn Fishing Extravaganza']);
  assert.deepEqual(await found('stranglethorn'), ['Stranglethorn Fishing Extravaganza']);
  // A place finds the event, so every Faire shows, in date order (Elwynn Forest is on now).
  assert.deepEqual(await found('thunder bluff'), ['Darkmoon Faire: Elwynn Forest', 'Darkmoon Faire: Thunder Bluff']);
  assert.deepEqual(await found('dmf'), ['Darkmoon Faire: Elwynn Forest', 'Darkmoon Faire: Thunder Bluff']);
  assert.deepEqual(await found('winterveil'), ['Feast of Winter Veil']);
  assert.deepEqual(await found('booty bay'), ['Fireworks Spectacular']);
  await typeSearch(page, 'timewalking');
  assert.match(await text(page, '#calendar'), /Nothing on the calendar matches your search\./);
  assert.match(await text(page, '#search-status'), /^No event you follow matches "timewalking"\.$/);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Forever\'s calendar export holds only Forever\'s windows, as the engine has them, each "(Predicted time)", with the place when one is known', async () => {
  const at = utc('2026-11-10T18:00:00Z');
  const page = await open({ at, url: `${BASE}#forever` });
  await click(page, '#export-btn');
  await page.eval(`(() => { const r = document.querySelector('input[name="export-range"][value="all"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.match(await text(page, '#export-all-label'), /^Everything known, through Nov 7, 2027 \(\d+\)$/);
  const file = await saved(page, () => click(page, '#export-go'));
  const expected = FOREVER.events.flatMap((e) => (e.schedules.us ? Engine.windows(e.schedules.us, at, Date.parse('2027-11-07T23:59:59Z')).map((w) => `${Ics.stamp(w.start)} ${Ics.stamp(w.end)} ${w.name || e.name} (Predicted time)`) : [])).sort();
  const got = icsEvents(file.text);
  assert.deepEqual(got.map((x) => `${x.DTSTART} ${x.DTEND} ${x.SUMMARY}`).sort(), expected);
  assert.equal(got.length, 71); // 52 Sundays, 12 Faires (the one on now included), 7 holidays and small events
  assert.ok(got.every((x) => x.STATUS === 'TENTATIVE' && /^Predicted time: the dates are confirmed\\; the start time on Americas and Oceania is not\./.test(x.DESCRIPTION)));
  assert.equal(got.find((x) => x.SUMMARY.startsWith('Midsummer')).LOCATION, 'World of Warcraft');
  assert.equal(got.find((x) => x.SUMMARY.startsWith('Stranglethorn')).LOCATION, 'World of Warcraft: The coasts of Stranglethorn Vale');
  assert.ok(!got.some((x) => RETAIL_ONLY.some((n) => x.SUMMARY.includes(n))));
  await page.close();
});

check('Forever\'s coverage stays in sight: on November 6, 2027 the last contest is the last thing coming, then "Not known yet", never "nothing"', async () => {
  const page = await open({ at: utc('2027-11-06T12:00:00Z'), url: `${BASE}#forever`, prefs: { aheadHours: 168 } });
  assert.deepEqual(await rowNames(page), ['Stranglethorn Fishing Extravaganza']);
  assert.match(await text(page, '#next-gap'), /^Not known yet from Sun, Nov 7, 6:00 PM: Holidays, Darkmoon Faire, Outdoor events, Small events\.$/);
  assert.match(await text(page, '#week-grid'), /Not known yet/);
  assert.doesNotMatch(await page.eval('document.body.innerText'), /Nothing you follow is scheduled/);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Latest news says "All versions" in both editions, and shows the same headlines in each', async () => {
  const lists = [];
  for (const url of [BASE, `${BASE}#forever`]) {
    const page = await open({ at: utc('2026-11-10T18:00:00Z'), url });
    await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`, 8000);
    assert.equal(await text(page, '#news-scope'), 'All versions');
    assert.equal(await page.eval(`document.getElementById('news').getAttribute('aria-labelledby')`), 'news-title news-scope');
    assert.equal(await text(page, '#news-title'), 'Latest news');
    lists.push(await texts(page, '#news-list li a'));
    assert.deepEqual(page.problems, []);
    await page.close();
  }
  assert.deepEqual(lists[1], lists[0]);
});

// Font widths differ by system: v0.3.0 passed here on Windows and failed on Linux, where the head wrapped at
// 360 px. So the same checks run with the page's own fonts and with two wider sets: Arial and Georgia (about
// Android's Roboto and Noto Serif) and Verdana and Georgia (about Linux's DejaVu, the widest common fonts),
// each falling back to its Linux equivalent where it is not installed, at every phone width from 320 to 430 px.
check('the "All versions" label never moves the news when the headlines arrive: the news head is as tall with "Show all" as without, and Collapse stays on the title\'s line, from 320 to 1280 px with the page\'s fonts and with wider ones', async () => {
  const SETS = [['page fonts', null], ['Arial + Georgia', ['Arial, "Liberation Sans", sans-serif', 'Georgia, "DejaVu Serif", serif']], ['Verdana + Georgia', ['Verdana, "DejaVu Sans", sans-serif', 'Georgia, "DejaVu Serif", serif']]];
  let measured = 0;
  for (const [fontsLabel, fonts] of SETS) {
    // Set through the style API, which the page's Content-Security-Policy allows (a <style> element it refuses).
    const before = fonts ? `document.addEventListener('readystatechange', () => { const r = document.documentElement; r.style.setProperty('--sans', ${JSON.stringify(fonts[0])}); r.style.setProperty('--serif', ${JSON.stringify(fonts[1])}); }, { once: true });` : null;
    const page = await open({ at: utc('2026-11-10T18:00:00Z'), width: 360, height: 800, mobile: true, before });
    await page.waitFor(`document.querySelectorAll('#news-list li a').length === 3`, 8000);
    if (fonts) assert.match(await page.eval(`getComputedStyle(document.getElementById('news-toggle')).fontFamily`), /^Arial|^Verdana/, `${fontsLabel} applied`);
    for (const w of [320, 340, 360, 375, 390, 400, 412, 414, 419, 420, 430, 768, 1280]) {
      await page.viewport(w, 800, w < 600);
      await sleep(60);
      const r = JSON.parse(await page.eval(`(() => { const b = document.getElementById('news-all'), head = document.querySelector('.news-head'); const heights = [];
        for (const hide of [true, false]) { b.hidden = hide; heights.push(Math.round(head.getBoundingClientRect().height)); }
        const box = (id) => document.getElementById(id).getBoundingClientRect(), mid = (id) => (box(id).top + box(id).bottom) / 2;
        const label = Math.abs(mid('news-title') - mid('news-scope')) < 8;
        // Room left on the title's line with Show all shown: from the label (or the title) to the buttons, less the 10 px gap.
        const room = Math.round(document.querySelector('.news-tools').getBoundingClientRect().left - (label ? box('news-scope') : box('news-title')).right - 10);
        return JSON.stringify({ heights, collapse: Math.abs(mid('news-title') - mid('news-toggle')) < 8, label, room, sw: document.documentElement.scrollWidth, iw: innerWidth }); })()`));
      const at = `${fontsLabel}, ${w} px`;
      assert.equal(r.heights[0], r.heights[1], `${at}: the head is ${r.heights[0]} px without "Show all" and ${r.heights[1]} px with it`);
      assert.equal(r.collapse, true, `${at}: Collapse stays on the title's line`);
      assert.equal(r.label, w >= 420, `${at}: the label ${w >= 420 ? 'shares the title\'s line' : 'has its own line'}`);
      // Where the label shares the line, it is small enough to leave room for fonts a little wider than these.
      if (r.label) assert.ok(r.room >= 8, `${at}: ${r.room} px to spare beside the label (at least 8)`);
      assert.ok(r.sw <= r.iw, `${at}: nothing scrolls sideways`);
      measured++;
    }
    assert.deepEqual(page.problems, []);
    await page.close();
  }
  assert.equal(measured, 39);
});

check('About in Forever names the game and its server clocks, and says every time is a Predicted time; Retail\'s About is as it was', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever` });
  assert.equal(await text(page, '#about-intro'), 'A World of Warcraft: Forever dashboard for scheduled events: what is in its scheduled window now and what starts next, in your local time. Its daily and weekly reset times are not published, so this page does not count down to them.');
  assert.equal(await text(page, '#about-data'), "Schedule data r2, reviewed Nov 9, 2026 for patch 1.60.1 (game build 1.60.1.70862), covering dates through Nov 7, 2027. 9 events, on the dates and hours of the game's own calendar data, which gives them in server time. This page reads that as US Central time (Americas) and Central European time (Europe), from what players have seen; Blizzard has not said, so every time here is a Predicted time. Each event says why, names its source and the date it was last checked.");
  await page.goto(BASE);
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.match(await text(page, '#about-intro'), /^A World of Warcraft \(Retail\) dashboard for resets and scheduled events: /);
  await page.close();
});

// ---- Editions kept apart: reminders, calendar files and backups (v0.3 Phase 3) ----

// The Lunar Festival starts at 09:00 UTC on February 2, 2027 in Europe in both editions: the same event id,
// region and moment, so anything keyed without the edition would collide here.
const LUNAR = utc('2027-02-02T09:00:00Z');
const LUNAR_PREFS = { region: 'eu', starred: ['lunar-festival'] };
const seedForever = (own) => `if (!sessionStorage.getItem('f-seeded')) { localStorage.setItem('wowtracker:v1:forever:prefs', ${JSON.stringify(JSON.stringify(own))}); sessionStorage.setItem('f-seeded', '1'); }`;
const attrOf = (page, sel, a) => page.eval(`document.querySelector(${JSON.stringify(sel)}).getAttribute(${JSON.stringify(a)})`);
const records = (page) => page.eval(`JSON.stringify(['reminded', 'forever:reminded'].map((k) => Object.keys(JSON.parse(localStorage.getItem('wowtracker:v1:' + k) || '{}'))))`).then(JSON.parse);

check('reminders in a Retail tab and a Forever tab side by side: the same event at the same moment is two reminders, each shown once in its own tab and never in a second one; each edition keeps its own record', async () => {
  const at = LUNAR - 10 * 60000;
  const retail = await open({ at, prefs: LUNAR_PREFS, reminders: REM_ON, before: seedForever({ starred: ['lunar-festival'] }) });
  await retail.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 8000);
  const forever = await open({ at, url: `${BASE}#forever`, keepStorage: true });
  await forever.waitFor(`document.querySelectorAll('#reminders-tray .reminder').length === 1`, 8000);
  for (const p of [retail, forever]) assert.match((await trayText(p))[0], /^Lunar Festival \(Predicted time\) starts in \d+m/);
  const second = await open({ at, url: `${BASE}#forever`, keepStorage: true });
  const third = await open({ at, keepStorage: true });
  await sleep(2500);
  assert.deepEqual([(await trayText(second)).length, (await trayText(third)).length], [0, 0], 'a second tab of either edition: already delivered');
  assert.deepEqual(await records(second), [[`eu|lunar-festival|${LUNAR}|15`], [`forever|eu|lunar-festival|${LUNAR}|15`]], "Retail's record as in v0.2; Forever's under its own key, named");
  // Each dialog says which game version its reminders come from.
  await click(retail, '#reminders-btn');
  assert.equal(await text(retail, '#rem-edition'), 'Only for Retail, the game version on screen. Starred Forever events remind you while it is on screen.');
  await click(forever, '#reminders-btn');
  assert.equal(await text(forever, '#rem-edition'), 'Only for Forever, the game version on screen. Starred Retail events remind you while it is on screen.');
  assert.equal(await text(forever, '#rem-starred'), '1 starred event in Europe.');
  // Retail's hourly events (Aqir Invasion, Curse Surge) are not Forever's: the choice is not offered there.
  assert.deepEqual([await retail.eval(`document.getElementById('rem-hourly').closest('label').offsetParent !== null`), await forever.eval(`document.getElementById('rem-hourly').closest('label').offsetParent !== null`)], [true, false]);
  for (const p of [retail, forever, second, third]) { assert.deepEqual(p.problems, []); await p.close(); }
});

check('switching editions never carries a reminder across: each edition notifies once, with its own name and Predicted time; after five round trips and a reload neither comes back', async () => {
  const at = LUNAR - 10 * 60000;
  const page = await open({ at, prefs: LUNAR_PREFS, reminders: { ...REM_ON, notify: true }, before: `${seedForever({ starred: ['lunar-festival'] })};${FAKE_NOTIFICATIONS('granted')};window.Notification.requestPermission();` });
  const shown = async () => { await sleep(1500); return [(await trayText(page)).length, await page.eval('window.__notes.length')]; };
  await page.waitFor(`window.__notes.length === 1`, 8000);
  const r = await page.eval('window.__notes[0]');
  assert.match(r.t, /^Lunar Festival \(Predicted time\) starts in /);
  assert.match(r.o.body, /\. The start time is a prediction\. Europe\. WoW Tracker$/, "Retail's text as in v0.2");
  assert.equal(r.o.tag, `eu|lunar-festival|${LUNAR}|15`);
  await switchTo(page, 'forever');
  await page.waitFor(`window.__notes.length === 1`, 8000);
  const f = await page.eval('window.__notes[0]');
  assert.match(f.t, /^Lunar Festival \(Predicted time\) starts in /);
  assert.match(f.o.body, /\. The start time is a prediction\. Europe, WoW: Forever\. WoW Tracker$/);
  assert.equal(f.o.tag, `forever|eu|lunar-festival|${LUNAR}|15`);
  assert.deepEqual(await shown(), [1, 1], 'Forever shows its own, not Retail\'s');
  for (let i = 0; i < 5; i++) {
    await switchTo(page, 'retail');
    assert.deepEqual(await shown(), [0, 0], `round trip ${i + 1}: Retail's was delivered already`);
    await switchTo(page, 'forever');
    assert.deepEqual(await shown(), [0, 0], `round trip ${i + 1}: so was Forever's`);
  }
  await page.reload();
  await page.waitFor("document.querySelector('#summary li') !== null");
  assert.deepEqual(await shown(), [0, 0]);
  assert.deepEqual(await records(page), [[`eu|lunar-festival|${LUNAR}|15`], [`forever|eu|lunar-festival|${LUNAR}|15`]]);
  assert.deepEqual(page.problems, []);
  await page.close();
});

/** A calendar file checked by the independent reader in tests/ics.mjs (CRLF, 75 octets) and for the parts every entry needs. */
function checkedIcs(text) {
  const evs = icsEvents(text);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:') && text.endsWith('END:VCALENDAR\r\n'));
  for (const e of evs) {
    for (const k of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY']) assert.ok(e[k], `${k} in ${e.SUMMARY}`);
    assert.match(e.DTSTART, /^\d{8}T\d{6}Z$/);
    assert.ok(e.DTEND > e.DTSTART, e.SUMMARY);
  }
  return evs;
}
const unescapeIcs = (v) => v.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
const calName = (text) => (text.match(/\r\nX-WR-CALNAME:([^\r]*)\r\n/) || [])[1];

check('calendar files never mix editions: Forever\'s file names, calendar name and every UID name the edition, Retail\'s are as in v0.2; the two files share no entry; both pass the calendar checker', async () => {
  const at = utc('2026-11-10T18:00:00Z');
  const exportAll = async (page) => {
    await click(page, '#export-btn');
    await page.eval(`(() => { const r = document.querySelector('input[name="export-range"][value="all"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const predictedChoice = await page.eval(`document.getElementById('export-predicted').closest('label').checkVisibility()`);
    return { ...(await saved(page, () => click(page, '#export-go'))), predictedChoice };
  };
  const retail = await open({ at });
  const rf = await exportAll(retail);
  const forever = await open({ at, url: `${BASE}#forever` });
  const ff = await exportAll(forever);
  assert.deepEqual([rf.name, ff.name], ['wowtracker-americas-2026-11-10.ics', 'wowtracker-forever-americas-2026-11-10.ics']);
  // Retail keeps its choice to leave predicted events out; Forever, where every time is "Predicted time", is not offered one.
  assert.deepEqual([rf.predictedChoice, ff.predictedChoice], [true, false], 'the predicted events choice shows in Retail only');
  assert.deepEqual([calName(rf.text), calName(ff.text)], ['WoW Tracker (Americas)', 'WoW Tracker\\, WoW: Forever (Americas)']);
  const R = checkedIcs(rf.text), F = checkedIcs(ff.text);
  const RETAIL_DATA = require(join(DIR, 'events-data.js'));
  const uidsOf = (data, edition) => new Set(data.events.flatMap((e) => (e.schedules.us ? Engine.windows(e.schedules.us, at, utc('2027-12-31T00:00:00Z')).map((w) => Ics.eventUid(e.id, 'us', w.start, edition)) : [])));
  const retailUids = uidsOf(RETAIL_DATA), foreverUids = uidsOf(FOREVER, 'forever');
  assert.ok(R.every((x) => retailUids.has(x.UID)), 'every Retail UID is v0.2\'s formula');
  assert.ok(F.every((x) => foreverUids.has(x.UID)), 'every Forever UID names the edition');
  assert.ok(F.length > 50 && F.every((x) => x.SUMMARY.endsWith(' (Predicted time)') && x.STATUS === 'TENTATIVE'), 'every Forever entry keeps its Predicted time warning');
  assert.ok(R.some((x) => x.UID === '35f65e968686e357@radmagelabs.com'), 'the Retail Darkmoon Faire of December 6 keeps its v0.2.0 UID');
  assert.equal(F.filter((x) => R.some((y) => y.UID === x.UID)).length, 0, 'no entry in both files');
  assert.ok(!F.some((x) => RETAIL_ONLY.some((n) => x.SUMMARY.includes(n))) && !R.some((x) => x.SUMMARY.startsWith('Stranglethorn')));
  // Retail's text is as it was; Forever's adds its server time, how it repeats and how far the data goes.
  const rd = unescapeIcs(R.find((x) => x.SUMMARY === 'Darkmoon Faire').DESCRIPTION);
  assert.match(rd, /\nA scheduled time from WoW Tracker schedule data r2, checked 2026-11-08\. It is not read from the game/);
  assert.match(rd, /\nWoW Tracker: https:\/\/radmagelabs\.com\/wow\/$/);
  assert.doesNotMatch(rd, /Server time|Repeats|Known through/);
  const fish = F.find((x) => x.SUMMARY === 'Stranglethorn Fishing Extravaganza (Predicted time)');
  assert.deepEqual(unescapeIcs(fish.DESCRIPTION).split('\n'), [
    `Predicted time: the dates are confirmed; the start time on Americas and Oceania is not. ${FOREVER.events[1].schedules.us.basis}`,
    'Region: Americas (Americas and Oceania).',
    'Server time: Sunday 14:00, read as US Central time (predicted).',
    'Repeats: Every Sunday, 14:00 to 16:00 server time.',
    "Known through Nov 7, 2027. After that: not known yet (only one year of the game's calendar data, from build 1.60.1.70862, is read so far).",
    "A scheduled time from WoW Tracker's World of Warcraft: Forever schedule data r2, checked 2026-11-08. It is not read from the game; a realm can open early or late around maintenance.",
    'Sources: Game calendar data (1.60.1.70862) https://wago.tools/db2/Holidays?build=1.60.1.70862 ; Game calendar text (1.60.1.70862) https://wago.tools/db2/HolidayDescriptions?build=1.60.1.70862 ; Icy Veins https://www.icy-veins.com/wow-forever/fishing',
    'WoW Tracker: https://radmagelabs.com/wow/#forever']);
  // Things the data does not time (Noblegarden without an end, Call to Arms, the raids) are never in a file.
  assert.ok(!F.some((x) => /Noblegarden|Call to Arms|Raid/.test(x.SUMMARY)));
  // One occurrence from the details, in each region.
  await retail.close();
  await click(forever, '#now-list [data-details="darkmoon-faire"]');
  const one = await saved(forever, () => click(forever, '#details [data-ics]'));
  assert.equal(one.name, 'wowtracker-forever-darkmoon-faire-2026-11-09.ics');
  const [dmf] = checkedIcs(one.text);
  assert.deepEqual([dmf.UID, dmf.SUMMARY, dmf.DTSTART, dmf.DTEND, dmf.STATUS, unescapeIcs(dmf.LOCATION)], [Ics.eventUid('darkmoon-faire', 'us', utc('2026-11-09T10:00:00Z'), 'forever'), 'Darkmoon Faire: Elwynn Forest (Predicted time)', '20261109T100000Z', '20261116T100000Z', 'TENTATIVE', 'World of Warcraft: Elwynn Forest, or at the foot of Thunder Bluff (it alternates)']);
  assert.match(unescapeIcs(dmf.DESCRIPTION), /\nServer time: Monday 04:00, read as US Central time \(predicted\)\.\n/);
  assert.equal(calName(one.text), 'WoW Tracker\\, WoW: Forever (Americas)');
  await forever.eval(`document.getElementById('details').close()`);
  await click(forever, '[data-region="eu"]');
  await click(forever, '#next-list [data-details="stranglethorn-fishing-extravaganza"]');
  const eu = await saved(forever, () => click(forever, '#details [data-ics]'));
  const [f2] = checkedIcs(eu.text);
  assert.deepEqual([eu.name, f2.UID, f2.DTSTART], ['wowtracker-forever-stranglethorn-fishing-extravaganza-2026-11-15.ics', Ics.eventUid('stranglethorn-fishing-extravaganza', 'eu', utc('2026-11-15T13:00:00Z'), 'forever'), '20261115T130000Z']);
  assert.match(unescapeIcs(f2.DESCRIPTION), /\nServer time: Sunday 14:00, read as Central European time \(predicted\)\.\n/);
  assert.equal(calName(eu.text), 'WoW Tracker\\, WoW: Forever (Europe)');
  assert.deepEqual(forever.problems, []);
  await forever.close();
});

const FOREVER_OWN = { starred: ['stranglethorn-fishing-extravaganza', 'darkmoon-faire'], hidden: ['fireworks-spectacular'], categories: ['holiday', 'darkmoon', 'outdoor'], filter: 'all', checklistOpen: false };
const FOREVER_LIST = { tasks: [{ id: 'fff', name: 'Dedicated Study', kind: 'daily' }], done: { 'us:daily:2026-10-01T15:00Z': ['fff'] } };
const seedForeverAll = `if (!sessionStorage.getItem('f-seeded')) { localStorage.setItem('wowtracker:v1:forever:prefs', ${JSON.stringify(JSON.stringify(FOREVER_OWN))}); localStorage.setItem('wowtracker:v1:forever:checklist', ${JSON.stringify(JSON.stringify(FOREVER_LIST))}); sessionStorage.setItem('f-seeded', '1'); }`;

check('a backup made on the Forever page holds Retail and Forever apart; restored in a fresh browser profile from the Retail page, both come back under their own keys after a preview and Replace, and the game version on screen does not change', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever`, prefs: RETAIL_PREFS, reminders: { ...REM_ON, lead: 30 }, checklist: { ...TASKS, done: { 'eu:weekly:2026-11-04T04:00Z': ['vault'] } }, before: seedForeverAll });
  const before = await stored(page);
  await click(page, '#backup-btn');
  assert.equal(await text(page, '#backup-what'), 'This browser now: Europe · reminders 30 min before. Retail: 2 starred · 1 hidden · 2 checklist tasks. Forever: 2 starred · 1 hidden · 1 checklist task.');
  const copy = await page.eval(`document.getElementById('backup-out').value`);
  const raw = JSON.parse(copy);
  assert.deepEqual([raw.format, Object.keys(raw.editions)], [2, ['retail', 'forever']]);
  assert.equal(raw.version, /<span class="tag">v(\d+\.\d+\.\d+) /.exec(readFileSync(join(DIR, 'index.html'), 'utf8'))[1], 'the backup names the version of the page that made it');
  assert.deepEqual(raw.editions.forever, { prefs: { filter: 'all', categories: ['holiday', 'darkmoon', 'outdoor'], starred: FOREVER_OWN.starred, hidden: FOREVER_OWN.hidden, checklistOpen: false }, checklist: FOREVER_LIST }, "Forever's checklist exactly as stored: no reset is known, so no tick expires");
  assert.equal(raw.editions.retail.prefs.starred.join(), RETAIL_PREFS.starred.join());
  assert.equal(raw.shared.prefs.starred, undefined, 'the shared part holds no edition\'s stars');
  await page.close();
  // A fresh browser profile: nothing saved at all.
  const fresh = await launchBrowser();
  try {
    const p2 = await open({ at: utc('2026-11-12T18:00:00Z'), browser: fresh });
    assert.deepEqual(await stored(p2), {});
    await click(p2, '#backup-btn');
    assert.equal(await text(p2, '#backup-what'), 'This browser now: Americas · reminders off. Retail: 0 starred · 0 hidden · no checklist tasks. Forever: nothing saved.');
    await setBackup(p2, copy);
    await click(p2, '#backup-check');
    assert.deepEqual(await texts(p2, '#backup-result .backup-plan li'), [
      'Shared settings: Europe · reminders 30 min before. Changes the region, theme, times, Coming up span, compact view, news choices and reminders.',
      'Retail: 2 starred · 1 hidden · 2 checklist tasks. Replaces 0 starred · 0 hidden · no checklist tasks.',
      'Forever: 2 starred · 1 hidden · 1 checklist task. Replaces nothing saved.']);
    assert.match(await text(p2, '#backup-result'), /The game version on screen stays Retail\./);
    assert.deepEqual(await stored(p2), {}, 'nothing written before Replace');
    await click(p2, '#backup-apply');
    assert.equal(await text(p2, '#backup-result'), 'Restored: the shared settings and reminders, and the stars, hidden events, categories and checklist of Retail and Forever.');
    const after = await stored(p2);
    for (const k of ['wowtracker:v1:prefs', 'wowtracker:v1:reminders', 'wowtracker:v1:forever:prefs', 'wowtracker:v1:forever:checklist']) assert.deepEqual(JSON.parse(after[k]), JSON.parse(before[k]), k);
    assert.deepEqual(JSON.parse(after['wowtracker:v1:checklist']).tasks, TASKS.tasks);
    assert.equal(after['wowtracker:v1:edition'], undefined, 'the game version on screen is not a backed-up setting');
    assert.equal(await pressedEdition(p2), 'retail');
    assert.equal(await attrOf(p2, '[data-region="eu"]', 'aria-pressed'), 'true');
    await switchTo(p2, 'forever');
    assert.deepEqual(await p2.eval(`[...document.querySelectorAll('[data-star][aria-pressed="true"]')].map((b) => b.getAttribute('data-star')).filter((v, i, a) => a.indexOf(v) === i).sort()`), ['darkmoon-faire', 'stranglethorn-fishing-extravaganza']);
    assert.equal(await text(p2, '#hidden-btn'), 'Hidden (1)');
    assert.deepEqual(p2.problems, []);
    await p2.close();
  } finally { await fresh.close(); }
});

check('a v0.2 backup (format 1) restores Retail and the shared settings and leaves Forever exactly as stored, also when restored from the Forever page, which stays on screen', async () => {
  const page = await open({ at: utc('2026-11-10T18:00:00Z'), url: `${BASE}#forever`, prefs: { region: 'us', theme: 'dark' }, before: seedForeverAll });
  const forever = (await stored(page));
  // Exactly what v0.2.0 writes: one edition, prefs whole.
  const v020 = JSON.stringify({ app: 'wowtracker', format: 1, edition: 'retail', version: '0.2.0', saved: '2026-11-01T12:00:00.000Z', prefs: { ...RETAIL_PREFS, starred: ['feast-of-winter-veil', 'gone-from-the-data'] }, reminders: { on: true, lead: 60, notify: false, hourly: false }, checklist: TASKS });
  await click(page, '#backup-btn');
  await setBackup(page, v020);
  await click(page, '#backup-check');
  assert.deepEqual(await texts(page, '#backup-result .backup-plan li'), [
    'Shared settings: Europe · reminders 60 min before. Changes the region, theme, times, Coming up span, compact view, news choices and reminders.',
    "Retail: 1 starred · 1 hidden · 2 checklist tasks. Replaces nothing saved. 1 starred or hidden event is not in this version's schedule data and will be left out.",
    'Forever: not in this backup, so it stays as it is.']);
  assert.match(await text(page, '#backup-result'), /^This backup can be restored\. Made Sun, Nov 1, 6:00 AM with v0\.2\.0\./);
  assert.match(await text(page, '#backup-result'), /The game version on screen stays Forever\./);
  await click(page, '#backup-apply');
  const after = await stored(page);
  for (const k of ['wowtracker:v1:forever:prefs', 'wowtracker:v1:forever:checklist']) assert.equal(after[k], forever[k], `${k} byte for byte`);
  const prefs = JSON.parse(after['wowtracker:v1:prefs']);
  assert.deepEqual([prefs.region, prefs.theme, prefs.starred, prefs.hidden, prefs.filter], ['eu', 'light', ['feast-of-winter-veil'], ['moonkin-festival'], 'starred']);
  assert.deepEqual(JSON.parse(after['wowtracker:v1:checklist']), TASKS);
  assert.equal(await pressedEdition(page), 'forever');
  assert.equal(await attrOf(page, '[data-region="eu"]', 'aria-pressed'), 'true', 'the shared region came along');
  assert.equal(await text(page, '#hidden-btn'), 'Hidden (1)', "Forever's own hidden event is still its own");
  assert.equal(await text(page, '#reminders-btn'), 'Reminders: 60 min');
  // A backup with no Retail part (shared settings and Forever only) leaves Retail's own choices and checklist as they are.
  const retailNow = await stored(page);
  const foreverOnly = JSON.stringify({ app: 'wowtracker', format: 2, version: '0.3.0', saved: '2026-11-09T12:00:00.000Z', shared: { prefs: { region: 'us', theme: 'dark' }, reminders: { on: false, lead: 15 } }, editions: { forever: { prefs: { starred: ['hallows-end'] }, checklist: { tasks: [], done: {} } } } });
  await setBackup(page, foreverOnly);
  await click(page, '#backup-check');
  assert.equal((await texts(page, '#backup-result .backup-plan li'))[1], 'Retail: not in this backup, so it stays as it is.');
  await click(page, '#backup-apply');
  const p3 = JSON.parse((await stored(page))['wowtracker:v1:prefs']);
  assert.deepEqual([p3.region, p3.theme, p3.starred, p3.hidden, p3.filter], ['us', 'dark', ['feast-of-winter-veil'], ['moonkin-festival'], 'starred']);
  assert.equal((await stored(page))['wowtracker:v1:checklist'], retailNow['wowtracker:v1:checklist']);
  assert.deepEqual(JSON.parse((await stored(page))['wowtracker:v1:forever:prefs']).starred, ['hallows-end']);
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('Forever\'s checklist is never cleared by a guessed reset: a month later its ticks are still stored exactly as saved, while the panel says why it is off', async () => {
  const page = await open({ at: utc('2026-12-10T18:00:00Z'), url: `${BASE}#forever`, prefs: { checklistOpen: true, region: 'us' }, before: seedForeverAll });
  await sleep(1500);
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:forever:checklist')`), JSON.stringify(FOREVER_LIST), 'not pruned, not rewritten');
  assert.equal(await text(page, '#checklist-count'), 'Off: resets not published');
  assert.match(await text(page, '#checklist-note'), /has not published its reset times for the Americas region, so the checklist is off here rather than clearing at a guessed time/);
  assert.equal(await text(page, '#summary [data-reset="daily"] .value'), 'Not published');
  // Retail, whose resets are published, still drops ticks from long ago on load (as in v0.2).
  const retail = await open({ at: utc('2026-12-10T18:00:00Z'), keepStorage: true, checklist: { ...TASKS, done: { 'us:weekly:2026-10-06T15:00Z': ['vault'] } } });
  await sleep(1000);
  assert.deepEqual(JSON.parse(await retail.eval(`localStorage.getItem('wowtracker:v1:checklist')`)).done, {});
  assert.equal(await page.eval(`localStorage.getItem('wowtracker:v1:forever:checklist')`), JSON.stringify(FOREVER_LIST));
  await page.close();
  await retail.close();
});

// ---- Loading ----

// Before v0.3.0 the page drew its empty shell first, then the scripts at the end of the body filled it in and
// everything below the resets jumped (a layout shift of about 0.9 on a desktop, 0.76 on a phone on a slow
// network). The scripts now load deferred from the head and app.js holds the first paint until the page is
// filled, so the first thing drawn is the whole page.
check('the page draws once, complete: no layout shift while it loads, in Retail and Forever, on a desktop and on a phone with a slow network', async () => {
  const CLS = `window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });`;
  const SLOW = { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 };
  const seen = [];
  for (const [label, url, width, slow] of [['Retail desktop', BASE, 1280, false], ['Forever desktop', `${BASE}#forever`, 1280, false], ['Retail phone, slow network', BASE, 390, true], ['Forever phone, slow network', `${BASE}#forever`, 390, true]]) {
    const page = await chrome.newPage();
    await page.send('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'all' });
    await page.send('Network.enable', {});
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (slow) await page.send('Network.emulateNetworkConditions', SLOW);
    await page.emulate({ timezone: 'America/Chicago', locale: 'en-US' });
    await page.viewport(width, width < 600 ? 844 : 900, width < 600);
    await page.startClockAt(utc('2026-11-10T18:00:00Z'));
    await page.beforeLoad(CLS);
    await page.goto(url);
    await page.waitFor("document.querySelector('#summary li') !== null", 20000);
    await page.waitFor("document.querySelectorAll('#news-list li a').length === 3", 20000); // the news comes last, when the page is idle
    await sleep(1000);
    const cls = await page.eval('window.__cls');
    seen.push(`${label} ${cls.toFixed(4)}`);
    assert.ok(cls < 0.1, `${label}: layout shift ${cls.toFixed(4)}`);
    assert.deepEqual(page.problems, []);
    await page.close();
  }
  assert.equal(seen.length, 4, seen.join(', '));
});

// ---- Footer ----

check('the footer links go where config.js says, and Share passes the canonical address', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.deepEqual(await texts(page, '#footer-links a, #footer-links button'), ['RadMage Labs', 'GitHub', 'Share', 'Back up settings', 'Feedback', 'Buy me a coffee']);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#footer-links a')].map((a) => a.href)`),
    ['https://radmagelabs.com/', 'https://github.com/RadMageIRL/wowtracker', 'https://github.com/RadMageIRL/wowtracker/issues', 'https://buymeacoffee.com/radmageirl']);
  const ext = await page.eval(`[...document.querySelectorAll('#footer-links a[target]')].map((a) => a.rel)`);
  assert.ok(ext.length === 3 && ext.every((r) => /noopener/.test(r)));
  assert.equal(await page.eval(`document.getElementById('labs-link').href`), 'https://radmagelabs.com/');
  // navigator.share is replaced so the test sees exactly what would be shared.
  await page.eval(`window.__shared = null; navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; navigator.canShare = () => true;`);
  await click(page, '#share-btn');
  await page.waitFor('window.__shared !== null');
  assert.equal(await page.eval('window.__shared.url'), 'https://radmagelabs.com/wow/');
  await page.close();
});

check('About states the data revision and build, and counts confirmed, predicted and predicted-start-time events by region', async () => {
  const page = await open({ at: utc('2026-11-08T20:10:00Z') });
  assert.equal(await text(page, '#about-data'), 'Schedule data r2, reviewed Nov 8, 2026 for patch 12.1.5 (game build 12.1.5.70783), covering dates through Mar 31, 2027. '
    + "30 events: 24 confirmed and 6 predicted. For 17 of the confirmed ones the start time on European realms is predicted, and for 1 the start time on the Americas' realms. Each one names its source and the date it was last checked.");
  assert.match(await text(page, '#revision'), /^Schedule data r2 · patch 12\.1\.5 · reviewed Nov 8, 2026$/);
  assert.match(await text(page, '#untracked'), /^Not shown as times, because no verified schedule exists: Timewalking from December 1, 2026 \(.+\); Weekly bonus events from January 5, 2027 \(.+\); Turbulent Timeways/);
  assert.doesNotMatch(await text(page, '#untracked'), /Curse Surge/);
  await page.close();
});

check('the favicon is an inline SVG that the browser draws, with no request', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const size = await page.eval(`new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => ok('error'); i.src = document.querySelector('link[rel=icon]').href; })`);
  assert.ok(Array.isArray(size) && size[0] > 0 && size[0] === size[1], JSON.stringify(size)); // drawn, square
  assert.ok(!page.requests.some((u) => /favicon/.test(u)), 'no favicon request');
  await page.close();
});

// ---- Where schedules are not known yet ----

check('from December 1 the weekly categories say "Not known yet" in the week, the calendar and Coming up, never "nothing"', async () => {
  const page = await open({ at: utc('2026-11-28T18:00:00Z') });
  const next = await text(page, '#week-grid .week-col:nth-child(2)');
  assert.match(next, /Not known yet from Tue, Dec 1, 9:00 AM: Timewalking, World bosses, Outdoor events\./);
  assert.match(next, /Pet Battle Bonus Event.*Battleground Bonus EventPredicted time/, 'the bonus weeks of December are known');
  assert.doesNotMatch(await text(page, '#week-grid .week-col:nth-child(1)'), /Not known yet/);
  assert.equal(await page.eval(`document.getElementById('next-gap').hidden`), false, 'a 7-day Coming up crosses Dec 1');
  const months = await page.eval(`[...document.querySelectorAll('#calendar .month')].map((m) => [m.querySelector('h3').textContent, Boolean(m.querySelector('.gap'))])`);
  assert.deepEqual(months, [['November 2026', false], ['December 2026', true], ['January 2027', true], ['February 2027', true], ['March 2027', true]]);
  assert.match(await text(page, '#calendar'), /Nothing after Mar 31, 2027 is in the data yet\./);
  assert.match(await page.eval(`document.querySelector('#calendar .gap-cats').title`), /12\.1\.7/);
  await page.close();
});

check('following only Timewalking in December, or only bonus events in January, says nothing is known yet, not that nothing is scheduled', async () => {
  const jan = await open({ at: utc('2027-01-08T18:00:00Z'), prefs: { categories: ['bonus'] } });
  assert.equal(await text(jan, '#now-empty'), 'Nothing known is in its scheduled window right now.');
  assert.match(await text(jan, '#now-gap'), /^Not known yet from Tue, Jan 5, 9:00 AM: Bonus events\.$/);
  await jan.close();
  const page = await open({ at: utc('2026-12-05T18:00:00Z'), prefs: { categories: ['timewalking'] } });
  assert.equal(await text(page, '#now-empty'), 'Nothing known is in its scheduled window right now.');
  assert.match(await text(page, '#now-gap'), /^Not known yet from Tue, Dec 1, 9:00 AM: Timewalking\.$/);
  assert.match(await text(page, '#next-empty'), /^Nothing known starts in the next 7 days\./);
  assert.match(await text(page, '#week-grid'), /Nothing known yet\./);
  assert.doesNotMatch(await text(page, '#week-grid'), /Nothing you follow is scheduled/);
  await page.close();
});

check('before any gap, nothing says "Not known yet": on 2026-10-28 with a 1-day span', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { aheadHours: 24 } });
  assert.equal(await page.eval(`document.getElementById('next-gap').hidden && document.getElementById('now-gap').hidden`), true);
  assert.doesNotMatch(await text(page, '#week-grid'), /Not known yet/);
  await page.close();
});

// ---- Layout and accessibility ----

for (const [w, mobile] of [[390, true], [360, true], [768, false]]) {
  check(`at ${w} px nothing scrolls sideways and every control can be reached`, async () => {
    const long = { id: 'long', name: 'Profession weekly quests for every crafting profession I have', kind: 'weekly' };
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), width: w, height: 800, mobile, prefs: { checklistOpen: true }, checklist: { tasks: [...TASKS.tasks, long], done: {} } });
    await page.waitFor(`document.querySelectorAll('#news-list li a').length > 0`);
    await click(page, '#filters-toggle'); // on phones the filters are folded; open them so every control is measured
    for (const mode of ['list', 'editing']) {
      const wide = await page.eval(`[...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > ${w} + 1 || r.left < -1); }).map((e) => e.tagName + '.' + e.className).slice(0, 5)`);
      assert.deepEqual(wide, [], mode);
      assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, `no horizontal scroll (${mode})`);
      const small = await page.eval(`[...document.querySelectorAll('button, select, a.btn, input')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < (e.type === 'checkbox' ? 18 : 28)).map((e) => e.textContent || e.id || e.type)`);
      assert.deepEqual(small, [], mode);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot(join(SHOTS, `mobile-${w}${mode === 'editing' ? '-editing' : ''}.png`), true); }
      if (mode === 'list') await click(page, '#cl-edit');
    }
    await page.close();
  });
}

check('on phones the filters fold behind one button that says what is set; wide screens show them as before', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), width: 390, height: 844, mobile: true, prefs: { filter: 'starred', aheadHours: 24, timeMode: 'utc', hidden: ['moonkin-festival'] } });
  const shown = (p, sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).offsetParent !== null`);
  assert.equal(await shown(page, '#category-chips'), false, 'folded on a phone');
  assert.equal(await text(page, '#filters-summary'), 'Starred · all categories · 24 hours · UTC · 1 hidden');
  await click(page, '#filters-toggle');
  assert.equal(await shown(page, '#category-chips'), true);
  assert.equal(await page.eval(`document.getElementById('filters-toggle').getAttribute('aria-expanded')`), 'true');
  assert.equal(await text(page, '#filters-act'), 'Hide');
  await page.close();
  const wide = await open({ at: utc('2026-10-28T01:30:00Z'), width: 1280 });
  assert.equal(await shown(wide, '#filters-toggle'), false, 'no fold on a wide screen');
  assert.equal(await shown(wide, '#category-chips'), true);
  await wide.close();
});

check('keyboard: Tab starts at the skip link, reaches the game version and region buttons, and Escape closes About', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const key = async (k, code) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
  };
  await key('Tab', 'Tab');
  assert.equal(await page.eval('document.activeElement.className'), 'skip');
  const stops = [];
  for (let i = 0; i < 4; i++) { await key('Tab', 'Tab'); stops.push(await page.eval(`document.activeElement.getAttribute('data-edition') || document.activeElement.getAttribute('data-region') || document.activeElement.id`)); }
  assert.deepEqual(stops, ['retail', 'forever', 'labs-link', 'us'], 'skip link, Retail, Forever, RadMage Labs, Americas');
  await click(page, '#about-btn');
  assert.equal(await page.eval(`document.getElementById('about').open`), true);
  await key('Escape', 'Escape');
  assert.equal(await page.eval(`document.getElementById('about').open`), false);
  const unlabeled = await page.eval(`[...document.querySelectorAll('button, select, a')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || (e.labels && e.labels.length))).length`);
  assert.equal(unlabeled, 0);
  await page.close();
});

check('a live calendar row keeps its text at 4.5:1 or more in every category and both themes, and the header link is underlined', async () => {
  const page = await open({ at: utc('2026-11-02T00:00:00Z') });
  const worst = await page.eval(`(() => {
    const rgb = (s) => {
      let m = /^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/.exec(s);
      if (m) return [+m[1], +m[2], +m[3]];
      m = /^color\\(srgb ([\\d.e-]+) ([\\d.e-]+) ([\\d.e-]+)/.exec(s);
      if (m) return [m[1] * 255, m[2] * 255, m[3] * 255];
      throw new Error('unknown color ' + s);
    };
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const li = document.querySelector('#calendar li.is-now'), sub = li.querySelector('.sub');
    const cats = [...document.querySelectorAll('#category-chips [data-category]')].map((b) => b.getAttribute('data-category'));
    let worst = { ratio: Infinity };
    for (const theme of ['dark', 'light']) {
      document.documentElement.setAttribute('data-theme', theme);
      for (const cat of cats) {
        li.setAttribute('data-cat', cat);
        const r = ratio(rgb(getComputedStyle(sub).color), rgb(getComputedStyle(li).backgroundColor));
        if (r < worst.ratio) worst = { ratio: Math.round(r * 100) / 100, theme, cat, n: cats.length };
      }
    }
    return worst;
  })()`);
  assert.equal(worst.n, 7, 'every category was tried');
  assert.ok(worst.ratio >= 4.5, `${worst.ratio}:1 for ${worst.cat} in the ${worst.theme} theme`);
  assert.match(await page.eval(`getComputedStyle(document.getElementById('labs-link')).textDecorationLine`), /underline/);
  await page.close();
});

check('Happening now cards glow without animating, with or without reduced motion, so an idle page restyles about once a second', async () => {
  for (const media of [null, [{ name: 'prefers-reduced-motion', value: 'reduce' }]]) {
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), media });
    const card = `getComputedStyle(document.querySelector('#now-list .event'))`;
    assert.equal(await page.eval(`${card}.animationName`), 'none');
    const shadows = (await page.eval(`${card}.boxShadow`)).split(/,(?![^(]*\))/);
    assert.equal(shadows.length, 2, 'a ring and a glow in the card color');
    await page.send('Performance.enable', {});
    const recalcs = async () => (await page.send('Performance.getMetrics', {})).metrics.find((m) => m.name === 'RecalcStyleCount').value;
    const before = await recalcs();
    await sleep(3000);
    const n = (await recalcs()) - before;
    assert.ok(n < 20, `${n} style recalculations in 3 s on an idle page`);
    await page.close();
  }
});

check('screenshots for review: desktop dark, desktop light, Europe', async () => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const [name, prefs] of [['desktop-dark', null], ['desktop-light', { theme: 'light' }], ['desktop-europe', { region: 'eu' }]]) {
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs });
    await sleep(300);
    await page.screenshot(join(SHOTS, `${name}.png`), true);
    await page.close();
  }
});

// The checks whose results depend on font widths: where things wrap, fit, scroll sideways or move. --layout
// runs only these, so they can be repeated cheaply with other fonts. Each entry must name exactly one check.
const LAYOUT_CHECKS = [
  'news opens under the resets once the page has loaded',
  'a slow news answer never holds up the countdowns or moves Happening now',
  'a headline too long for one line ends in an ellipsis and never widens the page',
  'on a phone the details fit the screen without sideways scrolling',
  'on a phone several reminders at once show one notice',
  'on a desktop at most three notices show',
  'your checklist sits after Coming up as one folded line',
  'selecting the backup text with a drag that ends outside the box',
  'Forever at 390, 360 and 768 px: nothing scrolls sideways',
  'the "All versions" label never moves the news when the headlines arrive',
  'the page draws once, complete: no layout shift while it loads',
  'at 390 px nothing scrolls sideways',
  'at 360 px nothing scrolls sideways',
  'at 768 px nothing scrolls sideways',
  'on phones the filters fold behind one button',
];
for (const l of LAYOUT_CHECKS) {
  const n = checks.filter((c) => c.name.startsWith(l)).length;
  if (n !== 1) { console.error(`LAYOUT_CHECKS: "${l}" names ${n} checks, not one`); process.exit(1); }
}
const isLayout = (c) => LAYOUT_CHECKS.some((l) => c.name.startsWith(l));

// What this run really draws with: the browser, and the fonts of the page's text and headings as drawn.
{
  const page = await open({ at: utc('2026-11-09T18:00:00Z') });
  const sans = await page.platformFonts('#region-line'), serif = await page.platformFonts('#now-title');
  await page.close();
  const fonts = [PROFILE ? PROFILE.label : "this machine's fonts", SET ? `${SET.label} in the page` : null].filter(Boolean).join('; ');
  console.log(`environment: Node ${process.version} on ${process.platform}, ${await chrome.version()}, ${fonts}: text drawn in ${sans.join(' + ')}, headings in ${serif.join(' + ')}${LAYOUT ? '; layout checks only' : ''}`);
  const expect = (SET && SET.expect) || (PROFILE && PROFILE.expect);
  if (expect && !(expect.sans.includes(sans[0]) && expect.serif.includes(serif[0]))) {
    console.error(`The requested fonts are not in use (text ${sans[0]}, headings ${serif[0]}; expected ${expect.sans.join(' or ')} and ${expect.serif.join(' or ')}). Nothing was checked.`);
    process.exit(1);
  }
}

for (const c of checks) {
  if (ONLY && !c.name.includes(ONLY)) continue;
  if (LAYOUT && !isLayout(c)) continue;
  try { await c.fn(); passed++; console.log(`ok   ${c.name}`); } catch (e) { failed++; console.log(`FAIL ${c.name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
await chrome.close();
for (const s of servers) s.close();
rmSync(EMPTY, { recursive: true, force: true });
rmSync(MISSING, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
