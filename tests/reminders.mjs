// Reminders: when each one is due, from the engine's own windows, and the settings and delivery
// records behind them. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rem = require('../js/reminders.js');
const S = require('../js/schedule.js');
const DATA = require('../events-data.js');
const FOREVER = require('../forever-data.js');

const ENGINE = { scheduleFor: S.scheduleFor, windows: S.windows, isFrequent: (s) => s.type === 'every' && s.periodMin < 1440 };
const ON = { on: true, lead: 15, notify: false, hourly: false };
const due = (iso, over = {}) => Rem.due(Object.assign({ events: DATA.events, region: 'us', now: Date.parse(iso), settings: ON, starred: ['world-boss-thormbelan'], hidden: [], engine: ENGINE }, over))
  .map((x) => `${x.event.id} ${new Date(x.start).toISOString()}`);

export function reminderTests(test) {
  test('reminder settings: off by default, 5, 15, 30 or 60 minutes, anything else falls back', () => {
    assert.deepEqual(Rem.defaults(), { on: false, lead: 15, notify: false, hourly: false });
    assert.deepEqual(Rem.sanitize({ on: true, lead: 60, notify: true, hourly: true }), { on: true, lead: 60, notify: true, hourly: true });
    for (const raw of [null, 'x', [], { on: 'yes', lead: 10, notify: 1, hourly: 'true' }, { lead: '15' }]) assert.deepEqual(Rem.sanitize(raw), Rem.defaults());
    assert.deepEqual(Rem.LEADS, [5, 15, 30, 60]);
  });

  test('a reminder is due from lead minutes before the start until the start, never before and never after', () => {
    // Thorm'belan, Americas: 2026-11-10 15:00 UTC.
    assert.deepEqual(due('2026-11-10T14:44:59.999Z'), []);
    assert.deepEqual(due('2026-11-10T14:45:00Z'), ['world-boss-thormbelan 2026-11-10T15:00:00.000Z']);
    assert.deepEqual(due('2026-11-10T14:59:59.999Z'), ['world-boss-thormbelan 2026-11-10T15:00:00.000Z']);
    assert.deepEqual(due('2026-11-10T15:00:00Z'), [], 'started: not due, not shown late');
    assert.deepEqual(due('2026-11-10T16:30:00Z'), [], 'missed while the page was closed or asleep: not shown late');
    assert.deepEqual(due('2026-11-10T14:00:00Z', { settings: { ...ON, lead: 60 } }), ['world-boss-thormbelan 2026-11-10T15:00:00.000Z']);
  });

  test('only starred, not hidden events, only when reminders are on, and in the chosen region', () => {
    assert.deepEqual(due('2026-11-10T14:50:00Z', { settings: { ...ON, on: false } }), []);
    assert.deepEqual(due('2026-11-10T14:50:00Z', { starred: [] }), []);
    assert.deepEqual(due('2026-11-10T14:50:00Z', { hidden: ['world-boss-thormbelan'] }), []);
    // Europe has the same boss a reset later: Wednesday 04:00 UTC.
    assert.deepEqual(due('2026-11-10T14:50:00Z', { region: 'eu' }), []);
    assert.deepEqual(due('2026-11-11T03:50:00Z', { region: 'eu' }), ['world-boss-thormbelan 2026-11-11T04:00:00.000Z']);
    // A holiday whose European start is a Predicted time: due at that predicted time.
    assert.deepEqual(due('2026-11-17T08:50:00Z', { region: 'eu', starred: ['wow-anniversary'] }), ['wow-anniversary 2026-11-17T09:00:00.000Z']);
    assert.deepEqual(due('2026-11-17T17:50:00Z', { region: 'us', starred: ['wow-anniversary'] }), ['wow-anniversary 2026-11-17T18:00:00.000Z']);
  });

  test('hourly events only when asked for, then once for each hour; keys differ by region, start and lead', () => {
    const aqir = { starred: ['aqir-invasion'] };
    assert.deepEqual(due('2026-11-08T16:50:00Z', aqir), [], 'hourly events are left out unless asked for');
    const hourly = { ...aqir, settings: { ...ON, hourly: true } };
    assert.deepEqual(due('2026-11-08T16:50:00Z', hourly), ['aqir-invasion 2026-11-08T17:00:00.000Z']);
    assert.deepEqual(due('2026-11-08T17:50:00Z', hourly), ['aqir-invasion 2026-11-08T18:00:00.000Z']);
    assert.deepEqual(due('2026-11-08T17:05:00Z', hourly), [], 'between reminders nothing is due');
    const [a] = Rem.due({ events: DATA.events, region: 'us', now: Date.parse('2026-11-08T16:50:00Z'), settings: { ...ON, hourly: true }, starred: ['aqir-invasion'], hidden: [], engine: ENGINE });
    assert.equal(a.key, `us|aqir-invasion|${Date.parse('2026-11-08T17:00:00Z')}|15`);
    assert.notEqual(Rem.key('eu', 'aqir-invasion', a.start, 15), a.key);
    assert.notEqual(Rem.key('us', 'aqir-invasion', a.start, 5), a.key);
  });

  test('delivery records are kept two days, and odd or future ones are dropped', () => {
    const now = Date.parse('2026-11-10T15:00:00Z'), k = Rem.key('us', 'world-boss-thormbelan', now, 15);
    assert.deepEqual(Rem.prune({ [k]: now - 3600000 }, now), { [k]: now - 3600000 });
    assert.deepEqual(Rem.prune({ [k]: now - Rem.KEEP_MS }, now), {});
    assert.deepEqual(Rem.prune({ [k]: now + 3 * 3600000 }, now), {}, 'a record from the future (a wrong clock) is not trusted');
    assert.deepEqual(Rem.prune({ 'x<script>': now, [k]: 'yesterday' }, now), {});
    for (const raw of [null, [], 'x']) assert.deepEqual(Rem.prune(raw, now), {});
  });

  test('a shown reminder stays only while it is still due: not started, starred, not hidden, same region', () => {
    const now = Date.parse('2026-11-10T14:50:00Z'), start = Date.parse('2026-11-10T15:00:00Z');
    const it = { key: Rem.key('us', 'world-boss-thormbelan', start, 15), event: { id: 'world-boss-thormbelan' }, start };
    const ctx = { region: 'us', now, starred: ['world-boss-thormbelan'], hidden: [] };
    assert.equal(Rem.stillDue(it, ctx), true);
    assert.equal(Rem.stillDue(it, { ...ctx, now: start }), false);
    assert.equal(Rem.stillDue(it, { ...ctx, region: 'eu' }), false);
    assert.equal(Rem.stillDue(it, { ...ctx, starred: [] }), false);
    assert.equal(Rem.stillDue(it, { ...ctx, hidden: ['world-boss-thormbelan'] }), false);
  });
  // ---- Editions: Retail's keys and records as in v0.2; another edition's named first ----

  test('Retail\'s reminder keys are v0.2\'s, byte for byte; Forever\'s name the edition first, so the same event at the same moment is two reminders', () => {
    const start = Date.parse('2027-02-02T09:00:00Z'); // the Lunar Festival in Europe: the same instant in both editions
    assert.equal(Rem.key('eu', 'lunar-festival', start, 15), 'eu|lunar-festival|1801558800000|15');
    assert.equal(Rem.key('eu', 'lunar-festival', start, 15, 'retail'), 'eu|lunar-festival|1801558800000|15');
    assert.equal(Rem.key('eu', 'lunar-festival', start, 15, 'forever'), 'forever|eu|lunar-festival|1801558800000|15');
    const at = (events, edition) => Rem.due({ events, region: 'eu', now: start - 10 * 60000, settings: ON, starred: ['lunar-festival'], hidden: [], engine: ENGINE, edition }).map((x) => x.key);
    assert.deepEqual(at(DATA.events), ['eu|lunar-festival|1801558800000|15']);
    assert.deepEqual(at(DATA.events, 'retail'), ['eu|lunar-festival|1801558800000|15']);
    assert.deepEqual(at(FOREVER.events, 'forever'), ['forever|eu|lunar-festival|1801558800000|15']);
  });

  test('each edition keeps only its own delivery records: Retail drops a Forever key and Forever a Retail one', () => {
    const now = Date.parse('2027-02-02T09:00:00Z'), r = Rem.key('eu', 'lunar-festival', now, 15), f = Rem.key('eu', 'lunar-festival', now, 15, 'forever');
    const both = { [r]: now - 60000, [f]: now - 60000 };
    assert.deepEqual(Rem.prune(both, now), { [r]: now - 60000 });
    assert.deepEqual(Rem.prune(both, now, 'retail'), { [r]: now - 60000 });
    assert.deepEqual(Rem.prune(both, now, 'forever'), { [f]: now - 60000 });
    assert.deepEqual(Rem.prune({ 'classic|eu|x|1|15': now, 'forever|eu|x|1': now, 'forever|eu|lunar-festival|1|15|9': now }, now, 'forever'), {});
  });

  test('a shown reminder stays only in its own edition: a Retail item is not due on a Forever page, nor the reverse', () => {
    const now = Date.parse('2027-02-02T08:50:00Z'), start = Date.parse('2027-02-02T09:00:00Z');
    const ctx = { region: 'eu', now, starred: ['lunar-festival'], hidden: [] };
    const retail = { key: Rem.key('eu', 'lunar-festival', start, 15), event: { id: 'lunar-festival' }, start };
    const forever = { key: Rem.key('eu', 'lunar-festival', start, 15, 'forever'), event: { id: 'lunar-festival' }, start };
    assert.deepEqual([Rem.stillDue(retail, ctx), Rem.stillDue(retail, { ...ctx, edition: 'retail' }), Rem.stillDue(retail, { ...ctx, edition: 'forever' })], [true, true, false]);
    assert.deepEqual([Rem.stillDue(forever, ctx), Rem.stillDue(forever, { ...ctx, edition: 'forever' }), Rem.stillDue(forever, { ...ctx, edition: 'forever', region: 'us' })], [false, true, false]);
  });
}
