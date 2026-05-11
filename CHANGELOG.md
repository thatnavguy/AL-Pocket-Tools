# Change Log

All notable changes to the "al-pocket-tools" extension will be documented in this file.

## [0.3.0] - 2026-05-12

### Added

- **Region Viewer: Refresh Mode setting** (`al-pocket-tools.regionViewer.refreshMode`) — choose between `manual` (Refresh button only, default) and `onOpenFile` (auto-refreshes when switching to a different file, only while the view is visible). The welcome message in the view updates to match the active mode.

## [0.2.0] - 2026-05-12

### Changed

- **Region Viewer** — removed automatic refresh on every editor switch and keystroke. The view now updates only when you click the Refresh button in the view title bar, eliminating continuous background CPU usage while editing.
- **Pragma Viewer** — removed automatic scan on view visibility. The view now only scans when you click Refresh explicitly; it no longer starts a workspace-wide file scan on extension activation.
- **Version Status Bar** — `app.json` path resolution is now cached per workspace folder and only re-resolved when files are created or deleted. This eliminates repeated directory-walk `stat()` calls on every editor tab switch.

## [0.1.0] - 2026-05-11

### Added

- **Pragma Viewer** — shows all pragma directives (`#pragma warning disable/restore`) across every AL file in the workspace as a three-level navigable tree (pragma identifier → file → line). Click any entry to jump to it in the editor. Includes a Refresh button to re-scan on demand.
- **Version Bump** — commands to increment the `version` field in `app.json` by Major, Minor, or Patch segment, resetting all lower-order segments to zero. Available from the Command Palette and from the `app.json` context menu.
- **Cleanup Duplicate App Files** — scans `.alpackages` and AL project folders for duplicate `.app` files, keeps the highest version, and deletes older copies after confirmation.
- **Region Viewer** — shows all `#region` blocks in the active AL file as a navigable tree in the Explorer sidebar, with live updates and click-to-navigate support.