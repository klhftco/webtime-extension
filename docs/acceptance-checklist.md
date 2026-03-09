# Acceptance Checklist

Use this list before considering a change ready.

## Baseline

- `npm run check` passes.
- The extension loads as an unpacked MV3 extension with no manifest errors.
- Popup, service worker, content script, and settings surface initialize without uncaught errors.

## v0 Behavior

- Time is accumulated only for the focused tab of the active window.
- Browser pages and non-`http`/`https` pages are ignored without errors.
- The popup shows the current hostname and today's tracked time for that hostname.
- If a limit applies to the current hostname, the popup shows that limit.
- The popup shows a pie-chart breakdown of today's tracked usage by hostname.
- A blocked site during a blocked window shows the blocking overlay.
- Protected settings changes require the configured cooldown flow.

## Documentation

- `AGENTS.md` remains short and points to `docs/`.
- Any new runtime piece or permission is documented in `docs/architecture.md`.
- Any scope change is reflected in `docs/product.md` or `docs/backlog.md`.
