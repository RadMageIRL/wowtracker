// Compares calendar snapshots and the published data, and writes a report for a person to read. It never
// edits data/: any change goes through a person, the data rules and the tests.
//
//   node tools/calendar/compare.mjs --new <snapshot> --data data/<source>.source.json
//        [--old <snapshot>]               another build to compare with (rows and occurrences)
//        [--from YYYY-MM-DD]              compare windows from this day (default: the earliest published window)
//        [--until YYYY-MM-DD]             compare the two builds up to this day (default: a year past the data's end)
//        [--cross-check <fixture.json>]   refuse unless an independent decoder's rows agree
//        [--out <base>]                   write <base>.md and <base>.json (default local/calendar/reports/...)
//        [--quiet]                        print only the last line
// A snapshot is extract.mjs output or a committed fixture with a table (tests/fixtures/client-calendar-*.json).
// Exit: 0 nothing published is affected, 1 something to review, 2 refused (bad input, decoders disagree).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { asSnapshot, compare } from './lib.mjs';

const require = createRequire(import.meta.url);
const S = require('../../js/schedule.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const json = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const day = (s, name) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`--${name} takes YYYY-MM-DD`); return Date.parse(`${s}T00:00:00Z`); };

try {
  if (!opt('new') || !opt('data')) throw new Error('usage: --new <snapshot> --data <source.json> [--old <snapshot>] [--from day] [--until day] [--cross-check fixture] [--out base]');
  const source = json(opt('data'));
  const newSnap = asSnapshot(json(opt('new'))), oldSnap = opt('old') ? asSnapshot(json(opt('old'))) : null;
  // By default from the earliest dated window the data publishes (rule schedules have no first date).
  const starts = source.events.flatMap((e) => Object.values(e.schedules || {}).filter((s) => s && s.type === 'dates').flatMap((s) => s.windows.map((w) => Date.parse(w.start))));
  const fromMs = opt('from') ? day(opt('from'), 'from') : Math.min(...starts);
  const untilMs = opt('until') ? day(opt('until'), 'until') : Date.parse(source.meta.coversUntil + 'T00:00:00Z') + 366 * 86400000;
  const fixture = opt('cross-check') ? json(opt('cross-check')) : null;
  const r = compare({ oldSnap, newSnap, source, fromMs, untilMs, crossCheckFixture: fixture });
  const cc = r.json.crossCheck;
  const base = opt('out') || join(ROOT, 'local', 'calendar', 'reports', `${newSnap.product}-${oldSnap ? `${oldSnap.build}-to-` : ''}${newSnap.build}`);
  mkdirSync(dirname(resolve(base)), { recursive: true });
  writeFileSync(`${base}.md`, r.markdown);
  writeFileSync(`${base}.json`, JSON.stringify(r.json, null, 1) + '\n');
  if (!argv.includes('--quiet')) console.log(r.markdown);
  if (cc && (cc.onlyTool.length || cc.onlyFixture.length)) { console.error(`Refused: the two decoders disagree (${cc.onlyTool.length} only here, ${cc.onlyFixture.length} only in the fixture). Report: ${base}.md`); process.exit(2); }
  console.log(`${r.code === 0 ? 'Nothing published is affected' : 'Something to review'}. Report: ${base}.md`);
  process.exit(r.code);
} catch (e) {
  console.error(`Refused: ${e.message}`);
  process.exit(2);
}
