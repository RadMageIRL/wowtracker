# WoW Tracker v0.1.0

My World of Warcraft (Retail) dashboard for resets and scheduled events, in your local time.

- **Resets:** daily and weekly reset countdowns for the Americas and Europe, plus the monthly Trading Post change.
- **Happening now:** what is inside its scheduled window right now.
- **Coming up:** what starts in the next hour, few hours or days, with Today and Tomorrow headings.
- **Weekly overview:** this reset week and the next, including the week's world boss.
- **Event calendar:** holidays, the Darkmoon Faire, Timewalking and bonus weeks by month.
- **Latest news:** headlines from Blizzard News, collapsed until you open it.
- Stars, hiding with a Hidden list to bring things back, category filters, compact mode, Dark / Light / System themes, and local, UTC or both. Everything is saved in your browser only.

## How sure the times are

I tie every event to its source and the date I last checked it, and the page shows both.

- **Confirmed:** from Blizzard, or from the game's own calendar data for the live build. No label.
- **Predicted:** a pattern Blizzard has not published. Always labeled **Predicted**. The world boss rotation and the Aqir Invasion clock are predicted.
- **Predicted time:** the dates are confirmed but the start time is not. On European realms, holiday and Darkmoon Faire start times are read the way the game's calendar data writes its European weekly rows (Central European time); Blizzard has not said so.
- Things without a verified schedule are not shown as times. They are listed under the calendar.

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

Opening index.html straight from disk works too; news then links to Blizzard News, because Blizzard's news list can only be read through a server.

I keep the schedule data in [data/events.source.json](data/events.source.json), with the verbatim source quote behind every time. `node tools/build-data.mjs` checks it against the data rules and writes events-data.js.

## Privacy

No accounts, ads, analytics or tracking. Settings stay in your browser. The page asks its own site for the time (to correct a wrong device clock) and, when you open Latest news, for Blizzard's news list.

## License

MIT for the code. Event names and game content belong to Blizzard Entertainment.

Unofficial fan tool, not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.
