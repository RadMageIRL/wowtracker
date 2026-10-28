// Browser tests on the production build (dist/, from node tools/build.mjs), in headless Chrome over the
// DevTools protocol with no dependencies. Each check opens a fresh tab with a simulated clock and time
// zone. news.json is answered from a fixture, refused, or missing, so no test reaches Blizzard.
//
//   node tests/smoke.mjs [--dir dist] [--only <part of a check name>] [--shots <folder>]
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './lib/cdp.mjs';
import { serve } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(ROOT, opt('dir', 'dist'));
const ONLY = opt('only', '');
const SHOTS = opt('shots', null);
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
const EMPTY_BASE = await site(EMPTY, { sendDate: false, news: 'off' });
const MISSING_BASE = await site(MISSING, { sendDate: false, news: 'off' });
const DATED = await site(DIR, { sendDate: true, news: 'off' });
const chrome = await launchChrome();
for (const b of [BASE]) await chrome.grant(b.slice(0, -1), ['clipboardReadWrite', 'clipboardSanitizedWrite']);

let passed = 0, failed = 0;
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** A fresh tab: storage cleared (or seeded with prefs), a simulated clock and zone. */
async function open({ at, tz = 'America/Chicago', width = 1280, height = 900, mobile = false, url = BASE, prefs = null, keepStorage = false, media = null } = {}) {
  const page = await chrome.newPage();
  const origin = new URL(url).origin;
  if (!keepStorage && url.startsWith('http')) await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await page.emulate({ timezone: tz, locale: 'en-US' });
  await page.viewport(width, height, mobile);
  if (media) await page.emulateMedia(media);
  if (at) await page.startClockAt(at);
  if (prefs) await page.beforeLoad(`if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wowtracker:v1:prefs', ${JSON.stringify(JSON.stringify(prefs))}); sessionStorage.setItem('seeded', '1'); }`);
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
  assert.deepEqual(await cardNames(page), ["Hallow's End", 'Warlords of Draenor Timewalking', "Lu'ashal"]);
  assert.deepEqual((await rowNames(page)).slice(0, 4), ['Aqir Invasion', 'Aqir Invasion', 'Aqir Invasion', 'Darkmoon Faire']);
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
  assert.deepEqual(await cardNames(page), ['Delves Bonus Event', 'Predaxas', "Hallow's End"]); // soonest to end first
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

check('Coming up puts starts after local midnight under day headings and repeats an hourly event only three times', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.deepEqual(await texts(page, '#next-list .day-sep'), ['Sunday, Nov 1', 'Tuesday, Nov 3']);
  assert.equal((await rowNames(page)).filter((n) => n === 'Aqir Invasion').length, 3);
  await page.close();
  const late = await open({ at: utc('2026-10-28T04:30:00Z'), prefs: { aheadHours: 4 } }); // 11:30 PM in Chicago
  assert.deepEqual(await texts(late, '#next-list .day-sep'), ['Tomorrow']);
  await late.close();
});

check('an event moves from Coming up into Happening now when its window opens', async () => {
  const page = await open({ at: utc('2026-10-28T01:59:58Z'), prefs: { aheadHours: 1 } });
  assert.ok(!(await cardNames(page)).includes('Aqir Invasion'));
  await page.waitFor(`[...document.querySelectorAll('#now-list h3')].some((h) => h.textContent === 'Aqir Invasion')`, 6000);
  assert.match(await text(page, '#now-list [data-id="aqir-invasion"] .big'), /^Ends in (9m|10m)/);
  await page.close();
});

check('nothing is shown as live after the data stops: on 2026-12-02 no world boss, Aqir or bonus week is listed', async () => {
  const page = await open({ at: utc('2026-12-02T18:05:00Z') });
  const now = await page.eval(`[...document.querySelectorAll('#now-list [data-id]')].map((e) => e.getAttribute('data-id'))`);
  assert.deepEqual(now.sort(), ['wow-anniversary']);
  await page.close();
});

// ---- Labels ----

check('Predicted labels sit on the predicted events only, and every confirmed Americas event has none', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const rows = await page.eval(`[...document.querySelectorAll('#calendar .agenda li')].map((li) => [li.getAttribute('data-id'), Boolean(li.querySelector('.badge.predicted'))])`);
  for (const [id, predicted] of rows) assert.equal(predicted, id.startsWith('world-boss-') || id === 'aqir-invasion', id);
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
  await click(page, '[data-filter="starred"]');
  assert.deepEqual(await cardNames(page), ["Hallow's End"]);
  assert.equal(await page.eval(`document.querySelectorAll('#next-list .row').length`), 0);
  await click(page, '[data-filter="all"]');
  await click(page, '#hidden-btn');
  await click(page, '[data-unhide="darkmoon-faire"]');
  assert.equal(await text(page, '#hidden-btn'), 'Hidden (0)');
  assert.ok((await rowNames(page)).includes('Darkmoon Faire'));
  await page.close();
});

check('a starred event becomes the summary\'s "Next starred event", even an hourly one', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), prefs: { starred: ['aqir-invasion'] } });
  assert.match(await text(page, '#summary .next'), /^Next starred eventAqir Invasion\s*Predicted/);
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
  assert.deepEqual(page.problems, []);
  await page.close();
});

check('without the data file the page says the schedule did not load, with no script errors', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: MISSING_BASE });
  assert.match(await text(page, '#clock-notice'), /schedule data did not load/);
  assert.ok(page.problems.every((p) => /404|failed: net::ERR_ABORTED/.test(p)), page.problems.join('\n'));
  await page.close();
});

// ---- News ----

check('news stays closed and asks nothing until opened; then eight Blizzard headlines show as plain text', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.equal(page.requests.filter((u) => u.includes('news.json')).length, 0);
  await click(page, '#news-toggle');
  await page.waitFor(`document.querySelectorAll('#news-list li').length === 8`);
  assert.equal(await text(page, '#news-list li a'), 'Hotfixes: October 27, 2026');
  const links = await page.eval(`[...document.querySelectorAll('#news-list a')].map((a) => [a.href, a.target, a.rel])`);
  for (const [href, target, rel] of links) { assert.match(href, /^https:\/\/news\.blizzard\.com\/en-us\//); assert.equal(target, '_blank'); assert.match(rel, /noopener/); }
  assert.equal(await page.eval(`document.querySelectorAll('#news-list b, #news-list script').length`), 0);
  // Shop posts are left out by default; the button brings them back, and the choice is saved.
  assert.ok((await texts(page, '#news-list .meta')).every((t) => !/^(Shop Now|Sale|ON SALE) ·/.test(t)));
  assert.ok((await texts(page, '#news-list a')).includes('Hotfixes: a mount sale price shown wrong in the shop is fixed'));
  assert.equal(await text(page, '#news-shop'), 'Show 5 shop posts');
  await click(page, '#news-shop');
  assert.ok((await texts(page, '#news-list .meta')).some((t) => /^Shop Now ·/.test(t)));
  assert.equal(await text(page, '#news-shop'), 'Hide shop posts');
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#news-list li').length === 8`);
  assert.equal(await text(page, '#news-shop'), 'Hide shop posts', 'the choice to show shop posts is saved');
  await click(page, '#news-shop');
  assert.equal(await text(page, '#news-shop'), 'Show 5 shop posts');
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#news-list li').length === 8`);
  assert.equal(await page.eval(`document.getElementById('news-toggle').getAttribute('aria-expanded')`), 'true', 'open state is saved');
  await page.close();
});

check('when news.json is missing the section links to Blizzard News and the timers carry on', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: NO_NEWS, prefs: { newsOpen: true } });
  await page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  assert.equal(await page.eval(`document.querySelector('#news-note a').href`), 'https://news.blizzard.com/en-us/feed/world-of-warcraft');
  assert.ok((await cardNames(page)).length >= 3);
  await page.close();
});

check('opened from a file: the page works, news links out, nothing errors', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), url: pathToFileURL(join(DIR, 'index.html')).href, prefs: null });
  assert.ok((await cardNames(page)).length >= 3);
  await click(page, '#news-toggle');
  await page.waitFor(`/cannot load/.test(document.getElementById('news-note').textContent)`);
  assert.deepEqual(page.problems, []);
  await page.close();
});

// ---- Security and requests ----

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

// ---- Footer ----

check('the footer links go where config.js says, and Share passes the canonical address', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  assert.deepEqual(await texts(page, '#footer-links a, #footer-links button'), ['RadMage Labs', 'GitHub', 'Share', 'Feedback', 'Buy me a coffee']);
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
  assert.match(next, /Not known yet from Tue, Dec 1, 9:00 AM: Timewalking, Bonus events, World bosses, Outdoor events\./);
  assert.doesNotMatch(await text(page, '#week-grid .week-col:nth-child(1)'), /Not known yet/);
  assert.equal(await page.eval(`document.getElementById('next-gap').hidden`), false, 'a 7-day Coming up crosses Dec 1');
  const months = await page.eval(`[...document.querySelectorAll('#calendar .month')].map((m) => [m.querySelector('h3').textContent, Boolean(m.querySelector('.gap'))])`);
  assert.deepEqual(months, [['November 2026', false], ['December 2026', true], ['January 2027', true], ['February 2027', true], ['March 2027', true]]);
  assert.match(await text(page, '#calendar'), /Nothing after Mar 31, 2027 is in the data yet\./);
  assert.match(await page.eval(`document.querySelector('#calendar .gap-cats').title`), /12\.1\.7/);
  await page.close();
});

check('following only bonus events in December says nothing is known yet, not that nothing is scheduled', async () => {
  const page = await open({ at: utc('2026-12-05T18:00:00Z'), prefs: { categories: ['bonus'] } });
  assert.equal(await text(page, '#now-empty'), 'Nothing known is in its scheduled window right now.');
  assert.match(await text(page, '#now-gap'), /^Not known yet from Tue, Dec 1, 9:00 AM: Bonus events\.$/);
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
    const page = await open({ at: utc('2026-10-28T01:30:00Z'), width: w, height: 800, mobile, prefs: { newsOpen: true } });
    await page.waitFor(`document.querySelectorAll('#news-list li').length > 0`);
    const wide = await page.eval(`[...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > ${w} + 1 || r.left < -1); }).map((e) => e.tagName + '.' + e.className).slice(0, 5)`);
    assert.deepEqual(wide, []);
    assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, 'no horizontal scroll');
    const small = await page.eval(`[...document.querySelectorAll('button, select, a.btn')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 28).map((e) => e.textContent)`);
    assert.deepEqual(small, []);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot(join(SHOTS, `mobile-${w}.png`), true); }
    await page.close();
  });
}

check('keyboard: Tab starts at the skip link, reaches the region buttons, and Escape closes About', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z') });
  const key = async (k, code) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
  };
  await key('Tab', 'Tab');
  assert.equal(await page.eval('document.activeElement.className'), 'skip');
  await key('Tab', 'Tab'); await key('Tab', 'Tab');
  assert.equal(await page.eval(`document.activeElement.getAttribute('data-region')`), 'us');
  await click(page, '#about-btn');
  assert.equal(await page.eval(`document.getElementById('about').open`), true);
  await key('Escape', 'Escape');
  assert.equal(await page.eval(`document.getElementById('about').open`), false);
  const unlabeled = await page.eval(`[...document.querySelectorAll('button, select, a')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || (e.labels && e.labels.length))).length`);
  assert.equal(unlabeled, 0);
  await page.close();
});

check('with reduced motion the Happening now cards do not breathe', async () => {
  const page = await open({ at: utc('2026-10-28T01:30:00Z'), media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('#now-list .event')).animationName`), 'none');
  await page.close();
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

for (const c of checks) {
  if (ONLY && !c.name.includes(ONLY)) continue;
  try { await c.fn(); passed++; console.log(`ok   ${c.name}`); } catch (e) { failed++; console.log(`FAIL ${c.name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
await chrome.close();
for (const s of servers) s.close();
rmSync(EMPTY, { recursive: true, force: true });
rmSync(MISSING, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
