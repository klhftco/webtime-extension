# WebTime

Manifest V3 Chrome extension scaffold with the first tracking slice implemented.

## Current implementation

- Track time for the focused `http` or `https` tab of the active window.
- Store today's usage by hostname in extension storage.
- Show the current hostname and tracked time in the popup.
- Show a popup pie-chart breakdown of today's usage by hostname.

## Not implemented yet

- Blocked-site management
- Scheduled blocked windows
- Cooldown-protected settings changes

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
- `docs/backlog.md`
