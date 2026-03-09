# Architecture

## Runtime Pieces

- `manifest.json`: MV3 manifest defining the popup, background service worker, content script, and required permissions.
- `background` service worker: owns active-window tab tracking, schedule evaluation, settings updates, and popup data assembly.
- `popup`: shows current-host status plus a pie-chart breakdown of today's tracked usage by hostname.
- `content` script: renders the blocked-state overlay on matching pages.
- `options` or settings surface: manages blocked sites, schedules, and cooldown-protected changes.

## v0 Tracking Model

- Track only the focused tab of the active window.
- Attribute usage by normalized hostname.
- Accumulate usage for the current day only in the popup-facing view.
- Ignore browser-internal pages and non-`http`/`https` URLs.

## Data Shape

- Settings store:
  - blocked hostnames
  - blocked schedule definition
  - cooldown configuration or protected-change state
- Local usage store:
  - usage keyed by ISO date, then hostname, with values stored in seconds or milliseconds

## Likely Permissions

- `storage`: persist settings and local usage.
- `tabs`: inspect the active tab in the active window.
- `alarms`: periodically flush tracked time in MV3.
- Host permissions for pages where blocking overlays will run.

## Key Tradeoffs

- Time tracking is approximate and event-driven, not perfectly continuous.
- Blocking via content overlay is easier to build and reason about than network-level blocking.
- Popup visualization should stay lightweight; v0 only needs a simple hostname usage breakdown, not a full analytics dashboard.

## When Changing Architecture

- Document each new runtime surface here.
- Record each new permission and why it is required.
- Update `docs/acceptance-checklist.md` with a verification path for new behavior.
