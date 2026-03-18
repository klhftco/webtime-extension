# Deployment Runbook

This repo currently supports two practical release modes: local unpacked development and Chrome Web Store publication.

## Local unpacked load

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the repository root:
   - `C:\Users\klhft\Downloads\school\semesters\winter-2024\extension\webtime-extension`
5. Confirm the extension appears without manifest errors.
6. Click the extension action and verify the popup opens.

## Local update loop

1. Make code or manifest changes.
2. Run `npm run check`.
3. Return to `chrome://extensions`.
4. Click the extension's reload button.
5. Re-run the relevant checks in `docs/acceptance-checklist.md`.

## Release preparation

Before packaging or publishing:

1. Bump the version in `manifest.json`.
2. Run `npm run check`.
3. Confirm the extension loads locally with no manifest errors.
4. Walk through the relevant acceptance checklist items.
5. Review `manifest.json` permissions and remove anything unnecessary.

## Package for submission

Create a zip from the contents of the repository root.

Rules:

- Zip the extension files themselves, not a parent folder that contains the repo.
- Ensure `manifest.json` is at the top level of the zip.
- Do not include local-only clutter such as `.git/`.

## Publish to the Chrome Web Store

1. Go to the Chrome Web Store Developer Dashboard.
2. Create a new item or open the existing extension listing.
3. Upload the release zip.
4. Fill in store listing fields, screenshots, and privacy disclosures as required.
5. Review the permission warnings shown by Chrome Web Store.
6. Submit the item for review.

## Post-publish checks

1. Install the published extension from the store listing or test listing.
2. Confirm the installed version matches the version in `manifest.json`.
3. Verify the popup opens and core behaviors still work in a clean browser profile.

## Notes

- If future features introduce user data collection, remote services, or broader permissions, update this runbook with privacy and review steps.
- If automated packaging is added later, document the exact command here and keep the manual process as fallback.
