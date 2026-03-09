# WebTime Agent Guide

Use this repo as a bare MV3 extension harness.

## First read

1. Read `docs/product.md` for current scope.
2. Read `docs/architecture.md` before adding runtime behavior.
3. Read `docs/development.md` for the repo workflow.
4. Read `docs/acceptance-checklist.md` before closing any task.

## Working rules

- Keep the baseline minimal until a feature is explicitly added.
- Treat `docs/` as the system of record for scope and architecture.
- Add permissions only when a concrete feature requires them.
- Prefer the smallest possible MV3 change set.
- Do not add a build step unless the repository clearly needs one.

## Current implementation boundaries

- The extension only provides a static popup.
- There is no service worker, content script, storage, or options page.
- Any new runtime capability should be documented before or alongside implementation.
