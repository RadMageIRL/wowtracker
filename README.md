# WoW Tracker v0.2.0

My World of Warcraft (Retail) dashboard for resets and scheduled events, in your local time. It is one plain HTML page: no install, no account, no ads, no server. Every time is worked out in your browser from schedule data kept in this repository.

Use it online at **[radmagelabs.com/wow](https://radmagelabs.com/wow/)** (also at [radmageirl.github.io/wowtracker](https://radmageirl.github.io/wowtracker/)), or download it and open it from your own computer.

![WoW Tracker in the dark theme: the daily and weekly reset countdowns and the Trading Post for the Americas, the three newest Blizzard News headlines, the category filters with the search box and Reminders, and Happening now cards for the Midnight Dungeon bonus event, Cragpine, the week's predicted world boss, and a predicted Curse Surge at The Broodmother's Nest](screenshots/wowtracker.png)

- **Resets:** daily and weekly reset countdowns for the Americas and Europe, plus the monthly Trading Post change.
- **Latest news:** the three newest headlines from Blizzard News, right under the resets, with Show all and Collapse (both remembered). Shop, sale and pre-purchase posts (by Blizzard's own categories) are left out unless you ask for them.
- **Happening now:** what is inside its scheduled window right now. Events that repeat every hour or more often (Aqir Invasions, Curse Surges) come last.
- **Coming up:** what starts in the next hour, few hours or days, with Today and Tomorrow headings.
- **Your checklist:** your own daily and weekly tasks, or picks from a list of suggestions, that clear at your region's resets. Nothing is read from the game.
- **Weekly overview:** this reset week and the next, including the week's world boss.
- **Event calendar:** holidays, the Darkmoon Faire, Timewalking and bonus weeks by month.
- **Search and details:** one box narrows every list as you type and forgives small typos; every event name opens what the schedule data knows about it, with its sources.
- **Calendar export:** Add to calendar for one occurrence, or Export to calendar for what the filters show, as an .ics file made in your browser.
- **Reminders** for starred events, off by default: a notice on the page, and a browser notification if you allow it, 5 to 60 minutes before the start. Only while the page is open in a tab; for anything else, use the calendar export.
- Stars, hiding with a Hidden list to bring things back, category filters, compact mode, Dark / Light / System themes, and local, UTC or both. Everything is saved in your browser only, and Back up settings copies it all as one line of text you can restore later or in another browser.

## How sure the times are

I tie every event to its source and the date I last checked it, and the page shows both.

- **Confirmed:** from Blizzard, or from the game's own calendar data for the live build. No label.
- **Predicted:** a pattern Blizzard has not published. Always labeled **Predicted**. The world boss rotation, the Aqir Invasion clock and zone of the week, and the place of each Curse Surge are predicted.
- **Predicted time:** the dates are confirmed but the start time is not. On European realms, holiday and Darkmoon Faire start times are read the way the game's calendar data writes its European weekly rows (Central European time); Blizzard has not said so. In the Americas, the Battleground bonus week of December 1, 2026 is labeled too, because the live game data and the 12.1.7 test data give start times an hour apart.
- **Not known yet:** where a schedule runs out, the page says so instead of showing an empty week. Bonus events are known to the January 5, 2027 reset; Timewalking, world bosses, Aqir Invasions and Curse Surges to the December 1, 2026 reset; holidays, small events and the Darkmoon Faire to March 31, 2027. Things without a verified schedule at all are listed under the calendar.

Times are scheduled times, not live game state. Nothing on the page is read from the game, and a realm can open early or late around maintenance.

## Resets

| Region | Daily | Weekly |
|---|---|---|
| Americas (US, Latin American and Oceanic realms) | 15:00 UTC | Tuesday 15:00 UTC |
| Europe | 04:00 UTC | Wednesday 04:00 UTC |

Both are fixed in UTC all year, so the local time moves an hour when daylight saving changes: 8:00 AM PDT or 7:00 AM PST in the Americas, 06:00 CEST or 05:00 CET in Europe.

## Running it

No install and no dependencies, only Node 22 or newer for the tools.

```
node tools/serve.mjs            # the repo at http://127.0.0.1:8080/ (with live news)
node tools/build.mjs            # the production build in dist/
node tools/serve.mjs dist 8081  # preview the build
node tests/run.mjs              # unit tests, data rules and house checks
node tests/smoke.mjs            # browser tests on dist/ (needs Chrome)
```

Opening index.html straight from disk works too; news then links to Blizzard News, because Blizzard's news list can only be read through a server. On radmagelabs.com (and the local server) the page asks its own site for news.json, which passes Blizzard's list through; on GitHub Pages and from disk it does not ask at all.

I keep the schedule data in [data/events.source.json](data/events.source.json), with the verbatim source quote behind every time. `node tools/build-data.mjs` checks it against the data rules and writes events-data.js.

## Feedback

Found a wrong time or a missing event? Open an issue at [github.com/RadMageIRL/wowtracker/issues](https://github.com/RadMageIRL/wowtracker/issues). If you saw an event start in game, the realm region and the time you saw help most.

## Privacy

No accounts, ads, analytics or tracking. Settings stay in your browser. The page asks its own site for the time (to correct a wrong device clock) and, unless you collapse Latest news, for Blizzard's news list. That request goes to this site, which passes Blizzard's list through, so Blizzard sees the site and not you. Calendar files and backups are made in your browser and sent nowhere, and reminders are checked by the open page itself.

## License

MIT for the code (see [LICENSE](LICENSE)). Event names and game content belong to Blizzard Entertainment.

Unofficial fan tool, not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.
