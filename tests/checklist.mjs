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

  // ---- Settings backup (format 2: shared settings, reminders and each edition; format 1 from v0.1 and v0.2) ----

  const FOREVER = require('../forever-data.js');
  const editionClean = (data) => ({ prefs: (raw) => Store.sanitizeEditionPrefs(raw, data.events.map((e) => e.id), data.categories.map((c) => c.id)), checklist: (raw) => CL.sanitize(raw), leads: (raw) => Rem.sanitizeLeads(raw, data.events.map((e) => e.id)) });
  const clean = {
    shared: (raw) => Store.sanitizeShared(raw, 'America/Chicago'),
    reminders: (raw) => Rem.sanitize(raw),
    editions: { retail: editionClean(DATA), forever: editionClean(FOREVER) },
  };
  const ALL = Store.sanitizePrefs({ region: 'eu', starred: ['hallows-end', 'darkmoon-faire'], hidden: ['aqir-invasion'], theme: 'light', checklistOpen: true }, DATA.events.map((e) => e.id), DATA.categories.map((c) => c.id), 'America/Chicago');
  const SHARED = Store.sanitizeShared(ALL, 'America/Chicago');
  const RETAIL_OWN = Store.editionPrefs(ALL);
  const FOREVER_OWN = clean.editions.forever.prefs({ starred: ['stranglethorn-fishing-extravaganza', 'darkmoon-faire'], hidden: ['fireworks-spectacular'], categories: ['holiday', 'darkmoon'], filter: 'starred' });
  const REM = { on: true, lead: 30, notify: false, hourly: true };
  const LISTED = CL.tick(LIST, 'bbb', true, per('eu', '2026-11-10T16:00:00Z'));
  const FOREVER_LIST = { tasks: [{ id: 'fff', name: 'Dedicated Study', kind: 'daily' }], done: { 'us:daily:2026-11-09T15:00Z': ['fff'] } };
  const backup = (editions = { retail: { prefs: RETAIL_OWN, checklist: LISTED }, forever: { prefs: FOREVER_OWN, checklist: FOREVER_LIST } }) =>
    Backup.make({ shared: SHARED, reminders: REM, editions, version: '0.3.0', now: t('2026-11-10T16:00:00Z') });
  // What v0.2.0 itself writes (format 1, one edition, prefs whole).
  const V020 = JSON.stringify({ app: 'wowtracker', format: 1, edition: 'retail', version: '0.2.0', saved: '2026-11-10T16:00:00.000Z', prefs: ALL, reminders: REM, checklist: LISTED });

  test('a backup (format 2) is one line of JSON holding the shared settings, the reminders and each edition apart, and reads back to the same', () => {
    const text = backup();
    assert.equal(text.includes('\n'), false);
    const raw = JSON.parse(text);
    assert.deepEqual(Object.keys(raw), ['app', 'format', 'version', 'saved', 'shared', 'editions']);
    assert.deepEqual([raw.format, Object.keys(raw.shared), Object.keys(raw.editions)], [2, ['prefs', 'reminders'], ['retail', 'forever']]);
    assert.deepEqual(Object.keys(raw.shared.prefs).sort(), [...Store.SHARED_PREFS].sort(), 'shared: only shared settings');
    for (const e of ['retail', 'forever']) assert.deepEqual(Object.keys(raw.editions[e].prefs).sort(), [...Store.EDITION_PREFS].sort(), `${e}: only its own choices`);
    const r = Backup.read(text, clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.format, r.shared, r.reminders], [2, SHARED, REM]);
    // Made before v0.5: no reminder times of single events in it, which reads as null (kept as they are), not as none.
    assert.deepEqual(r.editions, { retail: { prefs: RETAIL_OWN, checklist: LISTED, leads: null }, forever: { prefs: FOREVER_OWN, checklist: FOREVER_LIST, leads: null } });
    assert.deepEqual([r.saved, r.version, r.unknown], [t('2026-11-10T16:00:00Z'), '0.3.0', []]);
    assert.deepEqual(r.dropped, { retail: { starred: 0, hidden: 0, tasks: 0 }, forever: { starred: 0, hidden: 0, tasks: 0 } });
  });

  test('a v0.2 backup (format 1) restores the shared settings, the reminders and Retail only: Forever is not in it, so nothing of Forever\'s is replaced', () => {
    const r = Backup.read(V020, clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.format, r.shared, r.reminders], [1, SHARED, REM]);
    assert.deepEqual(Object.keys(r.editions), ['retail'], 'Forever is left as it is');
    assert.deepEqual(r.editions.retail, { prefs: RETAIL_OWN, checklist: LISTED, leads: null });
    // Put back together, the shared and Retail parts are exactly what v0.2 had in "prefs".
    assert.deepEqual({ ...r.shared, ...r.editions.retail.prefs }, ALL);
    // One without an edition (v0.1) is Retail's; one naming Forever (a v0.3 development copy) is Forever's, checked against Forever's events.
    assert.deepEqual(Object.keys(Backup.read(JSON.stringify({ ...JSON.parse(V020), edition: undefined }), clean).editions), ['retail']);
    const f = Backup.read(JSON.stringify({ app: 'wowtracker', format: 1, edition: 'forever', prefs: { starred: ['stranglethorn-fishing-extravaganza', 'hallows-end', 'aqir-invasion'] } }), clean);
    assert.deepEqual([Object.keys(f.editions), f.editions.forever.prefs.starred, f.dropped.forever.starred], [['forever'], ['stranglethorn-fishing-extravaganza', 'hallows-end'], 1], "Retail's Aqir Invasion is not a Forever event");
  });

  test('each edition is checked against its own events: a Retail id in the Forever part (or the reverse) is dropped and counted, never moved across', () => {
    const raw = JSON.parse(backup());
    raw.editions.forever.prefs.starred = ['stranglethorn-fishing-extravaganza', 'world-boss-luashal'];
    raw.editions.retail.prefs.hidden = ['stranglethorn-fishing-extravaganza', 'aqir-invasion'];
    const r = Backup.read(JSON.stringify(raw), clean);
    assert.deepEqual([r.editions.forever.prefs.starred, r.editions.retail.prefs.hidden], [['stranglethorn-fishing-extravaganza'], ['aqir-invasion']]);
    assert.deepEqual([r.dropped.forever.starred, r.dropped.retail.hidden], [1, 1]);
    assert.equal(r.editions.retail.prefs.starred.includes('stranglethorn-fishing-extravaganza'), false);
  });

  test('a backup with only some parts restores only those: no shared part leaves the shared settings and reminders; a missing edition is left as it is', () => {
    const raw = JSON.parse(backup({ forever: { prefs: FOREVER_OWN, checklist: FOREVER_LIST } }));
    let r = Backup.read(JSON.stringify(raw), clean);
    assert.deepEqual(Object.keys(r.editions), ['forever']);
    delete raw.shared;
    r = Backup.read(JSON.stringify(raw), clean);
    assert.deepEqual([r.ok, r.shared, r.reminders, Object.keys(r.editions)], [true, null, null, ['forever']]);
    // An edition this version does not have is named and left out; alone, it is refused.
    raw.editions.classic = { prefs: { starred: ['x'] } };
    raw.editions['<b>'] = {};
    r = Backup.read(JSON.stringify(raw), clean);
    assert.deepEqual([r.ok, r.unknown, Object.keys(r.editions)], [true, ['classic', 'unnamed'], ['forever']]);
    assert.equal(Backup.read(JSON.stringify({ app: 'wowtracker', format: 2, editions: { classic: {} } }), clean).error, 'edition');
  });

  test('single events\' reminder times travel in a backup, each edition\'s apart and checked against its own events; a backup without them leaves them alone', () => {
    const text = backup({ retail: { prefs: RETAIL_OWN, checklist: LISTED, reminderLeads: { 'darkmoon-faire': 1440, 'hallows-end': 30 } }, forever: { prefs: FOREVER_OWN, checklist: FOREVER_LIST, reminderLeads: { 'stranglethorn-fishing-extravaganza': 60 } } });
    const raw = JSON.parse(text);
    assert.deepEqual([raw.format, Object.keys(raw.editions.retail), Object.keys(raw.shared.reminders)], [2, ['prefs', 'checklist', 'reminderLeads'], ['on', 'lead', 'notify', 'hourly']], 'still format 2; the shared reminder settings are as they were');
    let r = Backup.read(text, clean);
    assert.deepEqual([r.editions.retail.leads, r.editions.forever.leads], [{ 'darkmoon-faire': 1440, 'hallows-end': 30 }, { 'stranglethorn-fishing-extravaganza': 60 }]);
    assert.deepEqual(r.reminders, REM, 'the setting itself is untouched by them');
    // None set is said as none, and replaces; absent (an older backup) is null, and replaces nothing.
    r = Backup.read(backup({ retail: { prefs: RETAIL_OWN, checklist: LISTED, reminderLeads: {} } }), clean);
    assert.deepEqual(r.editions.retail.leads, {});
    assert.equal(Backup.read(backup(), clean).editions.retail.leads, null);
    assert.equal(Backup.read(V020, clean).editions.retail.leads, null, 'a v0.2 backup');
    // Cleaned like saved ones: another edition's event, an event that is gone, a lead not offered, a wrong shape.
    raw.editions.retail.reminderLeads = { 'darkmoon-faire': 45, 'stranglethorn-fishing-extravaganza': 30, 'not-an-event': 15, 'hallows-end': 5, 'wow-anniversary': '60' };
    raw.editions.forever.reminderLeads = ['stranglethorn-fishing-extravaganza', 60];
    r = Backup.read(JSON.stringify(raw), clean);
    assert.deepEqual([r.ok, r.editions.retail.leads, r.editions.forever.leads], [true, { 'hallows-end': 5 }, {}]);
    raw.editions.retail.reminderLeads = null;
    assert.deepEqual(Backup.read(JSON.stringify(raw), clean).editions.retail.leads, {}, 'present but empty or damaged: none, as the backup says');
    // A reader of backups that knows nothing of them (v0.4's own cleaners) reads the rest exactly as before.
    const v04 = { ...clean, editions: { retail: { prefs: clean.editions.retail.prefs, checklist: clean.editions.retail.checklist }, forever: { prefs: clean.editions.forever.prefs, checklist: clean.editions.forever.checklist } } };
    const old = Backup.read(text, v04);
    assert.deepEqual([old.ok, old.editions.retail.prefs, old.editions.retail.checklist, old.editions.retail.leads, old.reminders], [true, RETAIL_OWN, LISTED, null, REM]);
  });

  test('a backup that is empty, not JSON, too big, someone else\'s, newer, damaged or for a game version this page lacks is refused', () => {
    const refused = (text) => Backup.read(text, clean).error;
    const good = JSON.parse(backup());
    assert.equal(refused(''), 'empty');
    assert.equal(refused('   '), 'empty');
    assert.equal(refused(null), 'empty');
    assert.equal(refused('{"app": "wowtracker", "format": 2'), 'not-json');
    assert.equal(refused('x'.repeat(Backup.MAX_CHARS + 1)), 'too-big');
    for (const v of ['[]', 'null', '7', '"wowtracker"', '{"app": "gw2timer", "format": 2, "shared": {}}', JSON.stringify({ ...good, app: undefined })]) assert.equal(refused(v), 'not-ours', v);
    for (const f of [3, '2', 0, null, 1.5]) assert.equal(refused(JSON.stringify({ ...good, format: f })), 'format', String(f));
    assert.equal(refused(JSON.stringify({ ...good, shared: [] })), 'damaged');
    assert.equal(refused(JSON.stringify({ ...good, editions: 'retail' })), 'damaged');
    assert.equal(refused(JSON.stringify({ ...good, editions: { retail: [] } })), 'damaged');
    assert.equal(refused(JSON.stringify({ ...JSON.parse(V020), edition: 'classic' })), 'edition');
    assert.equal(refused('{"app": "wowtracker", "format": 1}'), 'nothing');
    assert.equal(refused('{"app": "wowtracker", "format": 2}'), 'nothing');
    assert.equal(refused('{"app": "wowtracker", "format": 2, "editions": {}}'), 'nothing');
    for (const e of ['empty', 'too-big', 'not-json', 'not-ours', 'format', 'edition', 'damaged', 'nothing']) assert.ok(Backup.ERRORS[e], e);
  });

  test('a hostile or damaged backup is cleaned like saved settings: unknown ids dropped and counted, odd values back to defaults, nothing polluted', () => {
    const raw = {
      app: 'wowtracker', format: 2, saved: 'yesterday', version: '<script>',
      shared: { prefs: { region: 'kr', theme: 'javascript:alert(1)', aheadHours: 1e9 }, reminders: { on: 'yes', lead: 7 } },
      editions: {
        retail: { prefs: { starred: ['hallows-end', 'not-an-event', 'also-gone', 'hallows-end'], hidden: ['gone'] }, checklist: { tasks: [{ id: 'aaa', name: 'x'.repeat(500), kind: 'daily' }, { id: 'bad id', name: 'y', kind: 'daily' }], done: { constructor: ['aaa'] } } },
        forever: { prefs: 'all of them', checklist: 7 },
      },
    };
    const text = JSON.stringify(raw).replace('"region":"kr"', '"__proto__":{"polluted":true},"region":"kr"').replace('"editions":{', '"editions":{"__proto__":{"polluted":true},');
    assert.equal((text.match(/__proto__/g) || []).length, 2);
    const r = Backup.read(text, clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.shared.region, r.shared.theme, r.shared.aheadHours], ['us', 'dark', 168]);
    assert.deepEqual([r.editions.retail.prefs.starred, r.editions.retail.prefs.hidden], [['hallows-end'], []]);
    assert.deepEqual(r.dropped.retail, { starred: 2, hidden: 1, tasks: 1 });
    assert.deepEqual(r.reminders, Rem.defaults());
    assert.deepEqual(r.editions.retail.checklist.tasks.map((x) => x.name.length), [60]);
    assert.deepEqual(r.editions.retail.checklist.done, {});
    assert.deepEqual(r.editions.forever, { prefs: clean.editions.forever.prefs(null), checklist: CL.defaults(), leads: null });
    assert.deepEqual([r.saved, r.version, r.unknown], [null, null, ['unnamed']]);
    assert.equal({}.polluted, undefined);
  });

  test('a backup of v0.1 settings (prefs only, with the old newsOpen) restores them, with defaults for the rest', () => {
    const r = Backup.read(JSON.stringify({ app: 'wowtracker', format: 1, prefs: { region: 'eu', starred: ['hallows-end'], newsOpen: false, compact: true } }), clean);
    assert.equal(r.ok, true);
    assert.deepEqual([r.shared.region, r.editions.retail.prefs.starred, r.shared.compact, r.shared.newsCollapsed], ['eu', ['hallows-end'], true, false]);
    assert.deepEqual(r.reminders, Rem.defaults());
    assert.deepEqual(r.editions.retail.checklist, CL.defaults());
  });
}
