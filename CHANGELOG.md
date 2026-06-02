# Change Log

All notable changes to the "al-pocket-tools" extension will be documented in this file.

## [0.12.0] - 2026-06-02

### Added

- **Parameter Alignment** — toggle procedure declarations between a single-line layout and a vertical layout (one parameter per line, 4-space indent relative to the `procedure` keyword) via the lightbulb code action (`Ctrl+.`) when the cursor is on any line of the declaration. If the signature is already split across lines but inconsistently formatted (e.g. first parameter on the same line as the keyword, irregular indentation), a **Normalize parameter alignment** action appears alongside **Collapse parameters to single line**. Applies to `procedure` and `trigger` declarations with any visibility modifier (`local`, `internal`, `protected`).

## [0.11.0] - 2026-06-02

### Added

- **Add SetLoadFields** — new command (right-click → **AL Pocket Tools** → **Add SetLoadFields**, or Command Palette) that analyzes which fields are accessed on a Record variable in the current procedure and inserts a `SetLoadFields` call immediately before the first `Get`/`Find*` retrieval. If a `SetLoadFields` already exists, newly discovered fields are merged in rather than duplicated. Analysis goes **one level deep** into called procedures within the same file (both `var` and by-value parameters) so fields used in helpers are also captured. Supports local variables, procedure parameters, and **global variables** declared at the codeunit/object level. Triggers and `temporary` record declarations are also handled.

- **AL Pocket Tools context submenu** — all editor right-click commands for `.al` files (Add SetLoadFields, Show/Change Procedure Visibility, Search Assignments) and `launch.json` files (Paste/Save/Clear Launch Config) are now grouped under a single **AL Pocket Tools** fly-out submenu instead of appearing as individual top-level items.

### Fixed

- **Global record variables not detected by Add SetLoadFields** — variables declared in a codeunit/object-level `var` section (outside any procedure) are now included in the record variable selection list.
- **Triggers not recognised** — `trigger` blocks are now parsed alongside `procedure` blocks, so Add SetLoadFields works inside event subscriber triggers and table/page triggers.

## [0.10.0] - 2026-05-27

### Added

- **Assignment Tracker** — new panel in the AL Pocket Tools sidebar that finds every place a specific AL field or variable is assigned across the workspace or the current file. Four assignment patterns are recognised:
  - `Validate()` — calls to `.Validate(FieldName, ...)` (icon: event symbol)
  - `Direct :=` — direct assignment `Record.Field :=` or bare variable `:=` (icon: arrow)
  - `Compound +=/-=/*=/=` — compound arithmetic assignments (icon: operator symbol)
  - `TransferFields()` — bulk-copy calls `.TransferFields(...)`, labelled *(bulk assign)* (icon: package)
  - Results are grouped first by **kind** (Validate / Direct / Compound / TransferFields), then by file, then by line. Only kinds with matches are shown.
  - Run via **Search Assignments** from the view toolbar, Command Palette, or the right-click context menu in any `.al` file. The field name at the cursor is pre-filled.
  - **Refresh** re-runs the last search with the same field name and scope.
  - **Toggle Scope** switches between Workspace and Current File without re-entering the field name.
  - Leave the field name blank to find **all** assignments in scope regardless of name.
  - Setting `al-pocket-tools.assignmentTracker.includeTransferFields` (default `true`) controls whether `TransferFields()` hits are included.

- **AL Pocket Tools sidebar** — new activity bar container that groups AL-specific tree views in one place. The sidebar currently hosts **Assignment Tracker** and **Pragma Viewer**. Region Viewer and Report Viewer remain in the Explorer sidebar.

### Changed

- **Pragma Viewer** moved from the Explorer sidebar into the new AL Pocket Tools activity bar sidebar.

## [0.9.0] - 2026-05-22

### Added

- **Rainbow Indent** — highlights each indentation level in the active editor with a distinct background color. Press `Ctrl+Shift+I` (`Cmd+Shift+I` on Mac) to show; the highlight dismisses automatically the moment you type anything. Pressing the keybinding again before typing also dismisses it manually. Six semi-transparent colors (teal, green, amber, pink-red, blue, purple) cycle across indent levels, tuned for dark themes. Indent width is auto-detected from the file's `editor.tabSize` / `editor.insertSpaces` settings.
  - New setting `al-pocket-tools.rainbowIndent.onEditorSwitch` (`autoHide` / `follow`, default `autoHide`) controls whether the highlight is dismissed or re-applied when switching to a different editor tab.

## [0.8.1] - 2026-05-21

### Fixed

- **Version Bump: status bar immediate refresh** — after running any version bump command (`Bump Version`, `Increment Major/Minor/Build/Revision`), the version status bar now updates immediately instead of waiting for an editor switch or file save.

### Changed

- **README: VS Marketplace badge** — added an install badge linking to the extension's marketplace page.

## [0.8.0] - 2026-05-18

### Added

- **Report Viewer: requestpage triggers** — `OnInit`, `OnOpenPage`, `OnClosePage`, and any other triggers defined inside the `requestpage` block are now shown as children of the `requestpage` section, each navigable by click.
- **Report Viewer: report extension support** — `.al` files that start with `reportextension` are now parsed. The `dataset` section shows each `add(DataItem)` and `modify(DataItem)` entry (description shows `add` or `modify`), with any triggers defined inside listed as children.
- **Report Viewer: Refresh Mode setting** (`al-pocket-tools.reportViewer.refreshMode`) — choose between `manual` (Refresh button only, default) and `onOpenFile` (auto-refreshes when switching to a different file, only while the view is visible). The welcome message in the view updates to match the active mode.
- **Report Viewer: `.dal` file support** — decompiled AL files opened via Go to Definition from `.app` packages (`.dal` extension) are now recognised and can be refreshed manually.

### Fixed

- **Report Viewer: namespace / using / comment headers** — files that begin with `namespace`, `using`, `//` line comments, `///` doc comments, `#if`/`#pragma` preprocessor directives, or `/* */` block comment lines are now correctly identified as report files instead of being silently ignored.

## [0.7.0] - 2026-05-18

### Added

- **Report Viewer** — new tree view panel in the Explorer sidebar that parses the active AL report file and displays its structure as a navigable tree. Sections shown:
  - **dataset** — all dataitem declarations, nested recursively.
  - **requestpage** — click to jump to the `requestpage` block.
  - **rendering** — each layout entry with its name and type (RDLC / Word / Excel).
  - **labels** — all `Name: Label '...'` declarations inside the labels block.
  - **triggers** — report-level triggers (`OnPreReport`, `OnPostReport`, `OnInitReport`, `OnPreRendering`, `OnPostRendering`).
  - **var** — by default shows a single node with a count of variables and click-to-navigate (e.g. `28 variables`). Enable `al-pocket-tools.reportViewer.showVarDeclarations` to expand the full list.
  - **procedures** — all procedures defined directly on the report object.
  - Clicking any tree node navigates to its declaration in the editor.
  - The view loads once when an AL report file becomes active and does not auto-refresh. Use the **Refresh** button in the view title bar to re-parse. The view does not load when it is hidden.

### Changed

- **Report Viewer: `al-pocket-tools.reportViewer.showVarDeclarations`** — new boolean setting (default `false`). When `false`, the var section shows as a single leaf node with a variable count. When `true`, every variable declaration is listed as a child node. Changing the setting immediately re-parses the active report.

### Added

- **Procedure Visibility** — new feature for inspecting and changing procedure visibility in AL files. Three commands:
  - `AL Pocket Tools: Show Procedure Visibility` — reports the number of `local`, `internal`, and `public` procedures in the active AL file. In **list** mode (default) shows a searchable list of every procedure with its visibility and line number; selecting one navigates to it. In **dialog** mode shows a simple counts popup. Controlled by the `al-pocket-tools.procedureVisibility.reportStyle` setting (`list` / `dialog`). Available from the editor right-click context menu and Command Palette.
  - `AL Pocket Tools: Change Procedure Visibility...` — picks a source visibility (showing only those present in the file, with counts), then a target, then changes all matching procedures. Supports all six combinations (local ↔ internal, local ↔ public, internal ↔ public). Confirmation is configurable via `al-pocket-tools.procedureVisibility.confirmationStyle`: `once` (single dialog for the whole batch, default) or `perProcedure` (Yes / Yes to All / Skip / Cancel per procedure). Available from the editor right-click context menu and Command Palette.
  - `AL Pocket Tools: Change Procedure Visibility... (Project)` — same source/target flow as the file command, then scans all AL files in the workspace and applies changes in a single atomic edit. Always uses single confirmation. Shows a summary of procedures changed and files affected. Available from the Command Palette.

- **Launch Config Manager: Clear Launch Configurations** — new command (`AL Pocket Tools: Clear Launch Configurations`) that sets the `configurations` array in the open `launch.json` to `[]`. Shows a confirmation dialog with the number of entries that will be removed before making any change. Available from the editor right-click context menu and Command Palette.

## [0.5.0] - 2026-05-13

### Added

- **Launch Config Manager** — save AL launch configurations to VS Code user settings (`al-pocket-tools.launch.configurations`) and paste them into any project's `launch.json` via the editor right-click context menu. Two new commands: `AL Pocket Tools: Paste Launch Configuration` (pick from saved list and append or replace in the open file) and `AL Pocket Tools: Save Launch Configuration` (pick from configs in the open file and save to user settings, with cursor-position detection to pre-select the relevant entry). Conflict detection on both flows with Append / Replace / Cancel prompts.

## [0.4.0] - 2026-05-12

### Added

- **Sync .alpackages to Latest** — new command (`AL Pocket Tools: Sync .alpackages to Latest`) that scans every `.alpackages` folder in the workspace, finds the newest version of each app across all folders, removes older copies, and copies the newest version into any folder that was behind. Shows a full DELETE/COPY plan in the Output panel before asking for confirmation.
- **Nuke .alpackages** — new command (`AL Pocket Tools: Nuke .alpackages`) that deletes every `.app` file from all `.alpackages` folders in the workspace. Useful for forcing a clean re-download of all package dependencies. Shows the full list of files to be removed in the Output panel before asking for confirmation.

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