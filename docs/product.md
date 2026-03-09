# Product Brief

## Goal

Build a simple Chrome extension that helps a user reduce time on distracting websites.

## v0 Scope

- Track time by unique hostname for the focused tab of the active window.
- Show current-site status in the popup.
- Show a popup pie-chart breakdown of today's tracked time by hostname.
- Show today's total time for the current hostname and its assigned limit, if one exists.
- Let the user maintain a blocked-site list in the extension options page.
- Let the user maintain per-site daily limits in the extension options page.
- Enforce per-site daily limits only when the current site is also on the blocked-site list.
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

## Later / v1 Candidates

- Expand tracking beyond the focused tab of the active window if the product model becomes clear.
- Add site-group limits.
- Add richer schedule controls.
- Add stronger friction for settings changes beyond a simple cooldown.
- Add import/export or history views if the base experience proves useful.

## Design Principles

- Fast to understand.
- Easy to verify manually.
- Minimal permissions.
- Prefer durable simplicity over feature breadth.
