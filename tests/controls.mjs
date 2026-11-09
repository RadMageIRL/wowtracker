// Negative controls: past defects put back into a copy of the build, each of which a browser check must
// still catch. A check that passes on its old defect has stopped testing it, so a control that passes fails
// this run. Options after the build folder go to tests/smoke.mjs (--fonts, --font-profile).
//
//   node tests/controls.mjs [--dir dist] [smoke options]
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const at = argv.indexOf('--dir');
const DIR = resolve(ROOT, at >= 0 ? argv[at + 1] : 'dist');
const PASS = at >= 0 ? argv.filter((_, i) => i !== at && i !== at + 1) : argv;
if (!existsSync(join(DIR, 'index.html'))) { console.error(`No site in ${DIR}: run node tools/build.mjs first.`); process.exit(1); }

const CONTROLS = [
  {
    // v0.3.0 shipped with this on November 9, 2026: with Linux and Android fonts the news buttons wrapped
    // under the title at 360 to 390 px once "Show all" appeared (CI: "360 px: 30,49"). v0.3.1 fixed it.
    name: 'v0.3.0: the "All versions" label shares the title\'s line down to 360 px',
    file: 'style.css', from: '@media (max-width: 419px) {', to: '@media (max-width: 359px) {',
    check: 'the "All versions" label never moves the news when the headlines arrive',
    // The failure must be at a width the old rule broke (360 to 419 px): "360 px: 30,49" (head height) on
    // Linux, "360 px: the label has its own line" with Windows' fonts. Any other failure is not this defect.
    symptom: /\b(3[6-9]\d|41\d) px: [^\n]+/,
  },
];

let failed = 0;
for (const c of CONTROLS) {
  const copy = mkdtempSync(join(tmpdir(), 'wowtracker-control-'));
  try {
    cpSync(DIR, copy, { recursive: true });
    const text = readFileSync(join(copy, c.file), 'utf8');
    const n = text.split(c.from).length - 1;
    if (n !== 1) throw new Error(`${c.file} holds "${c.from}" ${n} times, not once: update this control`);
    writeFileSync(join(copy, c.file), text.replace(c.from, c.to));
    const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'smoke.mjs'), '--dir', copy, '--only', c.check, ...PASS], { encoding: 'utf8', timeout: 300000 });
    const out = `${r.stdout}${r.stderr}`;
    const env = (/^environment: .*$/m.exec(out) || ['(no environment line)'])[0];
    const caught = r.status === 1 && out.includes(`FAIL ${c.check}`) && c.symptom.test(out) && /^0 passed, 1 failed$/m.test(out);
    if (caught) console.log(`caught  ${c.name}\n  ${env}\n  ${(c.symptom.exec(out) || [''])[0]}`);
    else { failed++; console.log(`MISSED  ${c.name}: the check did not fail as it should (exit ${r.status})\n  ${out.trim().split('\n').join('\n  ')}`); }
  } catch (e) {
    failed++;
    console.log(`ERROR   ${c.name}: ${e.message}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
console.log(`${CONTROLS.length - failed} of ${CONTROLS.length} controls caught`);
process.exit(failed ? 1 : 0);
