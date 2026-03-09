# WebTime Agent Guide

Use this repo as a small, explicit harness for MV3 extension work.

## First read

1. Read `docs/product.md` for scope and non-goals.
2. Read `docs/architecture.md` before changing runtime behavior.
3. Read `docs/acceptance-checklist.md` before closing any task.

## Working rules

- Keep the extension simple and local-first. Prefer `chrome.storage` and event-driven MV3 APIs.
- Treat `docs/` as the system of record. Update docs when behavior, scope, or decisions change.
- Narrow permissions instead of adding broad APIs by default. Justify every new permission in `docs/architecture.md`.
- Favor manual verification steps that are easy to reproduce in `chrome://extensions`.
- Do not introduce a build step unless the repo clearly benefits from it.

## Current implementation boundaries

- Time is tracked per hostname for the active focused tab only.
- Limits are global by default, not per-site configurable yet.
- Blocking is implemented as an in-page overlay, not network interception.
- `http` and `https` pages are tracked; browser internal pages are ignored.
