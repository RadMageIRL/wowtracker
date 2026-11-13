// Unit tests, data rules and house checks. Run with `node tests/run.mjs`; no dependencies.
// The time-zone checks in tests/tz.mjs run at the end, once per zone, as child processes.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { engineTests } from './engine.mjs';
import { unitTests } from './units.mjs';
import { dataTests } from './data.mjs';
import { searchTests } from './search.mjs';
import { icsTests } from './ics.mjs';
import { entryTests } from './entries.mjs';
import { feedTests } from './feeds.mjs';
import { reminderTests } from './reminders.mjs';
import { checklistTests } from './checklist.mjs';
import { editionTests } from './editions.mjs';
import { foreverTests } from './forever.mjs';
import { calendarTests } from './calendar.mjs';
import { shareTests } from './share.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SITE_FILES } = await import('../tools/build.mjs');
const { FEEDS } = await import('../tools/feeds.mjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
const file = (p) => readFileSync(join(ROOT, p), 'utf8');

engineTests(test);
unitTests(test);
await dataTests(test);
searchTests(test);
icsTests(test);
entryTests(test);
feedTests(test);
reminderTests(test);
checklistTests(test);
await editionTests(test);
await foreverTests(test);
calendarTests(test);
shareTests(test);

// ---- The page ----

const html = file('index.html');
const VERSION = '0.5.0';

test('the version is the same in the title, header, About, README and every asset link', () => {
  assert.ok(html.includes(`<title>WoW Tracker v${VERSION} - `));
  assert.ok(html.includes(`<span class="tag">v${VERSION} · `));
  assert.ok(html.includes(`<h2 id="about-title">WoW Tracker v${VERSION}</h2>`));
  assert.match(file('README.md'), new RegExp(`^# WoW Tracker v${VERSION.replace(/\./g, '\\.')}\\n`));
  const assets = [...html.matchAll(/(?:src|href)="((?:js\/[^"]+\.js|style\.css)[^"]*)"/g)].map((m) => m[1]);
  assert.equal(assets.length, 15);
  for (const a of assets) assert.ok(a.endsWith(`?v=${VERSION}`), a);
});

// The schedule data revision comes from each data source (data/events.source.json for Retail,
// data/forever.source.json for WoW: Forever), never from where a line happens to sit in the changelog: each
// revision is listed once, in the entry of the version that first shipped it, and the newest entry names the
// revision it ships, either as its own line or, for a release with no change to that data, as unchanged.
// Retail's lines are "- rN (date)"; WoW: Forever's are "- WoW: Forever rN (date)".
test('the changelog opens with this version, which names the schedule data revision of each data source', () => {
  const log = file('CHANGELOG.md');
  assert.ok(log.startsWith(`# Changelog\n\n## v${VERSION} (`), 'the newest entry is this version');
  assert.match(log.split('\n')[2], /^## v\d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/);
  const parts = log.split(/^(?=## v)/m).slice(1);
  for (const [source, built, line, unchanged] of [
    ['data/events.source.json', '../events-data.js', '- r', (r) => [`\n- Retail: r${r}, unchanged.`, `Schedule data: r${r}, unchanged.`]],
    ['data/forever.source.json', '../forever-data.js', '- WoW: Forever r', (r) => [`\n- WoW: Forever: r${r}, unchanged.`]],
  ]) {
    const src = JSON.parse(file(source)).meta;
    const DATA = require(built);
    assert.deepEqual([DATA.meta.datasetRevision, DATA.meta.reviewedOn], [src.datasetRevision, src.reviewedOn], `${built} is built from the current source`);
    const re = new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+) \\((\\d{4}-\\d{2}-\\d{2})\\)`, 'gm');
    const entries = parts.map((e) => [...e.matchAll(re)].map((m) => Number(m[1])));
    assert.deepEqual(entries.flat().sort((a, b) => a - b), Array.from({ length: src.datasetRevision }, (_, i) => i + 1), `${source}: r1 to the current revision, each once`);
    entries.forEach((revs, i) => { for (const older of entries.slice(i + 1).flat()) assert.ok(revs.every((r) => r > older), `${source}: entry ${i + 1} lists r${revs} after an older entry's r${older}`); });
    assert.ok(parts[0].includes(`\n${line}${src.datasetRevision} (${src.reviewedOn})`) || unchanged(src.datasetRevision).some((x) => parts[0].includes(x)),
      `the v${VERSION} entry names ${source}'s revision r${src.datasetRevision}`);
  }
});

// Each data file's address names its revision, so a browser never keeps an older copy after a data change.
test('the page loads each edition\'s schedule data with ?r= set to that dataset\'s revision', () => {
  for (const f of ['events-data.js', 'forever-data.js']) {
    const DATA = require(`../${f}`);
    assert.ok(html.includes(`<script defer src="${f}?r=${DATA.meta.datasetRevision}"></script>`), f);
  }
});

// The page draws once, complete: every script loads deferred from the head (in this order, the data before the
// code that reads it), and app.js holds the first paint until it has filled the page, so it never draws an
// empty page and then jumps (a layout shift of about 0.9 before v0.3.0). theme-boot.js stays a plain script,
// first, so the theme is set before anything is drawn. Every script is this site's own file; nothing outside it.
test('every script loads from the head: theme-boot.js first and plain, the rest deferred in order, app.js holding the first paint', () => {
  const [head, body] = html.split('</head>');
  assert.ok(!/<script/.test(body), 'no script in the body');
  const tags = [...head.matchAll(/<script([^>]*)\bsrc="([^"?]+)\?[^"]*"><\/script>/g)].map((m) => [m[2], m[1].trim()]);
  assert.deepEqual(tags, [
    ['js/theme-boot.js', ''], ['js/config.js', 'defer'], ['events-data.js', 'defer'], ['forever-data.js', 'defer'],
    ['js/schedule.js', 'defer'], ['js/store.js', 'defer'], ['js/news.js', 'defer'], ['js/search.js', 'defer'], ['js/ics.js', 'defer'], ['js/calendar-entry.js', 'defer'], ['js/share.js', 'defer'],
    ['js/reminders.js', 'defer'], ['js/checklist.js', 'defer'], ['js/backup.js', 'defer'], ['js/clock.js', 'defer'],
    ['js/app.js', 'defer blocking="render"'],
  ]);
});

test('the CSP allows scripts, styles and connections to this site only', () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map((m) => m[1].trim());
  assert.deepEqual(inline, ['type="application/ld+json"'], 'the only inline script is the JSON-LD data block');
  assert.ok(!/\sstyle="/.test(html) && !/\son[a-z]+="/.test(html), 'no inline style or handler attributes');
});

test('the only network calls in the page code are news.json and the same-origin clock check', () => {
  const calls = [];
  for (const f of readdirSync(join(ROOT, 'js'))) {
    const src = file(`js/${f}`);
    for (const m of src.matchAll(/\bfetch\(([^,)]+)/g)) calls.push(`${f}: ${m[1].trim()}`);
    assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\(/.test(src), f);
  }
  assert.deepEqual(calls.sort(), ['app.js: News.NEWS_PATH', 'app.js: url']);
});

// The page offers the feeds through one place: js/calendar-entry.js names the four files and makes every link
// from the canonical address. Nothing else may spell a feed address or a webcal: link, so a link can never point
// at another host, another edition's feed, or the file as a plain download dressed up as a subscription.
test('subscription links come from one place: only js/calendar-entry.js names a feed file or webcal:, and the page holds no written-out feed link', () => {
  for (const f of ['index.html', ...readdirSync(join(ROOT, 'js')).map((n) => `js/${n}`)]) {
    if (f === 'js/calendar-entry.js') continue;
    assert.ok(!/calendar\/[a-z-]+\.ics|webcal:|calendar\.google\.com/.test(file(f)), f);
  }
  const ce = file('js/calendar-entry.js');
  assert.deepEqual([...ce.matchAll(/calendar\/[a-z-]+\.ics/g)].map((m) => m[0]), ['calendar/retail-americas.ics', 'calendar/retail-europe.ics', 'calendar/forever-americas.ics', 'calendar/forever-europe.ics']);
  // The dialog's links get their addresses from the code; in the page they are written without one.
  assert.match(html, /<a class="btn small" id="subscribe-google" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<a class="btn small" id="subscribe-webcal">/);
  assert.ok(!/download=/.test(html), 'no link in the page saves a file: a feed address is never offered as a download');
});

test('the Subscribe dialog says what a subscription is and is not: not instant, no WoW Tracker reminders, predicted titles, coverage, and only Google as tested', () => {
  const dialog = /<dialog id="subscribe-dialog"[\s\S]*?<\/dialog>/.exec(html)[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(dialog, /Changes are not instant\. Your calendar app decides when it looks again/);
  assert.match(dialog, /No WoW Tracker reminders: those work only on this page while it is open\./);
  assert.match(dialog, /Predicted times say "\(Predicted\)" or "\(Predicted time\)" in the title/);
  assert.match(dialog, /gives a one-time copy that never updates: that is not a subscription/);
  assert.match(dialog, /if a button does nothing: copy the address and paste it/);
  // What has been tried is said per app, and nothing claims more.
  assert.match(dialog, /Apple Calendar \(iPhone, iPad, Mac\): [^.]*\. I have not tested it on an Apple device\./);
  assert.match(dialog, /Outlook: [^.]*\. I have not tested it in Outlook\./);
  assert.ok(!/works (with|in) (every|all)|compatible with|guaranteed|instantly/i.test(dialog), dialog);
  assert.match(/<p class="export-help">[^<]*/.exec(html)[0], /A file is a one-time copy: it does not follow later schedule changes\. For a calendar that does, use Subscribe to calendar\./);
});

test('no innerHTML, outerHTML, insertAdjacentHTML, document.write or eval in the page code', () => {
  for (const f of readdirSync(join(ROOT, 'js'))) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(file(`js/${f}`)), f);
});

const CANON = 'https://radmagelabs.com/wow/';
const REPO = 'https://github.com/RadMageIRL/wowtracker';

test('footer and Share addresses come from config.js only, and point at the canonical page and the wowtracker repository', () => {
  const Config = require('../js/config.js');
  assert.equal(Config.shareUrl, CANON);
  assert.deepEqual(Config.links, { labs: 'https://radmagelabs.com/', github: REPO, feedback: `${REPO}/issues`, coffee: 'https://buymeacoffee.com/radmageirl' });
  for (const f of readdirSync(join(ROOT, 'js')).filter((x) => x !== 'config.js')) {
    assert.ok(!/github\.com|buymeacoffee|radmagelabs\.com\/wow/.test(file(`js/${f}`)), f);
  }
  for (const m of (html + file('README.md')).matchAll(/github\.com\/RadMageIRL\/[\w.-]+/gi)) assert.equal(m[0], 'github.com/RadMageIRL/wowtracker', m[0]);
});

test('sharing metadata: canonical, og:url and JSON-LD name the canonical address; the preview image is 1200x630 on radmagelabs.com', () => {
  const meta = (prop) => (new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)">`).exec(html) || [])[1];
  assert.ok(html.includes(`<link rel="canonical" href="${CANON}">`));
  assert.equal(meta('og:url'), CANON);
  assert.equal(meta('og:image'), 'https://radmagelabs.com/assets/og/wowtracker.png');
  assert.deepEqual([meta('og:image:width'), meta('og:image:height')], ['1200', '630']);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.ok(meta('og:title') && meta('og:description') && meta('og:image:alt'));
  const ld = JSON.parse(/<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)[1]);
  assert.equal(ld.url, CANON);
  // Search engines and the RadMage Labs checks compare these two; one description, said once.
  assert.equal(ld.description, meta('description'), 'the JSON-LD description is the meta description');
  assert.ok(meta('description').length <= 160, 'the meta description fits in a search result (160 characters)');
  assert.equal(ld.sameAs, REPO);
  assert.equal(ld.image, meta('og:image'));
});

test('the favicon is an inline SVG (no request) that parses', () => {
  const href = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(html)[1];
  const svg = decodeURIComponent(href);
  assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 64 64'>[\s\S]*<\/svg>$/);
});

test('release files: MIT LICENSE, .nojekyll for GitHub Pages, and a CI workflow that runs every check', () => {
  assert.match(file('LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 RadMageIRL\n/);
  assert.ok(existsSync(join(ROOT, '.nojekyll')));
  const wf = file('.github/workflows/test.yml');
  for (const cmd of ['node tests/run.mjs', 'node tools/build-data.mjs --check', 'node tools/build.mjs --verify', 'node tests/smoke.mjs\n',
    'node tests/controls.mjs\n', 'node tests/smoke.mjs --layout --font-profile android', 'node tests/smoke.mjs --layout --fonts arial-georgia', 'node tests/controls.mjs --font-profile android',
    'node-version: ${{ matrix.node }}', 'node: [22, 24]']) assert.ok(wf.includes(cmd), cmd);
  // Every job has a time limit, so a browser that hangs fails in minutes instead of six hours.
  const jobs = wf.split('\njobs:\n')[1].split(/^ {2}(?=[a-z]+:\n)/m).slice(1);
  assert.deepEqual(jobs.map((j) => j.split(':')[0]), ['unit', 'smoke', 'fonts']);
  for (const j of jobs) assert.match(j, /\n {4}timeout-minutes: \d+\n/, j.split(':')[0]);
});

// Every project file that is ours (not local research, not build output).
function projectFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'local', 'dist', 'node_modules'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) projectFiles(p, out);
    else if (!/\.(png|ico)$/.test(name)) out.push(p);
  }
  return out;
}

test('no em dashes in any project file', () => {
  const EM_DASH = String.fromCharCode(0x2014);
  const bad = projectFiles().filter((p) => readFileSync(p, 'utf8').includes(EM_DASH)).map((p) => relative(ROOT, p));
  assert.deepEqual(bad, []);
});

// RFC 5545 requires CRLF in calendar files, so the generated feeds, and nothing else, are exempt from the LF
// rule: exactly the files tools/feeds.mjs lists (not a folder or an extension), each held to CRLF instead.
const FEED_FILES = new Set(FEEDS.map((f) => join(ROOT, f.file)));

test('every project file uses LF line endings, except the generated calendar feeds', () => {
  const bad = projectFiles().filter((p) => !FEED_FILES.has(p) && readFileSync(p).includes(13)).map((p) => relative(ROOT, p));
  assert.deepEqual(bad, []);
});

test('the generated calendar feeds use CRLF on every line and nothing else, git stores them as written, and calendar/ holds only them', () => {
  for (const f of FEEDS) {
    const text = readFileSync(join(ROOT, f.file), 'latin1');
    assert.ok(text.endsWith('\r\n') && text.split('\r\n').length > 100, f.file);
    assert.equal(text.replace(/\r\n/g, '').search(/[\r\n]/), -1, `${f.file}: a line break that is not CRLF`);
  }
  assert.deepEqual(readdirSync(join(ROOT, 'calendar')).map((n) => `calendar/${n}`).sort(), FEEDS.map((f) => f.file).sort());
  assert.deepEqual(file('.gitattributes').split('\n'), ['* text=auto eol=lf', '*.png binary', 'calendar/*.ics -text', '']);
});

test('the project has no package.json and no dependencies', () => {
  assert.equal(existsSync(join(ROOT, 'package.json')), false);
  assert.equal(existsSync(join(ROOT, 'node_modules')), false);
});

test('every site file exists and README links point at real files', () => {
  for (const f of SITE_FILES) assert.ok(existsSync(join(ROOT, f)), f);
  for (const m of file('README.md').matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) assert.ok(existsSync(join(ROOT, m[1])), m[1]);
});

// ---- Time zones: tests/tz.mjs once per zone ----

for (const tz of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'Asia/Kolkata', 'UTC']) {
  test(`time-zone checks pass in ${tz}`, () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'tz.mjs')], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
