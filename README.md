# WebTime

Minimal Manifest V3 scaffold for a Chrome extension focused on website time tracking and lightweight blocking.

## Current scope

- Track time on the active `http` and `https` tab by hostname.
- Enforce a default daily time limit with a page overlay.
- Allow manual blocking per hostname from the popup or options page.
- Keep future agent work grounded in `AGENTS.md` and `docs/`.

## Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load this repository as an unpacked extension.
4. Use `npm run check` for lightweight manifest/package validation.

## Docs

- `AGENTS.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/acceptance-checklist.md`
- `docs/backlog.md`
