# Changelog

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
