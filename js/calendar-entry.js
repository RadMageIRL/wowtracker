// Calendar entries: what one window of an event says in a calendar, the same for the page's downloads and the
// build's subscription feeds. Pure: every word comes from the dataset and the arguments, never from the clock,
// the device's zone or the page, so a feed made at build time and a file saved in a browser describe the same
// occurrence the same way. js/ics.js writes the entries into a file; nothing here repeats a schedule.
(function (root) {
  'use strict';

  const node = typeof module === 'object' && module.exports;
  const S = node ? require('./schedule.js') : root.WoWSchedule;
  const Ics = node ? require('./ics.js') : root.WoWIcs;

  /** How each kind of source is named to readers. */
  const KIND = { official: 'Blizzard', client: 'game data', 'game-api': 'game API', wiki: 'wiki', guide: 'guide' };
  const pad2 = (n) => String(n).padStart(2, '0');
  const isRetail = (edition) => !edition || edition === 'retail';

  /** How sure an event is in a region: a region can be less certain than the event (only its start time). */
  function statusFor(e, region) {
    const s = S.scheduleFor(e, region);
    if (s && s.status) return { status: s.status, part: s.part || null, basis: s.basis };
    return { status: e.status, part: null, basis: e.basis };
  }
  const predictedLabel = (st) => (st.status !== 'predicted' ? '' : st.part === 'time' ? ' (Predicted time)' : ' (Predicted)');
  /** Repeats every hour or more often: never an entry in a file of many events, nor in a feed. */
  const isFrequent = (s) => Boolean(s && s.type === 'every' && s.periodMin < 1440);

  /** The calendar's name. Retail's is v0.2's ("WoW Tracker (Americas)"); another edition names itself. */
  const calendarName = (edition, editionShort, regionName) => (isRetail(edition) ? `WoW Tracker (${regionName})` : `WoW Tracker, ${editionShort} (${regionName})`);

  /**
   * How far a category's schedules are known in a region: "Known through Nov 7, 2027. After that: not known
   * yet (why)." A limit at midnight UTC is a date (the day before it); one at a reset is a moment. The caller
   * writes them for its reader: { day(isoDate), moment(ms) }. Empty when the category has no limit.
   */
  function coverageText(c, region, { day, moment }) {
    const until = c && c.knownUntil ? Date.parse(c.knownUntil[region]) : null;
    if (!until) return '';
    const d = new Date(until);
    const when = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `through ${day(new Date(until - S.DAY).toISOString().slice(0, 10))}` : `until ${moment(until)}`;
    return `Known ${when}. After that: not known yet${c.gap ? ` (${c.gap})` : ''}.`;
  }

  /** For an edition other than Retail: its server time, how it repeats and how far its data goes. */
  function editionLines(e, w, reg, coverage) {
    const z = reg.serverZone, c = z ? S.wallClock(z.zone, w.start) : null;
    return [
      z ? `Server time: ${S.WEEKDAYS[c.wd]} ${pad2(c.h)}:${pad2(c.mi)}, read as ${z.name}${z.status === 'predicted' ? ' (predicted)' : ''}.` : null,
      e.repeats ? `Repeats: ${e.repeats}` : null,
      coverage || '',
    ];
  }

  /**
   * One calendar entry for one window w of event e in region r of a dataset:
   *   { event, window, region, data, edition, pageUrl, coverage, form }
   * coverage is the line saying how far the event's data goes (from the caller, which knows how to write a
   * date for its reader); pageUrl the page's address. form 'download' (the page's files, as v0.3.1 made them)
   * lists every source; form 'feed' (a subscription, read again and again) links to the page instead.
   */
  function entry({ event: e, window: w, region: r, data, edition, pageUrl, coverage = '', form = 'download' }) {
    const retail = isRetail(edition), reg = data.regions.find((x) => x.id === r), st = statusFor(e, r);
    const sure = st.status === 'predicted' && st.part === 'time'
      ? `Predicted time: the dates are confirmed; the start time on ${reg.realms} is not. ${st.basis || ''}`
      : st.status === 'predicted' ? `Predicted: ${st.basis || e.basis || 'a pattern Blizzard has not published.'}`
        : `Confirmed: from ${[...new Set(e.sources.map((s) => KIND[s.kind] || s.kind))].join(' and ')}.`;
    const link = `${pageUrl}${retail ? '' : `#${edition}`}`;
    const description = [
      sure.trim(),
      e.note || null,
      `Region: ${reg.name} (${reg.realms}).`,
      ...(retail ? [] : editionLines(e, w, reg, coverage)),
      `A scheduled time from WoW Tracker${retail ? '' : `'s ${data.meta.game}`} schedule data r${data.meta.datasetRevision}, checked ${e.lastVerified}. It is not read from the game; a realm can open early or late around maintenance.`,
      ...(form === 'feed' ? [`Details and sources: ${link}`]
        : [`Sources: ${e.sources.map((s) => `${s.publisher} ${s.url}`).join(' ; ')}`, `WoW Tracker: ${link}`]),
    ].filter(Boolean).join('\n');
    return {
      uid: Ics.eventUid(e.id, r, w.start, edition), start: w.start, end: w.end,
      summary: `${w.name || e.name}${predictedLabel(st)}`, description,
      location: e.zone ? `World of Warcraft: ${e.zone}` : 'World of Warcraft', url: e.link ? e.link.url : e.sources[0].url,
      tentative: st.status === 'predicted', categories: [data.categories.find((c) => c.id === e.category).name],
    };
  }

  const CalendarEntry = { KIND, statusFor, predictedLabel, isFrequent, calendarName, coverageText, entry };
  if (node) module.exports = CalendarEntry;
  else root.WoWCalendarEntry = CalendarEntry;
})(typeof globalThis !== 'undefined' ? globalThis : this);
