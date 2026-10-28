// The production build: checks the schedule data, then copies exactly the files the site serves into
// dist/ and prints their SHA-256. The output is byte-for-byte reproducible; --verify builds twice
// more into fresh folders and compares.
//
//   node tools/build.mjs            build dist/
//   node tools/build.mjs --verify   also prove two more builds are identical
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, buildData } from './build-data.mjs';

/** The files the site is made of, relative to the repo root. Nothing else is published. */
export const SITE_FILES = [
  'index.html', 'style.css', 'events-data.js',
  'js/config.js', 'js/theme-boot.js', 'js/schedule.js', 'js/store.js', 'js/news.js', 'js/clock.js', 'js/app.js',
];

export function build(outDir = join(ROOT, 'dist')) {
  const r = buildData({ check: true, log: () => {} });
  if (!r.ok) throw new Error('Schedule data refused:\n  ' + r.errors.join('\n  '));
  const jsOnDisk = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`).sort();
  const listed = SITE_FILES.filter((f) => f.startsWith('js/')).sort();
  if (JSON.stringify(jsOnDisk) !== JSON.stringify(listed)) throw new Error(`js/ holds ${jsOnDisk.join(', ')} but SITE_FILES lists ${listed.join(', ')}`);
  rmSync(outDir, { recursive: true, force: true });
  const manifest = [];
  for (const f of SITE_FILES) {
    const body = readFileSync(join(ROOT, f));
    mkdirSync(join(outDir, f, '..'), { recursive: true });
    writeFileSync(join(outDir, f), body);
    manifest.push(`${createHash('sha256').update(body).digest('hex')}  ${f}`);
  }
  return { outDir, manifest, revision: r.revision };
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  try {
    const { outDir, manifest, revision } = build();
    console.log(`Built ${outDir} (schedule data r${revision}):\n` + manifest.join('\n'));
    if (process.argv.includes('--verify')) {
      const a = build(mkdtempSync(join(tmpdir(), 'wowtracker-build-a-'))), b = build(mkdtempSync(join(tmpdir(), 'wowtracker-build-b-')));
      for (const d of [a.outDir, b.outDir]) rmSync(d, { recursive: true, force: true });
      if (a.manifest.join('\n') !== manifest.join('\n') || b.manifest.join('\n') !== manifest.join('\n')) { console.error('Two builds differ.'); process.exit(1); }
      console.log('Reproducible: three builds produced identical files.');
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
