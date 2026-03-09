# Acceptance Checklist

Use this list before considering a change ready.

## Baseline

- `npm run check` passes.
- The extension loads as an unpacked MV3 extension with no manifest errors.
- Popup, service worker, content script, and options page initialize without uncaught errors.

## v0 Behavior

- Time is accumulated only for the focused tab of the active window.
- Browser pages and non-`http`/`https` pages are ignored without errors.
- The popup shows the current site key and today's tracked time for that site key.
- The popup shows the assigned per-site limit for the current site key when one exists.
- The popup shows no assigned limit for a site key with no explicit limit rule.
- The popup shows a pie-chart breakdown of today's tracked usage by site key.
- A per-site limit can be saved in the options page for a normalized site key.
- Equivalent hostnames such as `www.youtube.com` and `youtube.com` resolve to the same normalized root entry.
- A path-specific entry such as `youtube.com/shorts` is matched separately from `youtube.com`.
- A site that exceeds its assigned per-site limit is redirected to the blocked page.
- A site on the blocked-site list behaves like a site with a `0m` limit.
- A site key with no explicit limit and not on the blocked-site list is not blocked by the limit rule alone.
- Protected settings changes require the configured cooldown flow.

## Documentation

- `AGENTS.md` remains short and points to `docs/`.
- Any new runtime piece or permission is documented in `docs/architecture.md`.
- Any scope change is reflected in `docs/product.md`.

## v1 Analytics Expectations

- The product can show daily usage insights for the current day plus up to 4 weeks prior.
- Daily insights are grouped by the user's local day boundary, not UTC midnight.
- The product can show all-time usage totals until the user explicitly resets usage.
- Resetting usage from the options page zeros all stored usage and all derived totals.
- After reset, the current-day view, prior-day insights, and all-time totals all show zero usage until new browsing occurs.
