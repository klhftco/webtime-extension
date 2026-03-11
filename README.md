# Chrome Extension Starter Kit (Manifest V3)

A minimal template for building Chrome extensions with Manifest V3.

## Loading the extension

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this project folder.
3. After making changes, click the refresh icon on the extension's card.

## Structure

```
manifest.json       Extension config — permissions, scripts, icons
js/
  config.js         Shared constants (DEVELOPMENT_MODE, DOMAINS_FORBIDDEN)
  fn.js             Shared helpers (dcl, getAllTabs, getAllTabsAudible)
  background.js     Service worker — no DOM access, runs in the background
  content.js        Injected into matching pages — has full DOM access
  popup.js          Runs inside the toolbar popup
  options.js        Runs inside the options page
html/
  popup.html        Toolbar popup UI
  options.html      Options page UI
css/                Stylesheets for popup, options, and content scripts
icon/               Extension icons (16–128px)
```

## Notes

- `DEVELOPMENT_MODE` is `true` when loaded unpacked. Use `dcl()` instead of `console.log()` — it auto-silences in production.
- Background service worker logs: **Inspect views → service worker** on the extensions page.
- Content script logs: DevTools console of the injected page.
- To change which pages the content script runs on, edit `content_scripts.matches` in `manifest.json`.
