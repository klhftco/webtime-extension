# WebTime

Manifest V3 Chrome extension that tracks time on websites, enforces daily limits, and blocks distracting sites.

## Current implementation

- Track time for the focused `http` or `https` tab of the active window.
- Pause tracking when the screen is locked or the device is suspended; resume on unlock. Passive consumption (reading, watching) still counts.
- Track "pickups" — the number of times you navigate to a site from a different domain or new tab.
- Store usage by normalized site key (e.g. `youtube.com`, `youtube.com/shorts`) in local extension storage.
- Popup: current-site status, today's tracked time, assigned limit, and a day-navigable pie-chart breakdown with hover highlighting.
- Options page: per-site daily limits (including path-specific entries), blocked-site list, and scheduled blocked windows.
- Cooldown-protected settings changes: requires either a PIN or a 5-minute wait before modifying blocked sites or limits.
- Redirect blocked or over-limit sites to an internal blocked page.
- Weekly stacked-bar chart in options with scrollable week navigation and a previous-week comparison overlay.
- Export and import usage data as JSON; clear all usage or individual days.
- Export and import limit and settings configurations.

## Not implemented yet

- Site-group and category limits
- Richer schedule controls beyond per-site blocked windows
- Preventing Chrome-level extension disable or uninstall
- Syncing data to a backend
- Cross-browser support beyond MV3 Chrome

## Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load this repository as an unpacked extension.
4. Use `npm run check` for lightweight manifest/package validation.

## Docs

- `AGENTS.md`
- `docs/development.md`
- `docs/deployment.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/acceptance-checklist.md`
