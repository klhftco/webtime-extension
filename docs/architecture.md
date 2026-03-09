# Architecture

## Runtime pieces

- `manifest.json`: minimal MV3 manifest with a browser action popup.
- `html/popup.html`: static starter popup.
- `css/popup.css`: styling for the static popup.

## Current constraints

- No background service worker.
- No content scripts.
- No options page.
- No permissions or host permissions.

## When adding architecture

- Document every new runtime surface here.
- Record each new permission and why it is required.
- Update `docs/acceptance-checklist.md` with a verification path for the new behavior.
