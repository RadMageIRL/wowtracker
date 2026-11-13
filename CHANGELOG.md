# Changelog

## v0.5.0 (2026-11-13)

Calendar subscriptions, a list of the reminders that are coming with a time of its own for any starred event, links to one event at one time, a Weekly overview in a steadier order, and event details that keep up with the clock. Retail's and WoW: Forever's events, times, calendar files, calendar feeds, identifiers and backups are as in v0.4.0, and everything v0.4.0 saved carries over.

- Subscribe to calendar, beside Export to calendar in Coming up: the calendar feed of the game version and region on screen, as an address to copy, a link that opens Google Calendar's own "Add calendar" question, and a webcal link for calendar apps that take one. The four feeds are the ones v0.4.0 published, byte for byte, always at radmagelabs.com wherever you opened the page. A subscribed calendar is the same for everyone: your filters, stars and hidden events do not apply, it has no resets and no events that repeat every hour or more often, and it carries none of WoW Tracker's reminders.
- A subscribed calendar is not instant. The calendar app decides when it reads the feed again, and I cannot hurry it. In my two tests Google Calendar showed a test feed correctly and followed its changes (moved, renamed, removed and added entries, with no duplicates), the first time about an hour and a half after I published them, the second time only after more than three hours, and when I subscribed again to an address it already knew it showed its old stored copy until then. I have not tested Apple Calendar or Outlook, and the dialog says so. Opening a feed's address in a browser, or importing the file it saves, gives a one-time copy, not a subscription.
- Upcoming reminders, in the Reminders dialog: the next start of each starred event of the game version and region on screen, when its reminder comes and how long before, soonest first, and the reason where none is coming (reminders off, the event hidden, an hourly event without its box ticked, nothing more scheduled). Left open, the list follows the clock: an entry says its time has come when the reminder is due and moves on to the next start when the event begins, without being rebuilt, so a choice you are making keeps the focus.
- A reminder time of its own for any starred event: 5, 15, 30 or 60 minutes, 2 hours or 1 day before, or "as set above" to follow the setting. Events that repeat every hour or more often get the four short choices. These times are kept for each game version apart, and one occurrence is reminded once whatever its time: changing a time after a reminder was shown, or a second tab that still holds the old time, never shows it twice.
- Reminders are still shown only while the page is open in a tab at the reminder's time, and only for the game version on screen. Nothing runs when the page is closed, and the list says so. For anything else, use a calendar file or a calendar subscription with your calendar app's own alerts.
- Links to an event: Copy link, in an event's details, copies an address such as https://radmagelabs.com/wow/#retail/darkmoon-faire/us/20261206T0800Z, which names the game version, the event, the region and the start in UTC. Whoever follows it sees those details in their own time zone.
- A link picks its game version and region for that visit only. It never overwrites what you have saved: nothing is written when a link opens, a line under the header says "Showing Europe, the region of the link you opened. Your saved region is still Americas." with Back and Keep, and only Keep or a region button saves a region. The link's game version is not saved either, exactly as with a link ending in #forever. Once the details are closed the link leaves the address, so a reload or a bookmark is your own page again.
- A link that cannot be used says so and changes nothing: an unknown or removed event, another game version, or a link that cannot be read each get one line and open nothing. A time that has ended, or that the schedule no longer has, opens the event now or next and says which; a hidden event opens and says it is hidden.
- Weekly overview: what runs the whole week comes first, then the rest by start, then by name, so the order no longer depends on how the data happens to list things. The one-line summaries of events that repeat every hour or more often (Aqir Invasions, Curse Surges) stay at the bottom of each week. When a Predicted or Predicted time label is in the overview, one line under the heading says what that label means.
- Event details keep up with the clock while they are open. Before, the countdown stopped at "in 0s" when the event began. Now the line turns to "On now" with the time left at the start and to "Ended" at the end, in the second it happens, and the other region's line changes at its own start and end. The details stay with the occurrence they opened on instead of moving to the next one, only the lines that changed are written, the buttons and the focus stay where they were, and a screen reader hears the start or the end once. A new time zone on the device, or a region or time display changed in another tab, is drawn into open details too.
- Backups keep their format. Each game version's part now holds its events' own reminder times; a backup made before v0.5.0 has none, so restoring it leaves those times as they are, and the preview says so. Backups from v0.1 to v0.4 still restore.
- Going back is safe: v0.4.0 reads everything v0.5.0 saves, leaves the new reminder times untouched (while it is in use every reminder follows the setting), and opens a v0.5.0 link as your own page.

Schedule data:

- Retail: r2, unchanged.
- WoW: Forever: r2, unchanged. I checked it again on November 13, 2026 against the newest game build (1.60.1.70938): every published window still matches the game's calendar data, and the build adds nothing later. Still not confirmed, and still shown as before: the server clocks (US Central time in the Americas, Central European time in Europe; more players have said so in both regions, Blizzard has not), so every WoW: Forever time stays labeled Predicted time; daylight saving time, which cannot be seen before March 2027; the daily and weekly reset times (players report the weekly reset on Tuesday in the Americas and Wednesday in Europe, but nobody has given an hour, so the page still says "Not published"); how the Call to Arms weeks repeat (one week has now been seen in game, which is not yet a rotation); Noblegarden's end; and the hour the raids open on December 9, 2026.

## v0.4.0 (2026-11-09)

Quick filters, a Weekly overview that names its dates, and calendar feeds published for later subscriptions. Retail's and WoW: Forever's events, times, calendar files, identifiers and backups are as in v0.3.1, and everything v0.3.1 saved carries over.

- Show only, at the top of the filters: Today, This week, Starred and Holidays. Today keeps what is on at some point in your day (your midnight to the next) and only those times, in Coming up, the Weekly overview and the Event calendar; This week does the same for the week the Weekly overview shows first (the reset week, or Monday to Monday in WoW: Forever); Holidays keeps the holidays. They narrow what your categories, stars, hidden events and search already show, so they combine (Today and Starred: your starred events on today), and a line says what they keep and how many events. Today, This week and Holidays are not saved and never change your saved settings. Starred is the saved filter it always was, now a button in that row in place of the All and Starred pair. On phones the row folds with the other filters, so the first screen is as it was, and the folded line names what is on.
- The Weekly overview names the date of every start and end. A bonus week now reads "Wed, Nov 11, 5:00 AM to Wed, Nov 18, 4:00 AM" instead of "Wed 5:00 AM to Wed 4:00 AM", which looked like an hour backwards; something within one day says its date once ("Sun, Nov 15, 2:00 PM to 4:00 PM"); an end at midnight is the next day's. "On now" shows only in this week's column, not again beside what carries on into next week.
- Calendar feeds, published but not offered on the page yet: four calendar files next to the page, one per game version and region (calendar/retail-americas.ics, calendar/retail-europe.ics, calendar/forever-americas.ics and calendar/forever-europe.ics), rebuilt whenever the schedule data changes. A calendar app subscribed to one picks up changes on its own schedule. Each holds the entries Export to calendar would give, from two weeks before the data was reviewed to where it ends, without events that repeat every hour or more often, with "(Predicted)" or "(Predicted time)" where the page shows it, and one all-day entry where each known schedule ends. There is no Subscribe button yet: I have seen Google Calendar subscribe to a test feed written the same way and follow its changes, but I have not tested Apple Calendar or Outlook.
- Export to calendar and Add to calendar save the same files as in v0.3.1 for the same filters, byte for byte (only the moment of download differs). Holidays and Starred narrow an export as they narrow the lists; Today and This week do not, since the dialog has its own range.
- Behind the scenes: the tests run with Linux and Android-like fonts on every push; a schedule comparison tool reports what a new game build changes in the calendar data and never edits it; the WoW: Forever test data keeps fingerprints of the game's descriptions instead of their text; the page's structured-data description now matches its meta description.

Schedule data:

- Retail: r2, unchanged.
- WoW: Forever r2 (2026-11-09), wording only, no time changed: the Americas server clock (US Central time) has now been seen twice, both in standard time: the fishing contest on November 8, 2026, and a player's in-game clock on November 7, 2026 (two hours ahead of Pacific time, UTC-6). Blizzard has not said, daylight saving time and the resets have not been seen, and every WoW: Forever time is still labeled Predicted time.

## v0.3.1 (2026-11-09)

Maintenance: the news header on phones. No schedule data or feature changes; settings saved by v0.3.0 and earlier carry over. v0.3.0 was tagged and on the site for part of November 9, 2026, and this release replaces it.

- On screens 360 to 419 px wide, the "All versions" label under Latest news now always takes its own line. With fonts wider than Windows' (on Android and Linux), the title, the label and the news buttons did not fit on one line there, so Show all and Collapse dropped to a second line when the headlines arrived. Nothing else on the page moved.

Schedule data:

- Retail: r2, unchanged.
- WoW: Forever: r1, unchanged.

## v0.3.0 (2026-11-09)

World of Warcraft: Forever, as a second game version beside Retail. Retail's events, times, calendar files and backups are as in v0.2.0, and everything v0.2 saved carries over.

- A Retail / Forever switch beside the title picks the game version. The page shows one at a time and remembers your choice; a link ending in #forever opens WoW: Forever.
- WoW: Forever events from the game's own calendar data, through November 7, 2027: the Darkmoon Faire (Elwynn Forest and Thunder Bluff in turn), the Stranglethorn Fishing Extravaganza every Sunday, the Feast of Winter Veil, the Lunar Festival, Love is in the Air, the Midsummer Fire Festival, the Fireworks Spectacular (Americas only), the Harvest Festival and Hallow's End.
- Each region on its own server clock. The calendar data gives server time, which I read as US Central time in the Americas (Oceanic realms included) and Central European time in Europe, from what players saw at the first fishing contest. Blizzard has not said, so every WoW: Forever time is labeled Predicted time, and its details say why.
- WoW: Forever's daily and weekly reset times are not published, so the page says "Not published" instead of counting down, the weekly overview uses calendar weeks, and the checklist is off there. Nothing borrows Retail's reset times.
- What the data does not time is listed under the calendar instead: the resets, the Call to Arms battleground weeks, Noblegarden (no end), the raids opening on December 9 (no hour), the Launch Celebration and Children's Week.
- Each game version keeps its own stars, hidden events, categories, Starred view and checklist. The region, theme, time display, how far ahead Coming up looks, the news settings and the reminder settings are shared.
- Reminders come from the game version on screen. What has been shown is kept per game version, so an event at the same moment in both (the Lunar Festival in Europe) reminds you once in each. WoW: Forever notices name the game and keep "(Predicted time)".
- Calendar files from WoW: Forever have their own file names (wowtracker-forever-...), calendar name and identifiers, and each entry adds its server time, how it repeats and how far the data reaches. Retail's file names, calendar names, identifiers and text are as in v0.2.0, and one file never mixes the two.
- Back up settings keeps both game versions apart, with the shared settings. Restoring shows, part by part, what would change and what stays, and changes nothing until Replace; a game version the backup does not hold stays as it is, and the game version on screen never changes. Backups from v0.1 and v0.2 restore Retail and the shared settings. v0.2.0 refuses a v0.3 backup and changes nothing.
- Latest news is labeled "All versions": Blizzard's list mixes Retail and WoW: Forever posts and gives no way to tell them apart.
- In WoW: Forever, Export to calendar does not offer to leave predicted events out (every time there is Predicted time), and Reminders does not offer hourly events (it has none).
- The page no longer jumps as it loads. It used to draw an empty page and then push everything down as the lists filled in (a layout shift of about 0.9 on a computer); now it is drawn once, complete. The page description and the link preview text mention WoW: Forever.

Schedule data:

- Retail: r2, unchanged.
- WoW: Forever r1 (2026-11-08), first dataset: 9 events through November 7, 2027, from the game's calendar data in build 1.60.1.70862. Every start time is Predicted time; times from March 2027 assume the servers change their clocks for daylight saving time, which has not been seen yet.

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
