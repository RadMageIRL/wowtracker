// Your checklist and the settings backup: reset periods from the engine's own reset rules, ticks that
// clear when the period changes, the checks on saved and imported data. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CL = require('../js/checklist.js');
const Backup = require('../js/backup.js');
const Store = require('../js/store.js');
const Rem = require('../js/reminders.js');
const S = require('../js/schedule.js');
const DATA = require('../events-data.js');

const ENGINE = { previousReset: S.previousReset, nextReset: S.nextReset };
const t = (iso) => Date.parse(iso);
const per = (region, iso) => CL.periods(DATA.resets, region, t(iso), ENGINE);
const keys = (region, iso) => { const p = per(region, iso); return [p.daily.key, p.weekly.key]; };
const LIST = { tasks: [{ id: 'aaa', name: 'World quests', kind: 'daily' }, { id: 'bbb', name: 'Claim the Great Vault', kind: 'weekly' }], done: {} };
let seed = 0;
const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

export function checklistTests(test) {
  test('checklist periods start exactly at each region\'s daily and weekly reset, one millisecond either side', () => {
    // Americas: daily 15:00 UTC, weekly Tuesday 15:00 UTC (2026-11-10 is a Tuesday).
    assert.deepEqual(keys('us', '2026-11-10T14:59:59.999Z'), ['us:daily:2026-11-09T15:00Z', 'us:weekly:2026-11-03T15:00Z']);
    assert.deepEqual(keys('us', '2026-11-10T15:00:00.000Z'), ['us:daily:2026-11-10T15:00Z', 'us:weekly:2026-11-10T15:00Z']);
    assert.deepEqual(keys('us', '2026-11-10T15:00:00.001Z'), ['us:daily:2026-11-10T15:00Z', 'us:weekly:2026-11-10T15:00Z']);
    // Europe: daily 04:00 UTC, weekly Wednesday 04:00 UTC.
    assert.deepEqual(keys('eu', '2026-11-11T03:59:59.999Z'), ['eu:daily:2026-11-10T04:00Z', 'eu:weekly:2026-11-04T04:00Z']);
    assert.deepEqual(keys('eu', '2026-11-11T04:00:00.000Z'), ['eu:daily:2026-11-11T04:00Z', 'eu:weekly:2026-11-11T04:00Z']);
    // A daily reset that is not the weekly one leaves the week alone.
    assert.deepEqual(keys('us', '2026-11-12T15:00:00Z'), ['us:daily:2026-11-12T15:00Z', 'us:weekly:2026-11-10T15:00Z']);
    const p = per('us', '2026-11-10T14:59:59.999Z');
    assert.deepEqual([p.daily.end, p.weekly.end], [t('2026-11-10T15:00:00Z'), t('2026-11-10T15:00:00Z')]);
    // Across the US and EU clock changes nothing moves: the resets are UTC rules.
    assert.deepEqual(keys('us', '2026-11-01T16:00:00Z'), ['us:daily:2026-11-01T15:00Z', 'us:weekly:2026-10-27T15:00Z']);
    assert.deepEqual(keys('eu', '2026-10-25T05:00:00Z'), ['eu:daily:2026-10-25T04:00Z', 'eu:weekly:2026-10-21T04:00Z']);
  });

  test('a tick lasts through its period, after a reload too, and clears at the next reset; daily and weekly apart', () => {
    let list = CL.tick(CL.tick(LIST, 'aaa', true, per('us', '2026-11-10T09:00:00Z')), 'bbb', true, per('us', '2026-11-10T09:00:00Z'));
    const saved = CL.sanitize(JSON.parse(JSON.stringify(list))); // as a reload reads it back
    const done = (l, iso) => l.tasks.map((x) => CL.isDone(l, x, per('us', iso)));
    assert.deepEqual(done(saved, '2026-11-10T14:59:59.999Z'), [true, true], 'still ticked a millisecond before the reset');
    assert.deepEqual(done(saved, '2026-11-10T15:00:00Z'), [false, false], 'Tuesday 15:00 UTC is both resets');
    list = CL.tick(saved, 'bbb', true, per('us', '2026-11-11T09:00:00Z'));
    list = CL.tick(list, 'aaa', true, per('us', '2026-11-11T09:00:00Z'));
    assert.deepEqual(done(list, '2026-11-11T15:00:00Z'), [false, true], 'a daily reset clears the daily tick only');
    assert.deepEqual(done(CL.tick(list, 'bbb', false, per('us', '2026-11-12T09:00:00Z')), '2026-11-12T09:00:00Z'), [false, false], 'unticked again');
    assert.deepEqual(CL.progress(list, per('us', '2026-11-11T09:00:00Z')), { daily: { done: 1, total: 1 }, weekly: { done: 1, total: 1 } });
  });

  test('ticks are kept per region and both survive a switch; tasks are shared', () => {
    const us = CL.tick(LIST, 'bbb', true, per('us', '2026-11-10T16:00:00Z'));
    assert.equal(CL.isDone(us, us.tasks[1], per('eu', '2026-11-10T16:00:00Z')), false, 'Europe has its own week');
    const both = CL.tick(us, 'bbb', true, per('eu', '2026-11-10T16:00:00Z'));
    const back = CL.prune(CL.sanitize(both), t('2026-11-10T16:00:00Z'));
    assert.equal(CL.isDone(back, back.tasks[1], per('us', '2026-11-10T16:00:00Z')), true, 'switching back finds the Americas tick');
    assert.equal(CL.isDone(back, back.tasks[1], per('eu', '2026-11-10T16:00:00Z')), true);
    assert.deepEqual(Object.keys(back.done).sort(), ['eu:weekly:2026-11-04T04:00Z', 'us:weekly:2026-11-10T15:00Z']);
    assert.equal(back.tasks.length, 2);
  });

  test('after a long gap old ticks are pruned and the list comes back unticked; a tick from a clock far ahead is dropped', () => {
    const list = CL.tick(LIST, 'bbb', true, per('us', '2026-11-10T16:00:00Z'));
    const now = t('2026-11-10T16:00:00Z');
    assert.deepEqual(Object.keys(CL.prune(list, now + 14 * S.DAY).done), ['us:weekly:2026-11-10T15:00Z'], 'two weeks later the record is still kept');
    assert.deepEqual(CL.prune(list, now + 16 * S.DAY).done, {}, 'dropped after fifteen days');
    const later = CL.prune(list, now + 30 * S.DAY);
    assert.equal(CL.isDone(later, later.tasks[1], per('us', '2026-12-10T16:00:00Z')), false);
    assert.equal(later.tasks.length, 2, 'tasks are never pruned');
    assert.deepEqual(CL.prune({ tasks: [], done: { 'us:daily:2026-12-01T15:00Z': ['x'] } }, now).done, {}, 'a period three weeks ahead');
    assert.deepEqual(Object.keys(CL.prune({ tasks: [], done: { 'us:daily:2026-11-11T15:00Z': ['x'] } }, now).done).length, 1, 'within a day ahead (a slightly fast clock) is kept');
  });

  test('add, edit and remove: plain-text names up to 60 characters, at most 40 tasks, no duplicate in one kind', () => {
    seed = 1;
    const a = CL.add(CL.defaults(), '  World\u0000 \n quests  ', 'daily', random);
    assert.equal(a.error, undefined);
    assert.deepEqual(a.list.tasks.map((x) => [x.name, x.kind]), [['World quests', 'daily']]);
    assert.match(a.list.tasks[0].id, /^[a-z0-9]{10}$/);
    assert.equal(CL.add(a.list, 'world  QUESTS', 'daily', random).error, 'exists');
    assert.equal(CL.add(a.list, 'World quests', 'weekly', random).error, undefined, 'the same name is fine in the other kind');
    assert.equal(CL.add(a.list, ' \t ', 'daily', random).error, 'empty');
    assert.equal(CL.add(a.list, 'x', 'monthly', random).error, 'kind');
    assert.equal(CL.add(a.list, 'x'.repeat(200), 'daily', random).list.tasks[1].name.length, 60);
    assert.equal(CL.cleanName(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x85)}c\td`), 'a b c d', 'line and paragraph separators too');
    assert.equal(CL.cleanName('Liadrin’s quest'), 'Liadrin’s quest', 'other characters stay as typed');
    let full = CL.defaults();
    for (let i = 0; i < 40; i++) full = CL.add(full, `Task ${i}`, 'daily', random).list;
    assert.equal(full.tasks.length, 40);
    assert.equal(new Set(full.tasks.map((x) => x.id)).size, 40, 'every id is new');
    assert.equal(CL.add(full, 'One more', 'weekly', random).error, 'full');
    const ticked = CL.tick(LIST, 'aaa', true, per('us', '2026-11-10T16:00:00Z'));
    const renamed = CL.edit(ticked, 'aaa', { name: 'World quests (main)' }).list;
    assert.equal(renamed.tasks[0].name, 'World quests (main)');
    assert.equal(CL.isDone(renamed, renamed.tasks[0], per('us', '2026-11-10T16:00:00Z')), true, 'a rename keeps the tick');
    const moved = CL.edit(ticked, 'aaa', { kind: 'weekly' }).list;
    assert.equal(moved.tasks[0].kind, 'weekly');
    assert.deepEqual(moved.done, {}, 'moved to weekly: unticked there');
    assert.equal(CL.edit(ticked, 'aaa', { name: 'claim the great VAULT', kind: 'weekly' }).error, 'exists');
    assert.equal(CL.edit(ticked, 'aaa', { name: '' }).error, 'empty');
    assert.equal(CL.edit(ticked, 'zzz', { name: 'x' }).error, 'missing');
    const gone = CL.remove(ticked, 'aaa');
    assert.deepEqual(gone.tasks.map((x) => x.id), ['bbb']);
    assert.deepEqual(gone.done, {}, 'its ticks go with it');
  });

  test('a saved checklist is checked: junk, odd ids, bad period keys and unknown ticks are dropped; nothing is added by default', () => {
    assert.deepEqual(CL.defaults(), { tasks: [], done: {} });
    for (const raw of [null, 'x', [], 7, { tasks: 'x', done: [] }]) assert.deepEqual(CL.sanitize(raw), CL.defaults());
    const raw = JSON.parse(`{"tasks": [
      {"id": "aaa", "name": "<b>Raid</b>", "kind": "weekly"},
      {"id": "aaa", "name": "Again", "kind": "daily"},
      {"id": "Bad Id", "name": "x", "kind": "daily"},
      {"id": "ccc", "name": "x", "kind": "monthly"},
      {"id": "ddd", "name": "   ", "kind": "daily"},
      {"id": "eee", "name": 42, "kind": "daily"},
      {"id": "fff", "name": "<B>RAID</B> ", "kind": "weekly"},
      "nope"],
      "done": {"__proto__": ["aaa"], "us:weekly:2026-11-10T15:00Z": ["aaa", "aaa", "zzz", 5], "us:daily:2026-11-10T15:00Z": ["aaa"],
        "xx:weekly:2026-13-45T99:00Z": ["aaa"], "us:weekly:2026-11-10T15:00": ["aaa"], "us:weekly:2026-11-03T15:00Z": "aaa"}}`);
    const s = CL.sanitize(raw);
    assert.deepEqual(s.tasks, [{ id: 'aaa', name: '<b>Raid</b>', kind: 'weekly' }], 'names stay plain text; the page never parses them');
    assert.deepEqual(s.done, { 'us:weekly:2026-11-10T15:00Z': ['aaa'] }, 'a weekly task ticked under a daily period is dropped too');
    assert.equal(Object.getPrototypeOf(s.done), Object.prototype);
    const many = { tasks: Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, name: `Task ${i}`, kind: 'daily' })), done: {} };
    assert.equal(CL.sanitize(many).tasks.length, CL.MAX_TASKS);
  });

  test('suggested tasks are optional, daily or weekly, short, and marked once they are on the list', () => {
    assert.ok(CL.TEMPLATES.length >= 8);
    assert.equal(new Set(CL.TEMPLATES.map((x) => x.id)).size, CL.TEMPLATES.length);
    for (const tpl of CL.TEMPLATES) {
      assert.ok(CL.KINDS.includes(tpl.kind), tpl.id);
      assert.equal(CL.cleanName(tpl.name), tpl.name, tpl.id);
      assert.ok(tpl.name.length <= CL.MAX_NAME, tpl.id);
    }
    assert.deepEqual(CL.KINDS.map((k) => CL.TEMPLATES.some((x) => x.kind === k)), [true, true]);
    const vault = CL.TEMPLATES.find((x) => x.id === 'vault-claim');
    assert.equal(CL.hasTemplate(CL.defaults(), vault), false);
    assert.equal(CL.hasTemplate(LIST, vault), true);
    assert.equal(CL.hasTemplate({ tasks: [{ id: 'q', name: 'Claim the Great Vault', kind: 'daily' }], done: {} }, vault), false, 'the same name as a daily task is another task');
  });

  test('the checklist starts folded; opening it is saved with the other settings', () => {
    const ids = DATA.events.map((e) => e.id), cats = DATA.categories.map((c) => c.id);
    assert.equal(Store.defaults(cats, 'UTC').checklistOpen, false);
    assert.equal(Store.sanitizePrefs({ checklistOpen: true }, ids, cats, 'UTC').checklistOpen, true);
    for (const v of [undefined, 'yes', 1, null]) assert.equal(Store.sanitizePrefs({ checklistOpen: v }, ids, cats, 'UTC').checklistOpen, false);
  });

  test('Retail keeps its storage keys; another edition would get its own', () => {
    assert.equal(Store.editionKey('checklist', 'retail'), 'checklist');
    assert.equal(Store.editionKey('prefs'), 'prefs');
    assert.equal(Store.editionKey('checklist', 'forever'), 'forever:checklist');
  });

  // ---- Settings backup ----

  const EVENT_IDS = DATA.events.map((e) => e.id), CAT_IDS = DATA.categories.map((c) => c.id);
  const clean = {
    prefs: (raw) => Store.sanitizePrefs(raw, EVENT_IDS, CAT_IDS, 'America/Chicago'),
    reminders: (raw) => Rem.sanitize(raw),
    checklist: (raw) => CL.sanitize(raw),
  };
  const PREFS = clean.prefs({ region: 'eu', starred: ['hallows-end', 'darkmoon-faire'], hidden: ['aqir-invasion'], theme: 'light', checklistOpen: true });
  const REM = { on: true, lead: 30, notify: false, hourly: true };
  const LISTED = CL.tick(LIST, 'bbb', true, per('eu', '2026-11-10T16:00:00Z'));
  const backup = () => Backup.make({ prefs: PREFS, reminders: REM, checklist: LISTED, version: '0.2.0', now: t('2026-11-10T16:00:00Z') });

  test('a backup is one line of JSON that reads back to the same settings, stars, hidden events, reminders and checklist', () => {
    const text = backup();
    assert.equal(text.includes('\n'), false);
    const r = Backup.read(text, clean);
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { prefs: PREFS, reminders: REM, checklist: LISTED });
    assert.deepEqual([r.saved, r.version, r.dropped], [t('2026-11-10T16:00:00Z'), '0.2.0', { starred: 0, hidden: 0, tasks: 0 }]);
    assert.equal(JSON.parse(text).edition, 'retail');
  });

  test('a backup that is empty, not JSON, too big, someone else\'s, newer or for another edition is refused', () => {
    const refused = (text) => Backup.read(text, clean).error;
    const good = JSON.parse(backup());
    assert.equal(refused(''), 'empty');
    assert.equal(refused('   '), 'empty');
    assert.equal(refused(null), 'empty');
    assert.equal(refused('{"app": "wowtracker", "format": 1'), 'not-json');
    assert.equal(refused('x'.repeat(Backup.MAX_CHARS + 1)), 'too-big');
    for (const v of ['[]', 'null', '7', '"wowtracker"', '{"app": "gw2timer", "format": 1, "prefs": {}}', JSON.stringify({ ...good, app: undefined })]) assert.equal(refused(v), 'not-ours', v);
    assert.equal(refused(JSON.stringify({ ...good, format: 2 })), 'format');
    assert.equal(refused(JSON.stringify({ ...good, format: '1' })), 'format');
    assert.equal(refused(JSON.stringify({ ...good, edition: 'forever' })), 'edition');
    assert.equal(Backup.read(JSON.stringify({ ...good, edition: 'forever' }), clean, 'forever').ok, true, 'read by that edition it is fine');
    assert.equal(refused('{"app": "wowtracker", "format": 1}'), 'nothing');
    for (const e of ['empty', 'too-big', 'not-json', 'not-ours', 'format', 'edition', 'nothing']) assert.ok(Backup.ERRORS[e], e);
  });

  test('a hostile or damaged backup is cleaned like saved settings: unknown ids dropped and counted, odd values back to defaults', () => {
    const raw = {
      app: 'wowtracker', format: 1, saved: 'yesterday', version: '<script>',
      prefs: { region: 'kr', starred: ['hallows-end', 'not-an-event', 'also-gone', 'hallows-end'], hidden: ['gone'], theme: 'javascript:alert(1)', aheadHours: 1e9 },
      reminders: { on: 'yes', lead: 7 },
      checklist: { tasks: [{ id: 'aaa', name: 'x'.repeat(500), kind: 'daily' }, { id: 'bad id', name: 'y', kind: 'daily' }], done: { 'constructor': ['aaa'] } },
    };
    const text = JSON.stringify(raw).replace('"region":"kr"', '"__proto__":{"polluted":true},"region":"kr"');
    assert.ok(text.includes('__proto__'));
    const r = Backup.read(text, clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.data.prefs.region, r.data.prefs.starred, r.data.prefs.hidden, r.data.prefs.theme, r.data.prefs.aheadHours], ['us', ['hallows-end'], [], 'dark', 168]);
    assert.deepEqual(r.dropped, { starred: 2, hidden: 1, tasks: 1 });
    assert.deepEqual(r.data.reminders, Rem.defaults());
    assert.deepEqual(r.data.checklist.tasks.map((x) => x.name.length), [60]);
    assert.deepEqual(r.data.checklist.done, {});
    assert.deepEqual([r.saved, r.version], [null, null]);
    assert.equal({}.polluted, undefined);
  });

  test('a backup of v0.1 settings (prefs only, with the old newsOpen) restores them, with defaults for the rest', () => {
    const r = Backup.read(JSON.stringify({ app: 'wowtracker', format: 1, prefs: { region: 'eu', starred: ['hallows-end'], newsOpen: false, compact: true } }), clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.data.prefs.region, r.data.prefs.starred, r.data.prefs.compact, r.data.prefs.newsCollapsed], ['eu', ['hallows-end'], true, false]);
    assert.deepEqual(r.data.reminders, Rem.defaults());
    assert.deepEqual(r.data.checklist, CL.defaults());
  });
}
