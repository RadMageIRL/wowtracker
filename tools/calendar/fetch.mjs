// Downloads one client build's calendar tables (Holidays, HolidayNames, HolidayDescriptions) from wago.tools
// into local/calendar/<product>/<build>/ (local only: game data never goes into the repository), with a
// manifest of what was fetched: URLs, UTC time, sizes and SHA-256. One request per file, no retries.
//
//   node tools/calendar/fetch.mjs --product wowf --build 1.60.1.70862
//   node tools/calendar/fetch.mjs --latest            the latest build of wow, wowt and wowf
//   node tools/calendar/fetch.mjs --latest --check    only say which builds are new here (no download)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, PRODUCTS } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('out') || join(ROOT, 'local', 'calendar');
const UA = { 'User-Agent': 'wowtracker-maintenance/0.4' };
const TABLES = ['Holidays', 'HolidayNames', 'HolidayDescriptions'];

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function fetchBuild(product, build) {
  const dir = join(OUT, product, build);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const t of TABLES) {
    const url = `https://wago.tools/db2/${t}/csv?build=${encodeURIComponent(build)}`;
    const text = await get(url);
    const name = `${t}.csv`;
    writeFileSync(join(dir, name), text);
    files.push({ name, url, bytes: Buffer.byteLength(text), sha256: sha256(text) });
  }
  const manifest = { product, build, retrieved: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), files };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`${product} ${build}: ${files.map((f) => `${f.name} ${f.bytes} bytes`).join(', ')} -> ${dir}`);
}

try {
  if (argv.includes('--latest')) {
    const latest = JSON.parse(await get('https://wago.tools/api/builds/latest'));
    for (const p of Object.keys(PRODUCTS)) {
      const b = latest[p];
      if (!b) { console.log(`${p}: not listed`); continue; }
      const here = existsSync(join(OUT, p, b.version, 'manifest.json'));
      console.log(`${p} ${b.version} (${b.created_at})${here ? ', already here' : ', NEW here'}`);
      if (!argv.includes('--check') && !here) await fetchBuild(p, b.version);
    }
  } else {
    const product = opt('product'), build = opt('build');
    if (!PRODUCTS[product] || !/^\d+\.\d+\.\d+\.\d+$/.test(build || '')) throw new Error('usage: --product <wow|wowt|wowf> --build <a.b.c.d>, or --latest [--check]');
    await fetchBuild(product, build);
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
