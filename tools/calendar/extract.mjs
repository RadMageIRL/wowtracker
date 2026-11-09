// Reads one build's three calendar CSVs into a snapshot (rows sorted by ID, description text kept only as a
// SHA-256 fingerprint). Refuses a table whose columns changed. Deterministic: the same files, the same bytes.
//
//   node tools/calendar/extract.mjs <folder with Holidays.csv, HolidayNames.csv, HolidayDescriptions.csv>
//        [--product <p> --build <b>]   (else from the folder's manifest.json)   [--out <file>] (else <folder>/snapshot.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotFromCsv, sha256 } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const dir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
try {
  if (!dir) throw new Error('usage: node tools/calendar/extract.mjs <folder> [--product p --build b] [--out file]');
  const manifest = existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) : {};
  const read = (n) => readFileSync(join(dir, n), 'utf8');
  const text = { holidays: read('Holidays.csv'), names: read('HolidayNames.csv'), descriptions: read('HolidayDescriptions.csv') };
  const files = ['Holidays.csv', 'HolidayNames.csv', 'HolidayDescriptions.csv'].map((name, i) => ({ name, sha256: sha256(Object.values(text)[i]) }));
  if (manifest.files) for (const f of files) {
    const m = manifest.files.find((x) => x.name === f.name);
    if (m && m.sha256 !== f.sha256) throw new Error(`${f.name} is not the file the manifest recorded`);
  }
  const snap = snapshotFromCsv({ ...text, product: opt('product') || manifest.product, build: opt('build') || manifest.build, retrieved: manifest.retrieved || null, files });
  const out = opt('out') || join(dir, 'snapshot.json');
  writeFileSync(out, JSON.stringify(snap, null, 1) + '\n');
  console.log(`${snap.product} ${snap.build}: ${snap.table.length} rows -> ${out}`);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
