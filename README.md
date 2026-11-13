# WoW Tracker v0.4.0

My World of Warcraft dashboard for resets and scheduled events, in your local time, for Retail and for WoW: Forever. It is one plain HTML page: no install, no account, no ads, no server. Every time is worked out in your browser from schedule data kept in this repository.

Use it online at **[radmagelabs.com/wow](https://radmagelabs.com/wow/)** (also at [radmageirl.github.io/wowtracker](https://radmageirl.github.io/wowtracker/)), or download it and open it from your own computer.

![WoW Tracker v0.4.0 in the dark theme, on Retail: the Retail and Forever switch beside the title, the daily and weekly reset countdowns and the Trading Post for the Americas, the three newest Blizzard News headlines labeled All versions, the Show only quick filters (Today, This week, Starred, Holidays) above the category filters, the search box and Reminders, and Happening now cards for the Midnight Dungeon bonus event, Cragpine and a Curse Surge](screenshots/wowtracker.png)

- **Retail or WoW: Forever:** a switch beside the title picks the game version. Each has its own events, stars, hidden events, filters and checklist; the region, theme and reminder settings are shared, while an event's own reminder time belongs to its game version. A link ending in #forever opens WoW: Forever.
- **Resets:** daily and weekly reset countdowns for the Americas and Europe, plus the monthly Trading Post change (Retail).
- **Latest news:** the three newest headlines from Blizzard News, right under the resets, with Show all and Collapse (both remembered). Shop, sale and pre-purchase posts (by Blizzard's own categories) are left out unless you ask for them.
- **Happening now:** what is inside its scheduled window right now. Events that repeat every hour or more often (Aqir Invasions, Curse Surges) come last.
- **Coming up:** what starts in the next hour, few hours or days, with Today and Tomorrow headings.
- **Your checklist:** your own daily and weekly tasks, or picks from a list of suggestions, that clear at your region's resets. Nothing is read from the game. Off in WoW: Forever until its reset times are known.
- **Show only:** Today, This week, Starred and Holidays, at the top of the filters. Today and This week keep what is on at some point in your day or in the week the Weekly overview shows first, and only those times; Holidays keeps the holidays. They narrow what your other filters show and combine with them and with search. Starred is saved, as always; the other three are not, and none of them changes your saved settings.
- **Weekly overview:** this reset week and the next, including the week's world boss, with the date of every start and end, so a week-long event reads "Wed, Nov 11, 5:00 AM to Wed, Nov 18, 4:00 AM". What runs the whole week comes first, then the rest by start. When a Predicted or Predicted time label is in it, one line under the heading says what that label means.
- **Event calendar:** holidays, the Darkmoon Faire, Timewalking and bonus weeks by month; in WoW: Forever, its holidays, the Darkmoon Faire and the Sunday fishing contest.
- **Search and details:** one box narrows every list as you type and forgives small typos; every event name opens what the schedule data knows about it, with its sources.
- **Links to an event:** Copy link, in an event's details, copies an address such as `https://radmagelabs.com/wow/#retail/darkmoon-faire/us/20261206T0800Z`: the game version, the event, the region and the start in UTC. Whoever follows it sees those details in their own time zone. It shows the link's game version and region for that visit without changing what they have saved, and says so; a link whose time has ended or moved opens the event now or next and says why, and one that cannot be read changes nothing.
- **Calendar export:** Add to calendar for one occurrence, or Export to calendar for what the filters show, as an .ics file made in your browser. Each game version gets its own files, and one file never mixes them. Subscribe to calendar, beside it, gives the address of a calendar feed that a calendar app keeps up to date by itself (see Calendar feeds below).
- **Reminders** for starred events, off by default: a notice on the page, and a browser notification if you allow it, 5 to 60 minutes before the start. Any starred event can have a time of its own instead, up to a day before, kept for each game version apart. The Reminders dialog lists what is coming: the next start of each starred event, when its reminder comes and how long before, soonest first, and why not where there is none; left open, the list keeps itself up to date as reminders come due and events start. Only while the page is open in a tab, and only for the game version on screen; for anything else, use the calendar export or a calendar subscription.
- Stars, hiding with a Hidden list to bring things back, category filters, compact mode, Dark / Light / System themes, and local, UTC or both. Everything is saved in your browser only, and Back up settings copies it all, both game versions apart, as one line of text you can restore later or in another browser. Backups from v0.1 and v0.2 still restore.

## Calendar feeds

Four calendar files are published next to the page, one per game version and region, and rebuilt whenever the schedule data changes:

| Game version | Americas | Europe |
|---|---|---|
| Retail | https://radmagelabs.com/wow/calendar/retail-americas.ics | https://radmagelabs.com/wow/calendar/retail-europe.ics |
| WoW: Forever | https://radmagelabs.com/wow/calendar/forever-americas.ics | https://radmagelabs.com/wow/calendar/forever-europe.ics |

Subscribe to calendar, beside Coming up, offers the feed of the game version and region on screen: the address to copy, a link that opens Google Calendar's own "Add calendar" question, and a webcal link for calendar apps that take one (Apple Calendar does). A calendar app that subscribes to one of these addresses checks it again on its own schedule and follows the changes; that is not instant, and the app decides when. A subscribed calendar is the same for everyone, so your filters, stars and hidden events do not apply, and it carries none of WoW Tracker's reminders, which work only on the page while it is open. Each feed holds the entries Export to calendar would give, from two weeks before the data was reviewed to where it ends, without events that repeat every hour or more often, with "(Predicted)" or "(Predicted time)" in the title where the page shows it, and one all-day entry where each known schedule ends.

I have not tested them everywhere. Google Calendar subscribed to a test feed written the same way, showed it correctly and followed its changes (moved, renamed, removed and added entries) about an hour and a half after I published them. I have not tested Apple Calendar or Outlook, and the page says so. Copying the address into a calendar app's own "subscribe" or "add by URL" box is the way that depends least on any one app. Opening an address in a browser, or importing the file it saves, gives a one-time copy, not a subscription.

## How sure the times are

I tie every event to its source and the date I last checked it, and the page shows both. The examples here are Retail's; WoW: Forever has its own section below.

- **Confirmed:** from Blizzard, or from the game's own calendar data for the live build. No label.
- **Predicted:** a pattern Blizzard has not published. Always labeled **Predicted**. The world boss rotation, the Aqir Invasion clock and zone of the week, and the place of each Curse Surge are predicted.
- **Predicted time:** the dates are confirmed but the start time is not. On European realms, holiday and Darkmoon Faire start times are read the way the game's calendar data writes its European weekly rows (Central European time); Blizzard has not said so. In the Americas, the Battleground bonus week of December 1, 2026 is labeled too, because the live game data and the 12.1.7 test data give start times an hour apart.
- **Not known yet:** where a schedule runs out, the page says so instead of showing an empty week. Bonus events are known to the January 5, 2027 reset; Timewalking, world bosses, Aqir Invasions and Curse Surges to the December 1, 2026 reset; holidays, small events and the Darkmoon Faire to March 31, 2027. Things without a verified schedule at all are listed under the calendar.

Times are scheduled times, not live game state. Nothing on the page is read from the game, and a realm can open early or late around maintenance.

## WoW: Forever

Every WoW: Forever time comes from the game's own calendar data (build 1.60.1.70862), which gives dates and hours in server time. What the page shows:

- **Events:** the Darkmoon Faire (Elwynn Forest and Thunder Bluff in turn), the Stranglethorn Fishing Extravaganza every Sunday from 14:00 to 16:00 server time, the Feast of Winter Veil, the Lunar Festival, Love is in the Air, the Midsummer Fire Festival, the Fireworks Spectacular (Americas only), the Harvest Festival and Hallow's End. Known through November 7, 2027.
- **Server clocks:** I read server time as US Central time in the Americas and Central European time in Europe. Oceanic realms play on the Americas schedule. That comes from when players saw the first fishing contest start (November 8, 2026: about 20:00 UTC in the Americas, about 13:00 UTC in Europe), and in the Americas also from a player's in-game clock on November 7 (UTC-6): two sightings there, both in standard time, one in Europe. Blizzard has not said. So every WoW: Forever time is labeled **Predicted time**, and its details say why.
- **Daylight saving time:** not seen yet on these servers. Times from March 14, 2027 (Americas) and March 28, 2027 (Europe) assume the server clocks change with their regions.
- **Resets:** Blizzard has not published WoW: Forever's daily and weekly reset times, so the page says "Not published" instead of counting down, the weekly overview uses calendar weeks, and the checklist is off. I never use Retail's reset times for it.
- **Not shown as times:** the Call to Arms battleground weeks (the order is in the data, how it repeats has not been seen), Noblegarden (no end in the data), the raids opening on December 9, 2026 (no hour), the Launch Celebration and Children's Week. The page lists them under the calendar.
- **News:** Blizzard's list mixes Retail and WoW: Forever posts with no way to tell them apart, so Latest news is labeled "All versions" in both.

## Resets

| Region | Daily | Weekly |
|---|---|---|
| Americas (US, Latin American and Oceanic realms) | 15:00 UTC | Tuesday 15:00 UTC |
| Europe | 04:00 UTC | Wednesday 04:00 UTC |

Both are fixed in UTC all year, so the local time moves an hour when daylight saving changes: 8:00 AM PDT or 7:00 AM PST in the Americas, 06:00 CEST or 05:00 CET in Europe. These are Retail's resets; WoW: Forever's are not published (see above).

## Running it

No install and no dependencies, only Node 22 or newer for the tools.

```
node tools/serve.mjs            # the repo at http://127.0.0.1:8080/ (with live news)
node tools/build.mjs            # the production build in dist/
node tools/serve.mjs dist 8081  # preview the build
node tests/run.mjs              # unit tests, data rules and house checks
node tests/smoke.mjs            # browser tests on dist/ (needs Chrome)
node tests/smoke.mjs --layout --fonts verdana-georgia   # the layout checks with wider fonts
node tests/controls.mjs         # past defects put back: the browser tests must still catch them
```

The browser tests print the fonts the page was really drawn with. On Linux, `--font-profile android` runs them with only Roboto and Noto Serif (packages fonts-roboto-unhinted and fonts-noto-core), as GitHub Actions does on every push.

Opening index.html straight from disk works too; news then links to Blizzard News, because Blizzard's news list can only be read through a server. On radmagelabs.com (and the local server) the page asks its own site for news.json, which passes Blizzard's list through; on GitHub Pages and from disk it does not ask at all.

I keep the schedule data in [data/events.source.json](data/events.source.json) (Retail) and [data/forever.source.json](data/forever.source.json) (WoW: Forever), with the verbatim source quote behind every time. `node tools/build-data.mjs` checks both against the data rules and writes events-data.js, forever-data.js and the four calendar feeds in [calendar/](calendar/). The feeds keep the CRLF line endings calendar files require; every other file uses LF.

When a new game build comes out, I compare its calendar with what the page publishes before changing anything:

```
node tools/calendar/fetch.mjs --latest --check     # is there a new build of wow, wowt or wowf?
node tools/calendar/fetch.mjs --product wowf --build <version>   # its calendar tables, into local/ only
node tools/calendar/extract.mjs local/calendar/wowf/<version>    # a snapshot (no game text, only fingerprints)
node tools/calendar/compare.mjs --old <older snapshot> --new <snapshot> --data data/forever.source.json
```

The report lists rows and dates added, removed, renamed and moved, matches every published window to the client rows its sources cite, and says how sure each time is and how far each event's data goes. It never edits the data: changes go through me, the data rules and the tests. The client's tables give wall times without a time zone, so they can confirm dates but never a time on a server clock nobody has confirmed.

## Feedback

Found a wrong time or a missing event? Open an issue at [github.com/RadMageIRL/wowtracker/issues](https://github.com/RadMageIRL/wowtracker/issues). If you saw an event start in game, the game version, the realm region and the time you saw help most. For WoW: Forever, the daily and weekly reset times and the time zone of the in-game Calendar would settle the biggest open questions.

## Privacy

No accounts, ads, analytics or tracking. Settings stay in your browser. The page asks its own site for the time (to correct a wrong device clock) and, unless you collapse Latest news, for Blizzard's news list. That request goes to this site, which passes Blizzard's list through, so Blizzard sees the site and not you. Calendar files and backups are made in your browser and sent nowhere, and reminders are checked by the open page itself.

## License

MIT for the code (see [LICENSE](LICENSE)). Event names and game content belong to Blizzard Entertainment.

Unofficial fan tool, not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.
