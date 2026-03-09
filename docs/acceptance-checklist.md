# Acceptance Checklist

Use this list before considering a change ready.

## Baseline

- `npm run check` passes.
- The extension loads as an unpacked MV3 extension with no manifest errors.
- Popup, service worker, content script, and options page initialize without uncaught errors.

## v0 Behavior

- Time is accumulated only for the focused tab of the active window.
- Browser pages and non-`http`/`https` pages are ignored without errors.
- The popup shows the current hostname and today's tracked time for that hostname.
- The popup shows the assigned per-site limit for the current hostname when one exists.
- The popup shows no assigned limit for a hostname with no explicit limit rule.
- The popup shows a pie-chart breakdown of today's tracked usage by hostname.
- A per-site limit can be saved in the options page for a normalized hostname.
- Equivalent hostnames such as `www.youtube.com` and `youtube.com` resolve to the same normalized entry.
- A site that exceeds its limit but is not on the blocked-site list is not blocked.
- A site that exceeds its limit and is on the blocked-site list shows the blocking overlay.
- A blocked site that is below its limit is not blocked by the limit rule alone, unless a blocked schedule window also applies.
- Protected settings changes require the configured cooldown flow.

## Documentation

- `AGENTS.md` remains short and points to `docs/`.
- Any new runtime piece or permission is documented in `docs/architecture.md`.
- Any scope change is reflected in `docs/product.md` or `docs/backlog.md`.
