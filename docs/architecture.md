# Architecture

## Runtime Pieces

- `manifest.json`: MV3 manifest defining the popup, background service worker, options page, and required permissions. No content scripts and no `host_permissions` are declared.
- `background` service worker: owns active-window tab tracking, site status evaluation, limit checks, blocked-list checks, declarativeNetRequest (DNR) rule synchronization, and popup data assembly.
- `popup`: shows current-site status, assigned limit if one exists, and a day-navigable pie-chart breakdown of tracked usage by site key.
- blocking is enforced by DNR dynamic redirect rules that send a matching top-level (`main_frame`) request to an internal extension-owned blocked page (`html/blocked.html`); there is no content script.
- `options` page: manages blocked sites, per-site daily limits, schedules, cooldown-protected changes, and a weekly stacked-bar usage view with a selectable detail list.
  - Category settings use an offline category map bundled in the extension.
- `blocked` page (`html/blocked.html`): explains why a site was blocked and hosts the once-a-day "One more minute" control.
  - The `Prevent disabling` tab (`js/protect.js`) is a static, platform-tabbed walkthrough for applying Chrome's `URLBlocklist` policy to `chrome://extensions`. It is documentation only — it reads `chrome.runtime.id` to fill in an `ExtensionSettings` snippet and stores the last-selected platform tab, and writes no policy and no settings.
  - Tabs are selectable by URL hash (`html/options.html#prevent-disabling`), which is how the blocked page deep-links into this tab. An unknown hash is ignored and leaves the default tab active.

## v0 Tracking Model

- Track only the focused tab of the active window.
- Attribute usage by normalized site key.
- Merge equivalent hostnames such as `www.youtube.com` and `youtube.com`.
- Allow path-specific keys such as `youtube.com/shorts`.
- Ignore browser-internal pages and non-`http`/`https` URLs.

## Data Shape

- Local usage store:
  - `usageByDay[isoDate][siteKey] = seconds`
  - `graceBySiteKey[siteKey] = { dayKey, expiresAt }` — the once-a-day "One more minute" grant. Entries whose `dayKey` is not the current local day are pruned on read, which is what enforces the daily reset; `expiresAt` separates a grant that is still running from one already spent today.
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
  - `settingsPasswordHash` (optional)
  - `settingsCooldownStartedAt` (timestamp, optional)
  - blocked-window schedule definition
  - cooldown configuration or protected-change state

## Limit Enforcement

- Normalize the current URL into candidate site keys.
- Read today's accumulated usage for the resolved site key.
- Read the most specific per-site limit for that site key, if one exists.
- If the resolved site key is on the blocked-site list, treat its effective limit as `0` minutes.
- If no per-site limit exists and the site key is not blocked, the site is not over-limit.
- If an effective limit exists, compare today's usage against that limit.
- Redirect to the blocked page when the site is over its effective limit, or inside a blocked schedule window. Redirection is performed by a DNR dynamic rule whose `regexFilter` matches the resolved site key (hostname, optional path, or a category regex) on `main_frame` requests, with an `action.type` of `redirect` targeting `html/blocked.html`.
- For category limits:
  - Resolve the site key's category, if any.
  - Compute the category's total usage as the sum of all site keys mapped to that category.
  - If the category is blocked, treat the category effective limit as `0` minutes.
  - If a category limit exists, compare category usage against that limit.
  - Block if either the site-level rule or category-level rule requires blocking.

## One More Minute (grace)

- The blocked page can grant a single 60-second reprieve per site key per local day.
- Eligibility is decided by `resolveGraceDenialReason`, and the service worker re-evaluates it in `grantGrace` rather than trusting the page, which only supplies a site key.
- Only a minute-limit overrun is extendable. A site key matching the blocked-site list or a blocked category is a hard block and is refused; `buildCurrentSite` therefore ignores grace when `isBlocked || isCategoryBlocked`.
- A grant suppresses enforcement rather than clearing the limit:
  - `syncBlockingRules` skips the limit-derived DNR rule for a graced site key, and skips it in the heartbeat tab sweep.
  - Blocked-site rules and explicitly blocked categories are always emitted regardless of grace.
  - A category *regex* rule has no single site key to skip, so graced hostnames are carved out with `condition.excludedRequestDomains` instead — and only when the category was added by a limit, not by an explicit block.
- A one-shot `grace-expiry` alarm fires at the earliest active expiry and re-runs `syncBlockingRules`, so the site re-blocks on time instead of waiting up to a full heartbeat. The heartbeat is still the backstop.
- Usage keeps accumulating during the reprieve, so a limited site is over its limit again the moment it ends.

## Blocked Page URL Convention

- `buildBlockedPageUrl` is the single builder for `html/blocked.html` links, used by both redirect paths.
- `site`, `limitMinutes`, and `blocked` are percent-encoded query params. `target` is always **last and unencoded**.
- That convention exists because the DNR path builds its URL with `redirect.regexSubstitution`, inserting the matched URL as `\0`; DNR cannot percent-encode. Every `regexFilter` is anchored to the end of the request URL so `\0` is the whole URL.
- `js/blocked.js` therefore reads `target` by slicing the raw query string after `&target=` rather than via `URLSearchParams`, which would truncate a target containing `&`. It accepts the value only if it parses as an `http`/`https` URL, so the parameter cannot inject a `javascript:` or extension URL into the page's links.
- If Chrome rejects the substitution rules, `applyDynamicRules` retries with static `redirect.url` rules. Enforcement still holds; the blocked page just loses the original URL and sends "One more minute" to the site root.

## UI Surfaces

- `popup` reads current-site usage, limit status, and today's site-key breakdown.
- `options` page edits blocked sites and per-site limits.
  - settings changes are gated by either a password or a 5-minute cooldown window
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

## Permissions

- `storage`: persist settings and local usage.
- `tabs`: inspect the active tab in the active window, and navigate already-open over-limit tabs to the blocked page (the heartbeat fallback in `syncBlockingRules`).
- `alarms`: periodically flush tracked time and re-sync blocking rules in MV3 (`heartbeat`), and re-block a site the moment its "One more minute" grant expires (`grace-expiry`).
- `idle`: detect screen lock and system suspend so tracking is paused while the device is not in active use.
- `declarativeNetRequest`: register dynamic redirect rules, built only from local settings/usage, that send over-limit or blocked `main_frame` requests to the extension's own `html/blocked.html`.
- `declarativeNetRequestWithHostAccess`: allows the redirect rules to act on the user's configured sites without broad `host_permissions` or the "read and change all your data on the websites you visit" install warning. This is the narrower permission deliberately chosen in place of host permissions + a content script.

Note: no `host_permissions` are declared. DNR `redirect` rules only act on hosts the extension has access to, so instant blocking on a fresh navigation depends on this; the `tabs`-based heartbeat sweep catches already-open over-limit tabs within roughly one heartbeat as a fallback. Verify navigation-time redirect behavior in `chrome://extensions` when changing this.

## Web Accessible Resources

- `html/blocked.html` is listed in `web_accessible_resources` with `matches: ["<all_urls>"]`.
- This is **not** a permission. The `permissions` array is unchanged and Chrome shows no additional install warning. The grant points outward: it lets web pages reach one extension file, and gives the extension no new capability.
- It is required because a DNR rule cannot redirect a public request to a resource that is not web accessible — Chrome rejects the redirect even though the extension owns the target. Without it, blocking falls back to the `tabs`-based paths, so the blocked site is actually requested and begins rendering before the tab is replaced.
- `matches` cannot be narrowed to the user's configured sites: `web_accessible_resources` is static in the manifest, while blocked sites are user settings.
- The cost is fingerprinting — any page can fetch the URL to detect that WebTime is installed. That is already largely inferable from the redirect itself. Only this one static file is exposed, and it carries no data: everything it displays arrives as query parameters at redirect time.

## Service Worker State Durability

- The active timing state (`activeSessions`, `hostnameSessionMap`, `tabLastUrl`) lives in memory for fast access but is mirrored to `chrome.storage.session` on every mutation.
- MV3 service workers are terminated after a short idle period; without this mirror, each restart would reset every session's `startedAt` and silently discard the elapsed viewing time, so usage would be badly under-counted and limits would be enforced far too late or never.
- On worker restart the state is rehydrated once (`ensureRestored`) before any event handler reads it.
- The `heartbeat` alarm (1 minute) flushes accumulated time and re-runs `syncBlockingRules`, so a tab already open past its limit is redirected within roughly one minute even with no further navigation.
- A single flush interval longer than `MAX_PLAUSIBLE_INTERVAL_SECONDS` (one heartbeat plus margin) is discarded as a likely sleep/suspend gap. `chrome.storage.session` requires no new permission beyond `storage` and is cleared when the browser closes.

## Key Tradeoffs

- Time tracking is approximate and event-driven, not perfectly continuous.
- DNR redirect to an internal blocked page is easier to build, more privacy-preserving, and avoids the broad host-access warning compared to a content script with host permissions; it is still simpler to reason about than network-level filtering.
- Limits are per-site only in v0; group rules and richer schedule logic are deferred.
- Storing limits in minutes keeps editing simpler, while usage remains in seconds for tracking precision.
- Historical daily insights require a clear retention rule; the product target is 4 weeks of prior day-level visibility.
- All-time usage can be derived from historical buckets or stored separately; deriving is simpler, while a separate rollup can be cheaper to query.
- Category limits require a taxonomy and a mapping from site keys to categories; these need to be curated or user-editable.
- Offline categories can include regex fallbacks for hostname-only matching (e.g. adult patterns).
- Password-based settings changes require local hashing and do not protect against extension removal.
- "One more minute" is deliberately asymmetric: a time limit is a budget and can be stretched once a day, while a blocked-site or blocked-category entry is a statement of intent and stays hard. Making everything extendable would mean nothing in the extension is ever a real block.
- Grace is stored per site key rather than as a single global allowance, matching how limits, blocks, and usage are already keyed. The cost is that a user with many limited sites gets many extra minutes per day.
- Blocking `chrome://extensions` is left to Chrome policy applied by the user, documented in the `protect` page. The extension deliberately holds no policy-writing capability and gains no permission from this feature.

## When Changing Architecture

- Document each new runtime surface here.
- Record each new permission and why it is required.
- Update `docs/acceptance-checklist.md` with a verification path for new behavior.
