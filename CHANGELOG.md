# Changelog

## v0.2.0 (2026-11-08)

Search, event details, calendar export, reminders and a checklist, with the news at the top. Settings, stars and hidden events saved by v0.1 carry over.

- Latest news sits right under the resets, open, with the three newest headlines; Show all lists up to eight and Collapse folds it, and both are remembered. Headlines load after the countdowns have drawn and never move the page. News starts open even if v0.1 had it closed, since v0.1 saved it closed for everyone who never opened it; Collapse keeps it closed from then on.
- The page asks for news only where its own site passes Blizzard's list through (radmagelabs.com). On GitHub Pages or opened from a file it links to Blizzard News instead, with no failed request.
- Search: one box narrows every list as you type. It forgives case, accents, apostrophes and a small typo in words of four letters or more, and finds zones, window names (Legion Timewalking) and common short names (DMF, TW, Halloween). It is not saved.
- Details: every event name opens what the schedule data knows about that occurrence: when and how long, how it repeats, the other region's time, where, the next dates, how sure, how far the data reaches, and every source with the date I checked it.
- Calendar export: Add to calendar in the details saves one occurrence; Export to calendar, beside Coming up, saves what the filters show (on now and coming up, or everything known), with predicted events optional. The file is made in your browser, in UTC, with "(Predicted)" or "(Predicted time)" in the title where the page shows it, and each entry keeps the same identifier in every export. Export to calendar leaves out hidden events and events that repeat every hour or more often.
- Reminders for starred events, off by default: a notice on the page 5, 15, 30 or 60 minutes before the start, and if you allow it a silent browser notification. They work only while the page is open in a tab, are never shown late after sleep or a clock change, and show once across tabs and reloads.
- Your checklist, after Coming up and folded until opened: your own daily and weekly tasks, or picks from a list of suggestions, that clear at your region's daily or weekly reset. Ticks are kept per region. Nothing is read from the game.
- Back up settings, in the checklist and the footer: settings, stars, hidden events, reminders and the checklist as one line of text to copy or download, and a backup to paste or open, checked and shown before it replaces anything.
- Curse Surges and the Aqir Invasion zone of each week (see the schedule data below). In Happening now, events that repeat every hour or more often come after the rest.
- On phones the filters fold behind one Filters button that says what is set, and one reminder notice shows at a time ("+N more" opens the rest).

Schedule data:

- r2 (2026-11-08), schedule change: bonus weeks through December (Pet Battle and Battleground from December 1, Delves from December 15, Midnight Dungeon from December 22), where the live game data and the 12.1.7 test data agree; in the Americas the Battleground week's start time is labeled Predicted time, because the two disagree by an hour. Curse Surges every 30 minutes with the location of each slot, and the Aqir Invasion zone of each week, both Predicted. Game build 12.1.5.70783 (calendar tables unchanged). Timewalking from December 1 is still not known.

## v0.1.1 (2026-11-08)

Maintenance: lighter on the processor and easier to read. No schedule data or feature changes; settings saved by v0.1.0 carry over.

- The Happening now cards keep their glow in their category color but no longer animate it. The endless "breathing" redrew every card on every frame, about 100 ms of work each second for as long as the page was open; an idle page now uses about 3 ms a second.
- The "on now" line of a calendar entry is brighter, so it reads at 4.5:1 or more on its tinted row in every category and theme (it was as low as 4.4:1 in the dark theme).
- The RadMage Labs link in the header is underlined, so it stands out from the tagline by more than its color.

## v0.1.0 (2026-10-27)

First public release.

- Daily and weekly reset countdowns for the Americas and Europe, with the region saved, and the monthly Trading Post change (labeled Predicted: Blizzard gives the day, not the hour).
- Happening now, Coming up (1 hour to 7 days, with Today and Tomorrow headings), a weekly overview of this reset week and the next, and an event calendar through March 2027.
- Events: 8 holidays, 8 small events, the Darkmoon Faire, Timewalking and bonus weeks through November 2026, the weekly world boss (Predicted) and Aqir Invasions (Predicted).
- "Not known yet" lines wherever a schedule runs out, so an unknown week never reads as an empty one.
- Stars, hiding with a Hidden list, category filters, a Starred view, compact mode, Dark / Light / System themes, and local, UTC or both.
- Latest news from Blizzard News, closed until opened. Shop and sale posts (Blizzard's own Shop Now, Sale, On Sale and Pre-purchase categories) are left out unless you ask for them; New Mount posts stay.
- Footer with RadMage Labs, GitHub, Share, Feedback and Buy me a coffee; the addresses live in js/config.js. Link previews and the canonical address point at radmagelabs.com/wow/.

After release, without a new version number:

- 2026-10-31, live the same day: a shorter page description (the meta description only), so search results show it in full. Nothing on the page changed.

Schedule data:

- r1 (2026-10-27), first dataset: patch 12.1.5, game build 12.1.5.70575.
