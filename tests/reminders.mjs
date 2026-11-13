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

  // ---- v0.5: a lead of an event's own, and the list of what is coming ----

  const t = (isoText) => Date.parse(isoText), iso = (ms) => (ms === null ? null : new Date(ms).toISOString().replace('.000Z', 'Z'));
  const IDS = DATA.events.map((e) => e.id), FOREVER_IDS = FOREVER.events.map((e) => e.id);
  const keysDue = (isoText, over = {}) => Rem.due(Object.assign({ events: DATA.events, region: 'us', now: t(isoText), settings: ON, starred: ['world-boss-thormbelan'], hidden: [], engine: ENGINE }, over)).map((x) => x.key);
  const THORM = t('2026-11-10T15:00:00Z');

  test('the settings are what they always were: no new field, the same four leads, and v0.4\'s saved settings read back unchanged', () => {
    assert.deepEqual(Rem.LEADS, [5, 15, 30, 60]);
    assert.deepEqual(Object.keys(Rem.sanitize({ on: true, lead: 30, notify: true, hourly: false, leads: { x: 5 }, extra: 1 })), ['on', 'lead', 'notify', 'hourly']);
    for (const saved of [{ on: true, lead: 5, notify: false, hourly: true }, { on: false, lead: 60, notify: true, hourly: false }]) assert.deepEqual(Rem.sanitize(saved), saved);
    assert.deepEqual(Rem.sanitize({ on: true, lead: 120 }).lead, 15, 'the longer leads are for single events only');
    assert.deepEqual(Rem.EVENT_LEADS, [5, 15, 30, 60, 120, 1440]);
    assert.deepEqual([5, 15, 60, 120, 1440].map(Rem.leadText), ['5 minutes', '15 minutes', '60 minutes', '2 hours', '1 day']);
  });

  test('an event\'s own lead: only for events the edition has and only leads that are offered; anything else is left out and the event follows the setting', () => {
    assert.deepEqual(Rem.sanitizeLeads({ 'darkmoon-faire': 1440, 'world-boss-thormbelan': 5 }, IDS), { 'darkmoon-faire': 1440, 'world-boss-thormbelan': 5 });
    assert.deepEqual(Rem.sanitizeLeads({ 'darkmoon-faire': 45, 'wow-anniversary': '30', 'feast-of-winter-veil': null, 'not-an-event': 15, 'aqir-invasion': -5, timewalking: 1e9, 'lunar-festival': 30.5 }, IDS), {});
    for (const raw of [null, undefined, 'x', 7, [], [['darkmoon-faire', 30]]]) assert.deepEqual(Rem.sanitizeLeads(raw, IDS), {});
    // An id only the other edition has is stale here; names from Object.prototype are never ids.
    assert.deepEqual(Rem.sanitizeLeads({ 'stranglethorn-fishing-extravaganza': 30, 'darkmoon-faire': 30 }, IDS), { 'darkmoon-faire': 30 });
    assert.deepEqual(Rem.sanitizeLeads({ 'stranglethorn-fishing-extravaganza': 30, 'aqir-invasion': 30 }, FOREVER_IDS), { 'stranglethorn-fishing-extravaganza': 30 });
    assert.deepEqual(Rem.sanitizeLeads(JSON.parse('{"__proto__":{"darkmoon-faire":30},"constructor":15}'), IDS.concat('constructor', '__proto__')), { constructor: 15 }, 'own entries only');
    assert.deepEqual(Rem.sanitizeLeads({ 'darkmoon-faire': 30 }, []), {});
    // The lead in force.
    const set = { ...ON, lead: 30 };
    assert.deepEqual(Rem.leadFor('darkmoon-faire', set, { 'darkmoon-faire': 1440 }, false), { minutes: 1440, own: true });
    assert.deepEqual(Rem.leadFor('darkmoon-faire', set, {}, false), { minutes: 30, own: false });
    assert.deepEqual(Rem.leadFor('darkmoon-faire', set, null, false), { minutes: 30, own: false });
    assert.deepEqual(Rem.leadFor('darkmoon-faire', set, { 'darkmoon-faire': 30 }, false), { minutes: 30, own: true }, 'its own, even when equal to the setting: it stays when the setting changes');
    assert.deepEqual(Rem.leadFor('darkmoon-faire', set, { 'darkmoon-faire': 7 }, false), { minutes: 30, own: false });
    assert.deepEqual(Rem.leadFor('toString', set, {}, false), { minutes: 30, own: false });
    // An event that repeats every hour or more often is not given a lead longer than an hour.
    assert.deepEqual([Rem.choices(true), Rem.choices(false)], [[5, 15, 30, 60], [5, 15, 30, 60, 120, 1440]]);
    assert.deepEqual(Rem.leadFor('aqir-invasion', set, { 'aqir-invasion': 1440 }, true), { minutes: 30, own: false });
    assert.deepEqual(Rem.leadFor('aqir-invasion', set, { 'aqir-invasion': 5 }, true), { minutes: 5, own: true });
  });

  test('the setting against an event\'s own lead: each event is due at its own time, the key names the lead used, and an event without one follows the setting', () => {
    const own = { leads: { 'world-boss-thormbelan': 60 } };
    assert.deepEqual(keysDue('2026-11-10T13:59:59.999Z', own), []);
    assert.deepEqual(keysDue('2026-11-10T14:00:00Z', own), [`us|world-boss-thormbelan|${THORM}|60`]);
    assert.deepEqual(keysDue('2026-11-10T14:00:00Z'), [], 'the setting alone: not for another 45 minutes');
    assert.deepEqual(keysDue('2026-11-10T14:45:00Z'), [`us|world-boss-thormbelan|${THORM}|15`], 'without its own lead the key is v0.4\'s, byte for byte');
    // Shorter than the setting: later, not at the setting's time.
    assert.deepEqual(keysDue('2026-11-10T14:50:00Z', { leads: { 'world-boss-thormbelan': 5 } }), []);
    assert.deepEqual(keysDue('2026-11-10T14:55:00Z', { leads: { 'world-boss-thormbelan': 5 } }), [`us|world-boss-thormbelan|${THORM}|5`]);
    // A day and two hours.
    assert.deepEqual(keysDue('2026-11-09T15:00:00Z', { leads: { 'world-boss-thormbelan': 1440 } }), [`us|world-boss-thormbelan|${THORM}|1440`]);
    assert.deepEqual(keysDue('2026-11-09T14:59:59.999Z', { leads: { 'world-boss-thormbelan': 1440 } }), []);
    assert.deepEqual(keysDue('2026-11-10T13:00:00Z', { leads: { 'world-boss-thormbelan': 120 } }), [`us|world-boss-thormbelan|${THORM}|120`]);
    // Another event's lead changes nothing here; an invalid or stale one falls back to the setting.
    assert.deepEqual(keysDue('2026-11-10T14:00:00Z', { leads: { 'darkmoon-faire': 60 } }), []);
    for (const bad of [{ 'world-boss-thormbelan': 45 }, { 'world-boss-thormbelan': '60' }, { 'world-boss-thormbelan': null }, 'x', null, []]) {
      assert.deepEqual(keysDue('2026-11-10T14:00:00Z', { leads: bad }), [], JSON.stringify(bad));
      assert.deepEqual(keysDue('2026-11-10T14:45:00Z', { leads: bad }), [`us|world-boss-thormbelan|${THORM}|15`], JSON.stringify(bad));
    }
    // Never after the start, whatever the lead; and nothing at all while reminders are off.
    assert.deepEqual(keysDue('2026-11-10T15:00:00Z', { leads: { 'world-boss-thormbelan': 1440 } }), []);
    assert.deepEqual(keysDue('2026-11-10T14:30:00Z', { ...own, settings: { ...ON, on: false } }), []);
  });

  test('both regions and both editions keep their own times and keys with an event\'s own lead', () => {
    const own = { leads: { 'wow-anniversary': 120 }, starred: ['wow-anniversary'] };
    assert.deepEqual(keysDue('2026-11-17T16:00:00Z', own), [`us|wow-anniversary|${t('2026-11-17T18:00:00Z')}|120`]);
    assert.deepEqual(keysDue('2026-11-17T07:00:00Z', { ...own, region: 'eu' }), [`eu|wow-anniversary|${t('2026-11-17T09:00:00Z')}|120`]);
    assert.deepEqual(keysDue('2026-11-17T07:00:00Z', own), [], 'Europe\'s time is not the Americas\'');
    const fish = { events: FOREVER.events, edition: 'forever', starred: ['stranglethorn-fishing-extravaganza'], leads: { 'stranglethorn-fishing-extravaganza': 30 } };
    assert.deepEqual(keysDue('2026-11-15T19:30:00Z', fish), [`forever|us|stranglethorn-fishing-extravaganza|${t('2026-11-15T20:00:00Z')}|30`]);
    assert.deepEqual(keysDue('2026-11-15T12:30:00Z', { ...fish, region: 'eu' }), [`forever|eu|stranglethorn-fishing-extravaganza|${t('2026-11-15T13:00:00Z')}|30`]);
    // The same event id in both editions: each edition's leads are its own object, so one never reaches the other.
    const lunar = t('2027-02-02T09:00:00Z'), at = (events, edition, leads) => Rem.due({ events, region: 'eu', now: lunar - 50 * 60000, settings: ON, leads, starred: ['lunar-festival'], hidden: [], engine: ENGINE, edition }).map((x) => x.key);
    assert.deepEqual(at(DATA.events, 'retail', { 'lunar-festival': 60 }), [`eu|lunar-festival|${lunar}|60`]);
    assert.deepEqual(at(FOREVER.events, 'forever', {}), [], 'Forever has no lead of its own for it: the setting, 15 minutes');
    assert.deepEqual(at(FOREVER.events, 'forever', { 'lunar-festival': 60 }), [`forever|eu|lunar-festival|${lunar}|60`]);
  });

  test('daylight saving: a lead is elapsed time, so a reminder a day before a contest on the day the clocks change comes 24 hours before, and server-clock starts move with their zone', () => {
    const fish = (region, isoText, lead) => Rem.due({ events: FOREVER.events, region, now: t(isoText), settings: ON, leads: { 'stranglethorn-fishing-extravaganza': lead }, starred: ['stranglethorn-fishing-extravaganza'], hidden: [], engine: ENGINE, edition: 'forever' }).map((x) => iso(x.start));
    // Americas: clocks go forward on Sunday March 14, 2027, so 14:00 server time is 19:00 UTC that day (20:00 the week before).
    assert.deepEqual(fish('us', '2027-03-13T18:59:59.999Z', 1440), []);
    assert.deepEqual(fish('us', '2027-03-13T19:00:00Z', 1440), ['2027-03-14T19:00:00Z'], 'exactly 24 hours before, which is 1:00 PM the day before on the server clock');
    assert.deepEqual(fish('us', '2027-03-14T18:00:00Z', 60), ['2027-03-14T19:00:00Z']);
    assert.deepEqual(fish('us', '2027-03-14T17:59:59.999Z', 60), []);
    assert.deepEqual(fish('us', '2027-03-07T19:00:00Z', 60), ['2027-03-07T20:00:00Z'], 'the week before, in standard time');
    // Europe: March 28, 2027, 14:00 server time is 12:00 UTC (13:00 the week before).
    assert.deepEqual(fish('eu', '2027-03-27T12:00:00Z', 1440), ['2027-03-28T12:00:00Z']);
    assert.deepEqual(fish('eu', '2027-03-27T11:59:59.999Z', 1440), []);
    assert.deepEqual(fish('eu', '2027-03-21T12:45:00Z', 15), ['2027-03-21T13:00:00Z']);
    // Retail, the Darkmoon Faire's first Sunday on the night the Americas' clocks go back (November 1, 2026, 07:00 UTC).
    const faire = (isoText, lead) => Rem.due({ events: DATA.events, region: 'us', now: t(isoText), settings: ON, leads: { 'darkmoon-faire': lead }, starred: ['darkmoon-faire'], hidden: [], engine: ENGINE }).map((x) => iso(x.start));
    assert.deepEqual(faire('2026-10-31T07:00:00Z', 1440), ['2026-11-01T07:00:00Z']);
    assert.deepEqual(faire('2026-10-31T06:59:59.999Z', 1440), []);
    assert.deepEqual(faire('2026-11-01T05:00:00Z', 120), ['2026-11-01T07:00:00Z'], 'two elapsed hours before, across the repeated hour');
    assert.deepEqual(faire('2026-11-01T04:59:59.999Z', 120), []);
  });

  test('simultaneous events: each follows its own lead, and those due together always come in the same order', () => {
    // The Americas' weekly reset of November 17, 2026 starts both Predaxas and Legion Timewalking at 15:00 UTC.
    const both = { starred: ['timewalking', 'world-boss-predaxas'] }, start = t('2026-11-17T15:00:00Z');
    assert.deepEqual(keysDue('2026-11-17T14:50:00Z', both), [`us|timewalking|${start}|15`, `us|world-boss-predaxas|${start}|15`], 'at one start: by name (Legion Timewalking, Predaxas)');
    assert.deepEqual(keysDue('2026-11-17T14:50:00Z', { ...both, starred: [...both.starred].reverse() }), [`us|timewalking|${start}|15`, `us|world-boss-predaxas|${start}|15`], 'whatever the order they were starred in');
    assert.deepEqual(keysDue('2026-11-17T14:10:00Z', { ...both, leads: { 'world-boss-predaxas': 60 } }), [`us|world-boss-predaxas|${start}|60`], 'only the one whose lead has come');
    assert.deepEqual(keysDue('2026-11-17T14:50:00Z', { ...both, leads: { 'world-boss-predaxas': 60 } }), [`us|timewalking|${start}|15`, `us|world-boss-predaxas|${start}|60`]);
    // Two entries that tie on start and name still have one order: by id.
    const twin = (id) => ({ id, name: 'Twin', category: 'holiday', schedules: { us: { type: 'dates', windows: [{ start: '2026-11-17T15:00:00Z', end: '2026-11-17T16:00:00Z' }] } } });
    for (const events of [[twin('b-twin'), twin('a-twin')], [twin('a-twin'), twin('b-twin')]]) {
      assert.deepEqual(Rem.due({ events, region: 'us', now: start - 60000, settings: ON, starred: ['a-twin', 'b-twin'], hidden: [], engine: ENGINE }).map((x) => x.event.id), ['a-twin', 'b-twin']);
      assert.deepEqual(Rem.upcoming({ events, region: 'us', now: start - 3600000, settings: ON, starred: ['b-twin', 'a-twin'], hidden: [], engine: ENGINE }).map((x) => x.event.id), ['a-twin', 'b-twin']);
    }
  });

  test('one occurrence is delivered once whatever its lead: a record under any lead counts, another start, region, event or edition does not', () => {
    const k15 = Rem.key('us', 'world-boss-thormbelan', THORM, 15), rec = { [k15]: THORM - 900000 };
    assert.equal(Rem.occurrence(k15), `us|world-boss-thormbelan|${THORM}`);
    assert.equal(Rem.occurrence(Rem.key('eu', 'lunar-festival', 5, 60, 'forever')), 'forever|eu|lunar-festival|5');
    assert.equal(Rem.wasDelivered(rec, k15), true);
    for (const lead of [5, 30, 60, 120, 1440]) assert.equal(Rem.wasDelivered(rec, Rem.key('us', 'world-boss-thormbelan', THORM, lead)), true, `lead ${lead}: the lead was changed after it was shown`);
    assert.equal(Rem.wasDelivered(rec, Rem.key('us', 'world-boss-thormbelan', THORM + 3600000, 15)), false, 'a moved start is another occurrence');
    assert.equal(Rem.wasDelivered(rec, Rem.key('eu', 'world-boss-thormbelan', THORM, 15)), false);
    assert.equal(Rem.wasDelivered(rec, Rem.key('us', 'world-boss-thormbelan-2', THORM, 15)), false);
    assert.equal(Rem.wasDelivered(rec, Rem.key('us', 'world-boss-thormbelan', THORM, 15, 'forever')), false);
    assert.equal(Rem.wasDelivered({ [Rem.key('us', 'world-boss-thormbelan', THORM, 15, 'forever')]: 1 }, k15), false);
    assert.equal(Rem.wasDelivered({ [`us|world-boss-thormbelan|${THORM}1|15`]: 1 }, k15), false, 'a start that only begins the same way');
    for (const none of [null, undefined, [], 'x', {}]) assert.equal(Rem.wasDelivered(none, k15), false);
    // Records written by v0.4 (the same key form) still count, and the long leads' keys are kept and pruned like any other.
    assert.deepEqual(Rem.prune({ [Rem.key('us', 'world-boss-thormbelan', THORM, 1440)]: THORM - 86400000 }, THORM), { [`us|world-boss-thormbelan|${THORM}|1440`]: THORM - 86400000 }, 'shown a day before: still on record at the start');
    assert.deepEqual(Rem.prune({ [Rem.key('us', 'world-boss-thormbelan', THORM, 1440)]: THORM - 86400000 }, THORM + 86400000), {});
  });

  test('a changed or removed window: the reminder follows the schedule as it is now, an old record never blocks the new time, and nothing is left for a window that is gone', () => {
    const moved = structuredClone(DATA.events), ann = moved.find((e) => e.id === 'wow-anniversary');
    const was = t('2026-11-17T18:00:00Z'), now = t('2026-11-17T19:00:00Z');
    ann.schedules.us.windows[0].start = '2026-11-17T19:00:00Z'; // an hour later
    const args = (events, isoText, extra = {}) => ({ events, region: 'us', now: t(isoText), settings: ON, starred: ['wow-anniversary'], hidden: [], engine: ENGINE, ...extra });
    assert.deepEqual(Rem.due(args(DATA.events, '2026-11-17T17:50:00Z')).map((x) => x.key), [`us|wow-anniversary|${was}|15`]);
    assert.deepEqual(Rem.due(args(moved, '2026-11-17T17:50:00Z')), [], 'nothing at the old time');
    const [it] = Rem.due(args(moved, '2026-11-17T18:50:00Z'));
    assert.equal(it.key, `us|wow-anniversary|${now}|15`);
    assert.equal(Rem.wasDelivered({ [`us|wow-anniversary|${was}|15`]: was - 600000 }, it.key), false, 'shown for the old time: the new time still reminds');
    assert.deepEqual(Rem.upcoming(args(moved, '2026-11-17T12:00:00Z')).map((r) => [iso(r.start), iso(r.trigger)]), [['2026-11-17T19:00:00Z', '2026-11-17T18:45:00Z']]);
    // Removed: the window is gone from the data, so nothing is due and the list says nothing more is scheduled.
    const gone = structuredClone(DATA.events);
    gone.find((e) => e.id === 'wow-anniversary').schedules.us.windows = [];
    assert.deepEqual(Rem.due(args(gone, '2026-11-17T17:50:00Z')), []);
    assert.deepEqual(Rem.upcoming(args(gone, '2026-11-17T12:00:00Z', { leads: { 'wow-anniversary': 60 } })).map((r) => [r.state, r.start, r.trigger, r.key, r.lead, r.own]), [['none', null, null, null, 60, true]]);
    // An event gone from the data altogether: its star and its lead are simply not there to act on.
    const without = DATA.events.filter((e) => e.id !== 'wow-anniversary');
    assert.deepEqual(Rem.upcoming(args(without, '2026-11-17T12:00:00Z')), []);
    assert.deepEqual(Rem.sanitizeLeads({ 'wow-anniversary': 60 }, without.map((e) => e.id)), {});
  });

  test('upcoming reminders: the next start of each starred event with its reminder time, lead and state, soonest reminder first', () => {
    const now = t('2026-11-10T18:00:00Z');
    const up = (over = {}) => Rem.upcoming(Object.assign({ events: DATA.events, region: 'us', now, settings: ON, leads: {}, starred: ['darkmoon-faire', 'wow-anniversary', 'timewalking', 'world-boss-predaxas', 'aqir-invasion'], hidden: [], engine: ENGINE }, over));
    const brief = (rows) => rows.map((r) => `${r.event.id} ${r.state} ${iso(r.start)} ${iso(r.trigger)} ${r.lead}${r.own ? ' own' : ''}`);
    assert.deepEqual(brief(up()), [
      'aqir-invasion hourly 2026-11-10T19:00:00Z 2026-11-10T18:45:00Z 15',
      'timewalking on 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15',
      'world-boss-predaxas on 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15',
      'wow-anniversary on 2026-11-17T18:00:00Z 2026-11-17T17:45:00Z 15',
      'darkmoon-faire on 2026-12-06T08:00:00Z 2026-12-06T07:45:00Z 15',
    ]);
    assert.deepEqual(up().map((r) => r.name).slice(0, 3), ["Aqir Invasion: Zul'Aman", 'Legion Timewalking', 'Predaxas'], 'the window\'s own name where it has one');
    // An event's own lead moves it in the order: by reminder time, not by start.
    assert.deepEqual(brief(up({ leads: { 'darkmoon-faire': 1440, 'wow-anniversary': 1440, 'world-boss-predaxas': 5 } })).slice(1), [
      'wow-anniversary on 2026-11-17T18:00:00Z 2026-11-16T18:00:00Z 1440 own',
      'timewalking on 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15',
      'world-boss-predaxas on 2026-11-17T15:00:00Z 2026-11-17T14:55:00Z 5 own',
      'darkmoon-faire on 2026-12-06T08:00:00Z 2026-12-05T08:00:00Z 1440 own',
    ]);
    // The setting moves every event that has no lead of its own, and only those.
    assert.deepEqual(brief(up({ settings: { ...ON, lead: 60 }, leads: { 'world-boss-predaxas': 5 }, starred: ['timewalking', 'world-boss-predaxas'] })), [
      'timewalking on 2026-11-17T15:00:00Z 2026-11-17T14:00:00Z 60',
      'world-boss-predaxas on 2026-11-17T15:00:00Z 2026-11-17T14:55:00Z 5 own',
    ]);
    // States. Off: every row says so and keeps its times. Hourly events only when asked for. Hidden. Due: its time has come.
    assert.deepEqual(up({ settings: { ...ON, on: false } }).map((r) => r.state), ['off', 'off', 'off', 'off', 'off']);
    assert.deepEqual(brief(up({ settings: { ...ON, on: false } }))[1], 'timewalking off 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15');
    assert.deepEqual(up({ settings: { ...ON, hourly: true } })[0].state, 'on');
    assert.deepEqual(brief(up({ hidden: ['timewalking'], starred: ['timewalking'] })), ['timewalking hidden 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15']);
    assert.deepEqual(brief(up({ now: t('2026-11-17T14:45:00Z'), starred: ['timewalking'] })), ['timewalking due 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15']);
    assert.deepEqual(brief(up({ now: t('2026-11-17T14:44:59.999Z'), starred: ['timewalking'] })), ['timewalking on 2026-11-17T15:00:00Z 2026-11-17T14:45:00Z 15']);
    assert.deepEqual(brief(up({ now: t('2026-12-06T08:00:00Z'), starred: ['darkmoon-faire'] })), ['darkmoon-faire on 2027-01-03T08:00:00Z 2027-01-03T07:45:00Z 15'], 'started: the list moves on to its next start');
    assert.deepEqual(brief(up({ now: t('2026-11-17T15:00:00Z'), starred: ['world-boss-predaxas'] })), ['world-boss-predaxas none null null 15'], 'started, and its next turn is past what the data knows: nothing is made up');
    // A row's key is the key the reminder will be delivered under.
    const [row] = up({ starred: ['world-boss-predaxas'], leads: { 'world-boss-predaxas': 60 } });
    assert.equal(row.key, keysDue('2026-11-17T14:30:00Z', { starred: ['world-boss-predaxas'], leads: { 'world-boss-predaxas': 60 } })[0]);
    // Empty: nothing starred, or no events at all.
    assert.deepEqual(up({ starred: [] }), []);
    assert.deepEqual(Rem.upcoming({ events: [], region: 'us', now, settings: ON, starred: ['x'], hidden: [], engine: ENGINE }), []);
    // Nothing more in the data (past the end of what is known): listed last, by name, with no times.
    const late = up({ now: t('2027-06-01T00:00:00Z'), starred: ['wow-anniversary', 'timewalking', 'darkmoon-faire'] });
    assert.deepEqual(late.map((r) => [r.event.id, r.state, r.start]).slice(-2), [['timewalking', 'none', null], ['wow-anniversary', 'none', null]]);
    // Europe and Forever read their own schedules; a Forever row's key names the edition.
    assert.deepEqual(brief(up({ region: 'eu', starred: ['wow-anniversary'] })), ['wow-anniversary on 2026-11-17T09:00:00Z 2026-11-17T08:45:00Z 15']);
    const f = Rem.upcoming({ events: FOREVER.events, region: 'eu', now, settings: ON, leads: { 'stranglethorn-fishing-extravaganza': 120 }, starred: ['stranglethorn-fishing-extravaganza'], hidden: [], engine: ENGINE, edition: 'forever' });
    assert.deepEqual([brief(f), f[0].key], [['stranglethorn-fishing-extravaganza on 2026-11-15T13:00:00Z 2026-11-15T11:00:00Z 120 own'], `forever|eu|stranglethorn-fishing-extravaganza|${t('2026-11-15T13:00:00Z')}|120`]);
  });
}
