# Architecture

## Runtime pieces

- `js/background.js`: service worker that owns settings, time accumulation, and tab state refresh.
- `js/content.js`: receives the effective site state and renders or removes the overlay.
- `js/popup.js`: shows current-site status and toggles manual blocking.
- `js/options.js`: edits the blocked list and default daily limit.
- `js/shared.js`: shared constants and pure helpers that can run in every extension context.

## Data model

- `chrome.storage.sync.blockedSites`: array of normalized hostnames.
- `chrome.storage.sync.defaultDailyLimitMinutes`: integer limit applied to every site.
- `chrome.storage.local.usageByDay`: object keyed by ISO date, then hostname, with values in seconds.

## Permission rationale

- `storage`: persist settings and local usage.
- `tabs`: inspect the active tab and refresh state across open tabs.
- `alarms`: flush active time in MV3 without a persistent background page.
- `contextMenus`: quick entry point to open settings from the action.
- `host_permissions <all_urls>`: inject the content script on trackable pages.

## Known tradeoffs

- Time tracking is approximate to the second and flushes on focus changes plus a 1-minute alarm heartbeat.
- Blocking uses a DOM overlay, so a user can disable the extension and bypass it.
- Hostname normalization strips `www.` and paths but does not collapse subdomains beyond that.

## When changing architecture

- Document new permissions here.
- Add or update a manual verification scenario in `docs/acceptance-checklist.md`.
- Keep the storage schema explicit and backwards-compatible when possible.
