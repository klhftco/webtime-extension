# Architecture

## Runtime Pieces

- `manifest.json`: MV3 manifest defining the popup, background service worker, content script, options page, and required permissions.
- `background` service worker: owns active-window tab tracking, site status evaluation, limit checks, blocked-list checks, and popup data assembly.
- `popup`: shows current-site status, assigned limit if one exists, and a day-navigable pie-chart breakdown of tracked usage by site key.
- `content` script: redirects a blocked page to an internal extension-owned blocked screen.
- `options` page: manages blocked sites, per-site daily limits, schedules, cooldown-protected changes, and a weekly stacked-bar usage view with a selectable detail list.
  - Category settings use an offline category map bundled in the extension.

## v0 Tracking Model

- Track only the focused tab of the active window.
- Attribute usage by normalized site key.
- Merge equivalent hostnames such as `www.youtube.com` and `youtube.com`.
- Allow path-specific keys such as `youtube.com/shorts`.
- Ignore browser-internal pages and non-`http`/`https` URLs.

## Data Shape

- Local usage store:
  - `usageByDay[isoDate][siteKey] = seconds`
  - retain daily buckets for up to 4 weeks of prior insights
  - use a local-day key rather than a UTC-day key for product-facing daily views
  - support either:
    - derived all-time totals by summing stored usage
    - or an explicit `usageAllTime[siteKey] = seconds` aggregate
- Settings store:
  - `blockedSites = [siteKey, ...]`
  - `siteLimitsByHostname[siteKey] = minutes`
  - `blockedCategories = [categoryId, ...]`
  - `categoryLimitsById[categoryId] = minutes`
  - blocked-window schedule definition
  - cooldown configuration or protected-change state

## Limit Enforcement

- Normalize the current URL into candidate site keys.
- Read today's accumulated usage for the resolved site key.
- Read the most specific per-site limit for that site key, if one exists.
- If the resolved site key is on the blocked-site list, treat its effective limit as `0` minutes.
- If no per-site limit exists and the site key is not blocked, the site is not over-limit.
- If an effective limit exists, compare today's usage against that limit.
- Redirect to the blocked page when the site is over its effective limit, or inside a blocked schedule window.
- For category limits:
  - Resolve the site key's category, if any.
  - Compute the category's total usage as the sum of all site keys mapped to that category.
  - If the category is blocked, treat the category effective limit as `0` minutes.
  - If a category limit exists, compare category usage against that limit.
  - Block if either the site-level rule or category-level rule requires blocking.

## UI Surfaces

- `popup` reads current-site usage, limit status, and today's site-key breakdown.
- `options` page edits blocked sites and per-site limits.
- Future analytics surfaces should expose:
  - daily insights for the current day plus up to 4 weeks prior
  - all-time usage summaries
  - a reset control that zeros all stored usage
- Popup day navigation should affect only the visualization dataset, not the current-site status panel.
- Popup pie-chart aggregation may group low-ranked entries into `Other` after the top 15 site keys.
- Weekly options analytics should expose:
  - a weekly total across the displayed 7 days
  - a default top-30 list ranked by total weekly usage
  - an unfiltered selected-day list sorted by usage with second-level resolution

## Likely Permissions

- `storage`: persist settings and local usage.
- `tabs`: inspect the active tab in the active window.
- `alarms`: periodically flush tracked time in MV3.
- Host permissions: required for content-script evaluation and redirect enforcement on web pages.

## Key Tradeoffs

- Time tracking is approximate and event-driven, not perfectly continuous.
- Redirecting to an internal blocked page is easier to build and reason about than network-level blocking.
- Limits are per-site only in v0; group rules and richer schedule logic are deferred.
- Storing limits in minutes keeps editing simpler, while usage remains in seconds for tracking precision.
- Historical daily insights require a clear retention rule; the product target is 4 weeks of prior day-level visibility.
- All-time usage can be derived from historical buckets or stored separately; deriving is simpler, while a separate rollup can be cheaper to query.
- Category limits require a taxonomy and a mapping from site keys to categories; these need to be curated or user-editable.
- Offline categories can include regex fallbacks for hostname-only matching (e.g. adult patterns).

## When Changing Architecture

- Document each new runtime surface here.
- Record each new permission and why it is required.
- Update `docs/acceptance-checklist.md` with a verification path for new behavior.
