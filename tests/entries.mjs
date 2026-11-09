// The shared calendar-entry module (js/calendar-entry.js): the words of one event window as a calendar entry,
// for the page's downloads (as v0.3.1 wrote them) and for the subscription feeds. Run by tests/run.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CE = require('../js/calendar-entry.js');
const Ics = require('../js/ics.js');
const S = require('../js/schedule.js');
const RETAIL = require('../events-data.js');
const FOREVER = require('../forever-data.js');

const PAGE = 'https://radmagelabs.com/wow/';
const ENGLISH_DAY = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const UTC_MOMENT = (ms) => `${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(ms)} UTC`;
const words = { day: ENGLISH_DAY, moment: UTC_MOMENT };

/** The entry of event id's window starting at iso, in region r of a dataset. */
function entryAt(data, edition, id, r, iso, form) {
  const e = data.events.find((x) => x.id === id);
  const w = S.windows(e.schedules[r], Date.parse(iso), Date.parse(iso) + 1).find((x) => x.start === Date.parse(iso));
  assert.ok(w, `${id} ${r} has a window at ${iso}`);
  const c = data.categories.find((x) => x.id === e.category);
  return CE.entry({ event: e, window: w, region: r, data, edition, pageUrl: PAGE, coverage: CE.coverageText(c, r, words), form });
}

export function entryTests(test) {
  test('a Retail download entry says what v0.3.1\'s did, word for word: confirmed, its sources, the page, and v0.2\'s UID', () => {
    const e = entryAt(RETAIL, 'retail', 'darkmoon-faire', 'us', '2026-12-06T08:00:00Z');
    assert.deepEqual(e, {
      uid: '35f65e968686e357@radmagelabs.com', start: Date.parse('2026-12-06T08:00:00Z'), end: Date.parse('2026-12-13T08:00:00Z'),
      summary: 'Darkmoon Faire',
      description: [
        'Confirmed: from Blizzard and game data.',
        'Region: Americas (US, Latin American and Oceanic realms).',
        'A scheduled time from WoW Tracker schedule data r2, checked 2026-11-08. It is not read from the game; a realm can open early or late around maintenance.',
        'Sources: Blizzard News https://news.blizzard.com/en-us/article/23785338/the-darkmoon-faire-returns ; Game calendar data (12.1.5.70783) https://wago.tools/db2/Holidays?build=12.1.5.70783 ; Blizzard support forum agent (2018) https://web.archive.org/web/20190707083938/https://us.battle.net/forums/en/wow/topic/20769667734',
        'WoW Tracker: https://radmagelabs.com/wow/',
      ].join('\n'),
      location: 'World of Warcraft: Darkmoon Island (portals in Elwynn Forest and Mulgore)',
      url: 'https://news.blizzard.com/en-us/article/23785338/the-darkmoon-faire-returns',
      tentative: false, categories: ['Darkmoon Faire'],
    });
  });

  test('Retail predicted entries: "(Predicted time)" in Europe with the reason first, "(Predicted)" for a predicted event, both tentative', () => {
    const he = entryAt(RETAIL, 'retail', 'hallows-end', 'eu', '2026-10-19T08:00:00Z');
    assert.equal(he.uid, 'a0c920f285165891@radmagelabs.com');
    assert.equal(he.summary, "Hallow's End (Predicted time)");
    assert.equal(he.tentative, true);
    assert.match(he.description, /^Predicted time: the dates are confirmed; the start time on European realms is not\. The dates are the game's own\./);
    assert.doesNotMatch(he.description, /Server time|Repeats|Known through/, 'Retail entries never had the edition lines');
    const wb = entryAt(RETAIL, 'retail', 'world-boss-thormbelan', 'us', '2026-11-10T15:00:00Z');
    assert.deepEqual([wb.summary, wb.tentative, wb.location, wb.categories], ["Thorm'belan (Predicted)", true, 'World of Warcraft: Harandar', ['World bosses']]);
    assert.match(wb.description, /^Predicted: Blizzard has not published the order\./);
  });

  test('a Forever entry names its server time, how it repeats and how far its data goes, and its UID names the edition', () => {
    const f = entryAt(FOREVER, 'forever', 'stranglethorn-fishing-extravaganza', 'us', '2026-11-15T20:00:00Z');
    const fish = FOREVER.events.find((x) => x.id === 'stranglethorn-fishing-extravaganza');
    assert.equal(f.uid, Ics.eventUid(fish.id, 'us', Date.parse('2026-11-15T20:00:00Z'), 'forever'));
    assert.equal(f.summary, 'Stranglethorn Fishing Extravaganza (Predicted time)');
    assert.deepEqual(f.description.split('\n'), [
      `Predicted time: the dates are confirmed; the start time on Americas and Oceania is not. ${fish.schedules.us.basis}`,
      'Region: Americas (Americas and Oceania).',
      'Server time: Sunday 14:00, read as US Central time (predicted).',
      'Repeats: Every Sunday, 14:00 to 16:00 server time.',
      "Known through Nov 7, 2027. After that: not known yet (only one year of the game's calendar data, from build 1.60.1.70862, is read so far).",
      "A scheduled time from WoW Tracker's World of Warcraft: Forever schedule data r2, checked 2026-11-08. It is not read from the game; a realm can open early or late around maintenance.",
      'Sources: Game calendar data (1.60.1.70862) https://wago.tools/db2/Holidays?build=1.60.1.70862 ; Game calendar text (1.60.1.70862) https://wago.tools/db2/HolidayDescriptions?build=1.60.1.70862 ; Icy Veins https://www.icy-veins.com/wow-forever/fishing',
      'WoW Tracker: https://radmagelabs.com/wow/#forever']);
    // Europe reads the same row on its own clock.
    const eu = entryAt(FOREVER, 'forever', 'stranglethorn-fishing-extravaganza', 'eu', '2026-11-15T13:00:00Z');
    assert.match(eu.description, /\nServer time: Sunday 14:00, read as Central European time \(predicted\)\.\n/);
  });

  test('the feed form says the same, but links to the page for details and sources instead of listing every source', () => {
    for (const [data, ed, id, r, iso] of [[RETAIL, 'retail', 'darkmoon-faire', 'us', '2026-12-06T08:00:00Z'], [FOREVER, 'forever', 'stranglethorn-fishing-extravaganza', 'eu', '2026-11-15T13:00:00Z']]) {
      const dl = entryAt(data, ed, id, r, iso), feed = entryAt(data, ed, id, r, iso, 'feed');
      const link = ed === 'retail' ? PAGE : `${PAGE}#forever`;
      assert.deepEqual(feed.description.split('\n'), [...dl.description.split('\n').slice(0, -2), `Details and sources: ${link}`], id);
      assert.deepEqual({ ...feed, description: '' }, { ...dl, description: '' }, `${id}: everything else as the download`);
    }
  });

  test('how far data goes, in words: a midnight limit is the day before it, a reset limit a moment, no limit nothing', () => {
    const cat = (k, gap) => ({ knownUntil: { us: k, eu: k }, gap });
    assert.equal(CE.coverageText(cat('2027-04-01T00:00:00Z', 'the game has not said'), 'us', words), 'Known through Mar 31, 2027. After that: not known yet (the game has not said).');
    assert.equal(CE.coverageText(cat('2026-12-01T15:00:00Z', 'next patch'), 'us', words), 'Known until Tue, Dec 1, 3:00 PM UTC. After that: not known yet (next patch).');
    assert.equal(CE.coverageText(cat('2027-04-01T00:00:00Z'), 'eu', words), 'Known through Mar 31, 2027. After that: not known yet.');
    assert.equal(CE.coverageText({ name: 'x' }, 'us', words), '');
  });

  test('the calendar name is v0.2\'s for Retail and names the edition otherwise; frequent means more often than once a day', () => {
    assert.equal(CE.calendarName('retail', 'Retail', 'Americas'), 'WoW Tracker (Americas)');
    assert.equal(CE.calendarName(undefined, 'Retail', 'Europe'), 'WoW Tracker (Europe)');
    assert.equal(CE.calendarName('forever', 'WoW: Forever', 'Europe'), 'WoW Tracker, WoW: Forever (Europe)');
    assert.equal(CE.isFrequent({ type: 'every', periodMin: 60 }), true);
    assert.equal(CE.isFrequent({ type: 'every', periodMin: 1439 }), true);
    assert.equal(CE.isFrequent({ type: 'every', periodMin: 1440 }), false);
    assert.equal(CE.isFrequent({ type: 'dates', windows: [] }), false);
    assert.equal(CE.isFrequent(null), false);
    assert.deepEqual(['confirmed', 'predicted'].map((status) => CE.predictedLabel({ status })), ['', ' (Predicted)']);
    assert.equal(CE.predictedLabel({ status: 'predicted', part: 'time' }), ' (Predicted time)');
  });
}
