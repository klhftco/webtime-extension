# Product Brief

## Goal

Build a simple Chrome extension that helps a user reduce time on distracting websites.

## Target v0

- Track daily time spent on the active website by hostname.
- Show current-site status in the popup.
- Let the user maintain a blocked-site list.
- Enforce a single default daily limit across all tracked sites.

## Non-goals

- Syncing analytics to a backend.
- Per-category or per-site custom schedules.
- Cross-browser support beyond MV3 Chrome compatibility.
- Perfectly tamper-proof blocking.

## Design principles

- Fast to understand.
- Easy to verify manually.
- Minimal permissions.
- Prefer durable simplicity over feature breadth.
