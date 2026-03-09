# Architecture

## Runtime Pieces

- `manifest.json`: MV3 manifest defining the popup, background service worker, content script, options page, and required permissions.
- `background` service worker: owns active-window tab tracking, site status evaluation, limit checks, blocked-list checks, and popup data assembly.
- `popup`: shows current-host status, assigned limit if one exists, and a pie-chart breakdown of today's tracked usage by hostname.
- `content` script: renders the blocked-state overlay when a site should be blocked.
- `options` page: manages blocked sites, per-site daily limits, schedules, and cooldown-protected changes.

## v0 Tracking Model

- Track only the focused tab of the active window.
- Attribute usage by normalized hostname.
- Merge equivalent hostnames such as `www.youtube.com` and `youtube.com`.
- Ignore browser-internal pages and non-`http`/`https` URLs.

## Data Shape

- Local usage store:
  - `usageByDay[isoDate][hostname] = seconds`
- Settings store:
  - `blockedSites = [hostname, ...]`
  - `siteLimitsByHostname[hostname] = minutes`
  - blocked-window schedule definition
  - cooldown configuration or protected-change state

## Limit Enforcement

- Normalize the current hostname.
- Read today's accumulated usage for that hostname.
- Read the per-site limit for that hostname, if one exists.
- If no per-site limit exists, the site is not over-limit.
- If a per-site limit exists, compare today's usage against that limit.
- Only block with the overlay when the site is both:
  - on the blocked-site list
  - over its per-site daily limit, or inside a blocked schedule window

## UI Surfaces

- `popup` reads current-host usage, limit status, and today's hostname breakdown.
- `options` page edits blocked sites and per-site limits.

## Likely Permissions

- `storage`: persist settings and local usage.
- `tabs`: inspect the active tab in the active window.
- `alarms`: periodically flush tracked time in MV3.
- Host permissions: required for content-script overlay injection on web pages.

## Key Tradeoffs

- Time tracking is approximate and event-driven, not perfectly continuous.
- Blocking via content overlay is easier to build and reason about than network-level blocking.
- Limits are per-site only in v0; group rules and richer schedule logic are deferred.
- Storing limits in minutes keeps editing simpler, while usage remains in seconds for tracking precision.

## When Changing Architecture

- Document each new runtime surface here.
- Record each new permission and why it is required.
- Update `docs/acceptance-checklist.md` with a verification path for new behavior.
