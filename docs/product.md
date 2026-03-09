# Product Brief

## Goal

Build a simple Chrome extension that helps a user reduce time on distracting websites.

## v0 Scope

- Track time by normalized site key for the focused tab of the active window.
- Show current-site status in the popup.
- Show a popup pie-chart breakdown of today's tracked time by site key.
- Show today's total time for the current site key and its assigned limit, if one exists.
- Let the user maintain a blocked-site list in the extension options page.
- Let the user maintain per-site daily limits in the extension options page.
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

- Add site-group limits.
- Add richer schedule controls.
- Add stronger friction for settings changes beyond a simple cooldown.
- Add a small test harness for pure helper functions.
- Replace approximate active-tab tracking with richer idle detection if needed.
- Expand tracking beyond the focused tab of the active window if the product model becomes clear.

## Design Principles

- Fast to understand.
- Easy to verify manually.
- Minimal permissions.
- Prefer durable simplicity over feature breadth.
