// Calendar subscription feeds: one .ics file per edition and region (calendar/<edition>-<region>.ics), made at
// build time from the same data the page shows, with the same words its downloads use (js/calendar-entry.js),
// written by js/ics.js. A calendar app that subscribes reads the file again on its own schedule and mirrors it,
// so a schedule change reaches subscribers when it is published; how soon is the app's choice, not ours.
//
// A feed is the same for everyone (no filters, no hidden events) and holds only what a calendar can show
// honestly: events with scheduled windows, never resets and never anything that repeats every hour or more often,
// from two weeks before the data was reviewed to the end of the data, and nothing past its category's coverage in
// that region. Where a category's coverage ends there is one whole-day entry saying so, so an empty stretch is
// never read as "nothing happens". Every byte comes from the data: no build clock, no machine zone, no locale.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/schedule.js');
const Ics = require('../js/ics.js');
const CE = require('../js/calendar-entry.js');
const CONFIG = require('../js/config.js');

/** The feeds and their addresses. A subscribed address lives in people's calendars for years: never rename one. */
export const FEEDS = [
  { file: 'calendar/retail-americas.ics', edition: 'retail', region: 'us' },
  { file: 'calendar/retail-europe.ics', edition: 'retail', region: 'eu' },
  { file: 'calendar/forever-americas.ics', edition: 'forever', region: 'us' },
  { file: 'calendar/forever-europe.ics', edition: 'forever', region: 'eu' },
];
/** How far before the data's review date a feed begins, so the week it was published is in it. */
export const LOOKBACK_DAYS = 14;
/** How often a calendar app is asked to look again (RFC 7986 REFRESH-INTERVAL, Outlook's X-PUBLISHED-TTL). */
export const REFRESH = 'P1D';

/**
 * A feed entry's UID: the downloads' input (edition, event, region, start) as 32 hex digits with no domain, as
 * RFC 7986 asks. The same occurrence keeps it on every build; a moved start is a new entry, and the old one
 * leaves the calendar with the file. Never the same as a download's UID, so a feed never collides with a file.
 */
export const feedUid = (input) => createHash('sha256').update(String(input)).digest('hex').slice(0, 32);

/** Dates written for any reader of a feed: English, and moments in UTC, never the machine's zone. */
export const WORDS = {
  day: (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)),
  moment: (ms) => `${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(ms)} UTC`,
};
const DAY = S.DAY;
const midnight = (ms) => Math.floor(ms / DAY) * DAY;

/**
 * The text of one feed: data is an edition's page data (what tools/build-data.mjs writes for the page),
 * edition its entry in js/config.js, region 'us' or 'eu'. base is the canonical page address.
 */
export function feedText(data, edition, region, { base = CONFIG.shareUrl } = {}) {
  const feed = FEEDS.find((f) => f.edition === edition.id && f.region === region);
  if (!feed) throw new Error(`no feed for ${edition.id} ${region}`);
  const reg = data.regions.find((r) => r.id === region);
  const reviewed = Date.parse(`${data.meta.reviewedOn}T00:00:00Z`);
  const from = reviewed - LOOKBACK_DAYS * DAY, to = Date.parse(`${data.meta.coversUntil}T23:59:59Z`);
  const link = `${base}${edition.id === 'retail' ? '' : `#${edition.id}`}`;
  const category = new Map(data.categories.map((c) => [c.id, c]));
  const limitOf = (c) => Date.parse(c.knownUntil[region]);
  const entries = [], followed = new Set();

  for (const e of data.events) {
    const s = S.scheduleFor(e, region);
    if (!s || CE.isFrequent(s)) continue;
    const c = category.get(e.category);
    followed.add(c.id);
    const limit = limitOf(c);
    for (const w of S.windows(s, from, to)) {
      if (!(w.start < limit)) continue; // past what the data knows in this region: never an entry
      const x = CE.entry({ event: e, window: w, region, data, edition: edition.id, pageUrl: base, coverage: CE.coverageText(c, region, WORDS), form: 'feed' });
      entries.push(Object.assign(x, { uid: feedUid(Ics.uidInput(e.id, region, w.start, edition.id)), stampMs: reviewed }));
    }
  }

  // Where coverage ends: one whole-day entry per limit, on its date (UTC), naming the categories that stop there.
  const byLimit = new Map();
  for (const c of data.categories) {
    if (!followed.has(c.id)) continue;
    if (!byLimit.has(limitOf(c))) byLimit.set(limitOf(c), []);
    byLimit.get(limitOf(c)).push(c);
  }
  for (const [limit, cats] of [...byLimit].sort((a, b) => a[0] - b[0])) {
    const names = cats.map((c) => c.name), said = new Map();
    for (const c of cats) { const t = CE.coverageText(c, region, WORDS); said.set(t, [...(said.get(t) || []), c.name]); }
    entries.push({
      uid: feedUid(`${edition.id}|known-until|${region}|${limit}|${cats.map((c) => c.id).join(',')}`),
      start: midnight(limit), end: midnight(limit) + DAY, allDay: true, stampMs: reviewed,
      summary: `Not known yet from here: ${names.join(', ')}`,
      description: [
        ...[...said].map(([t, who]) => `${who.join(', ')}: ${t}`),
        `This calendar gains entries when WoW Tracker's schedule data is updated. A day with nothing after this is not known to be empty. ${link}`,
      ].join('\n'),
      url: link,
    });
  }
  entries.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary, 'en') || (a.uid < b.uid ? -1 : 1));

  const name = CE.calendarName(edition.id, edition.short, reg.name);
  const description = [
    `${data.meta.game} holidays and events for the ${reg.name} region (${reg.realms}), from WoW Tracker's schedule data r${data.meta.datasetRevision}, reviewed ${data.meta.reviewedOn}.`,
    'Scheduled times, not read from the game. A title that ends in (Predicted) or (Predicted time) is a prediction.',
    'Resets and events that repeat every hour or more often are not included.',
    'WoW Tracker updates this calendar when its schedule data changes; your calendar app decides how often it looks.',
    link,
  ].join(' ');
  return Ics.calendar({ name, stampMs: reviewed, events: entries, feed: { description, source: `${base}${feed.file}`, refresh: REFRESH } });
}

/** Every feed's file and text, from each edition's page data: { [edition id]: data }. */
export function feeds(pageDataByEdition, opts) {
  return FEEDS.map((f) => {
    const edition = CONFIG.editions.find((e) => e.id === f.edition);
    return { file: f.file, text: feedText(pageDataByEdition[f.edition], edition, f.region, opts) };
  });
}
