# Change Log

All notable changes to the "al-pocket-tools" extension will be documented in this file.

## [0.1.0] - 2026-05-11

### Added

- **Pragma Viewer** — shows all pragma directives (`#pragma warning disable/restore`) across every AL file in the workspace as a three-level navigable tree (pragma identifier → file → line). Click any entry to jump to it in the editor. Includes a Refresh button to re-scan on demand.
- **Version Bump** — commands to increment the `version` field in `app.json` by Major, Minor, or Patch segment, resetting all lower-order segments to zero. Available from the Command Palette and from the `app.json` context menu.
- **Cleanup Duplicate App Files** — scans `.alpackages` and AL project folders for duplicate `.app` files, keeps the highest version, and deletes older copies after confirmation.
- **Region Viewer** — shows all `#region` blocks in the active AL file as a navigable tree in the Explorer sidebar, with live updates and click-to-navigate support.