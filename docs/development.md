# Development Workflow

Use this repo as a small harness, not just a code dump.

## What harness-aligned development means here

- Keep instructions short in `AGENTS.md`.
- Put product intent, architecture, and verification in `docs/`.
- Make changes that are easy for the next agent or teammate to understand and continue.
- Add only the runtime surfaces and permissions that a current feature actually needs.

## Default workflow

1. Define the change in words first.
   - Update `docs/product.md` if the feature changes scope.
   - Update `docs/architecture.md` if the runtime shape or permissions will change.

2. Define how the change will be checked.
   - Add or update a scenario in `docs/acceptance-checklist.md`.
   - Keep verification concrete and reproducible.

3. Make the smallest viable implementation.
   - Start from the current minimal MV3 scaffold.
   - Add one runtime surface at a time, such as a popup script, options page, service worker, or content script.

4. Validate the result.
   - Run `npm run check`.
   - Load the extension in `chrome://extensions`.
   - Walk through the relevant acceptance checklist items.

5. Record the final shape.
   - If the implementation differs from the original plan, update the docs to match reality.

## Feature planning guidance

- Prefer a single feature branch or task at a time.
- Write down permission rationale before adding permissions to `manifest.json`.
- Do not add a build system, framework, or storage layer unless the feature clearly justifies it.
- Keep non-goals explicit so the repo does not drift into accidental complexity.

## Good examples of harness behavior

- Adding a service worker only after documenting what events it owns.
- Adding `storage` permission only when there is a defined settings or state need.
- Adding a popup script only after the popup behavior is described and testable.

## Bad examples of harness behavior

- Adding multiple permissions "just in case".
- Creating background, content, and options files before they serve a concrete feature.
- Leaving behavior undocumented and expecting future contributors to infer intent from code alone.
