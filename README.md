# WebTime

Manifest V3 Chrome extension scaffold with tracking, per-site limits, and redirect-based blocking in progress.

## Current implementation

- Track time for the focused `http` or `https` tab of the active window.
- Store today's usage by normalized site key in extension storage.
- Show the current site key, tracked time, assigned limit, and a pie-chart breakdown in the popup.
- Manage blocked sites and per-site daily limits in the options page, including path-specific entries such as `youtube.com/shorts`.
- Redirect blocked sites to an internal blocked page when they reach their assigned limit.
- Treat blocked-site entries as immediate `0m` limits.

## Not implemented yet

- Scheduled blocked windows
- Cooldown-protected settings changes
- Site-group limits

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
