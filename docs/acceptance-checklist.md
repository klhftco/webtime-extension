# Acceptance Checklist

Use this list before considering a feature ready.

## Baseline

- `npm run check` passes.
- The extension loads as an unpacked MV3 extension with no manifest errors.
- Popup, options page, and content script all initialize without uncaught errors.

## Core behavior

- Visiting a normal website and keeping it focused increments usage for that hostname.
- The popup shows hostname, used minutes, and remaining minutes for the active site.
- Clicking `Block site` in the popup causes the overlay to appear on the current site.
- Removing the block clears the overlay after the tab refresh/state push.
- Lowering the daily limit below current usage causes the overlay to appear on the site.
- Browser pages such as `chrome://extensions` are ignored without errors.

## Documentation

- `AGENTS.md` remains short and points to `docs/`.
- Any new permission or architectural change is recorded in `docs/architecture.md`.
- Any scope change is reflected in `docs/product.md` or `docs/backlog.md`.
