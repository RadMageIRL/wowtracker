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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SITE_FILES } = await import('../tools/build.mjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
const file = (p) => readFileSync(join(ROOT, p), 'utf8');

engineTests(test);
unitTests(test);
await dataTests(test);

// ---- The page ----

const html = file('index.html');
const VERSION = '0.1.0';

test('the version is the same in the title, header, About, README and every asset link', () => {
  assert.ok(html.includes(`<title>WoW Tracker v${VERSION} - `));
  assert.ok(html.includes(`<span class="tag">v${VERSION} · `));
  assert.ok(html.includes(`<h2 id="about-title">WoW Tracker v${VERSION}</h2>`));
  assert.match(file('README.md'), new RegExp(`^# WoW Tracker v${VERSION.replace(/\./g, '\\.')}\\n`));
  const assets = [...html.matchAll(/(?:src|href)="((?:js\/[^"]+\.js|style\.css)[^"]*)"/g)].map((m) => m[1]);
  assert.equal(assets.length, 8);
  for (const a of assets) assert.ok(a.endsWith(`?v=${VERSION}`), a);
});

test('the changelog opens with this version and lists the current schedule data revision', () => {
  const log = file('CHANGELOG.md');
  const DATA = require('../events-data.js');
  assert.ok(log.startsWith(`# Changelog\n\n## v${VERSION} (`), 'the newest entry is this version');
  assert.match(log.split('\n')[2], /^## v\d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/);
  assert.ok(log.includes(`\n- r${DATA.meta.datasetRevision} (${DATA.meta.reviewedOn})`), 'the schedule data revision is listed');
});

test('the page loads the schedule data with ?r= set to the dataset revision', () => {
  const DATA = require('../events-data.js');
  assert.ok(html.includes(`<script src="events-data.js?r=${DATA.meta.datasetRevision}"></script>`));
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
  for (const cmd of ['node tests/run.mjs', 'node tools/build-data.mjs --check', 'node tools/build.mjs --verify', 'node tests/smoke.mjs']) assert.ok(wf.includes(cmd), cmd);
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

test('every project file uses LF line endings', () => {
  const bad = projectFiles().filter((p) => readFileSync(p).includes(13)).map((p) => relative(ROOT, p));
  assert.deepEqual(bad, []);
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
