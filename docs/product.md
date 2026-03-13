# Product Brief

## Goal

Build a simple Chrome extension that helps a user reduce time on distracting websites.

## v0 Scope

- Track time by normalized site key for the focused tab of the active window.
- Pause tracking when the screen is locked or the device is suspended (e.g. lid close, sleep); resume only when the screen is unlocked and the user is active again. Do not pause tracking solely because the user's mouse or keyboard has been idle — passive consumption such as reading or watching should still count.
- Show current-site status in the popup.
- Show popup left and right controls that move the usage visualization by day.
- Show a popup pie-chart breakdown of the selected day's tracked time by site key.
  - when a color slice is hovered, gray out the rest of the pie, and highlight/bold the usage entry in the list below
- Keep the popup's current-site status and assigned limit tied to the current page, not the selected chart day.
- Limit the popup pie chart to the top 15 site keys and group the remainder into `Other`.
- Show today's total time for the current site key and its assigned limit, if one exists.
- Let the user maintain a blocked-site list in the extension options page.
- Let the user maintain per-site daily limits in the extension options page.
- Show a weekly usage visualization in the options page as a stacked bar chart with 7 day bars.
- Show aggregate total browser usage for the displayed week at the top of the weekly view.
- When no day is selected in the weekly view, show a list of the top 30 site keys ranked by total weekly usage.
- When a day is selected in the weekly view, show an unfiltered list of that day's site-key usage sorted by time with second-level resolution.
  - when a day is selected, and a color bar is hovered, gray out the rest of the bar chart and highlight/bold the usage entry in the list below
- Enforce per-site daily limits by blocking sites once they reach their assigned limit.
- Treat blocked-site entries as immediate `0m` limits.
- Enforce scheduled blocked windows for blocked sites.
- Require a cooldown before changing protected settings such as the blocked-site list or enforcement state.

## v0 Non-goals

- Tracking all tabs in all windows at once.
- Site-group limits.
- Schedule-based limits beyond the existing blocked-window behavior.
- Per-site custom schedules.
- Password-based protection against disabling the extension.
- Preventing Chrome-level disable or uninstall.
- Syncing analytics to a backend.
- Cross-browser support beyond MV3 Chrome compatibility.

## v1 Candidates

- Support daily time insights viewing for up to 4 weeks prior.
- Track usage over all time until the user performs an explicit reset in the options page.
- Add a reset control in the options page that zeros all tracked usage.
- Add import/export for settings.

## v2 Candidates

- Add site-group limits and blocking by category.
- Support common categories such as adult, social, shopping, gambling, sports, news, and gaming.
- Category limits should aggregate usage across all sites in the same category.
- Category blocks should apply to all sites in the category.
- Categories should be assigned automatically from an offline list bundled with the extension.
- Add richer schedule controls.
- Add stronger friction for settings changes beyond a simple cooldown:
  - if a password is set, require it to change limits and blocking settings
  - if no password is set, require a minimum 5-minute wait after opening settings before changes are allowed
- Add usage data controls:
  - allow dumping/exporting all usage data
  - allow clearing all usage data with a typed confirmation phrase
  - ~~allow clearing data by day~~ (shipped in v0: "Clear day data" button in weekly usage)
  - require the settings PIN if set (or slow-mode cooldown if no PIN)
- Add a small test harness for pure helper functions.
- Replace approximate active-tab tracking with richer activity detection if needed (e.g. detecting attention loss beyond screen lock).
- Expand tracking beyond the focused tab of the active window if the product model becomes clear:
  - expose an experimental “visible windows” mode so every non-minimized window’s active tab counts (focused mode remains the default).
  - in visible-windows mode treat each normalized hostname as a single tracked identity even if it appears in multiple windows/tabs.
- track "pickups" as switching domains to visit a page
  - originally, iphone tracks how many times a phone is picked up and the immediate first app that's visited
  - to replicate this behavior, detect/count # of times we go from new tab/any URL to the destination site, as long as the domain is unique/different.

## v3 Candidates
- online site-grouping for limits
- picture in picture handling
- ~~import/export limit configurations~~ (shipped: export/import buttons in the Usage data tab)
- scheduled limit controls

## Design Principles

- Fast to understand.
- Easy to verify manually.
- Minimal permissions.
- Prefer durable simplicity over feature breadth.
