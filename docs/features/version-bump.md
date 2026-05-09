# Version Bump

Provides commands to increment the version number in `app.json` for your AL project. Each command updates the correct segment and resets all lower-order segments to zero, following semantic versioning conventions.

## How to use

**Command palette** — open the palette (`Ctrl+Shift+P`) and run any of the commands below.

**Context menu** — right-click `app.json` in the Explorer and select **AL Pocket Tools: Bump Version...**.

**Status bar** — the current version is shown in the status bar (`$(versions) 1.2.3.4`). Click it to open the interactive picker.

## Commands

| Command | Palette title | What it does |
|---|---|---|
| `al-pocket-tools.bumpVersion` | AL Pocket Tools: Bump Version... | Opens an interactive picker showing all four options and a live `before → after` preview for each |
| `al-pocket-tools.incrementMajor` | AL Pocket Tools: Increment Major Version | Bumps major; resets minor, build, revision to 0 |
| `al-pocket-tools.incrementMinor` | AL Pocket Tools: Increment Minor Version | Bumps minor; resets build and revision to 0 |
| `al-pocket-tools.incrementBuild` | AL Pocket Tools: Increment Build Version | Bumps build; resets revision to 0 |
| `al-pocket-tools.incrementRevision` | AL Pocket Tools: Increment Revision Version | Bumps revision only |

## Version format

AL uses a four-part version string in `app.json`:

```json
{
  "version": "Major.Minor.Build.Revision"
}
```

Example: `"version": "2.0.1.0"` → `Increment Minor` → `"version": "2.1.0.0"`.

## Multi-project workspaces

If the workspace contains more than one `app.json`, the command auto-resolves to the one **nearest to the currently active file** (walks up the directory tree). If no file is active, a picker lists all discovered `app.json` files so you can choose the target project.

## Status bar

A `$(versions) 1.2.3.4` indicator appears in the left status bar whenever an AL workspace is detected. It reflects the `app.json` closest to the active editor and updates automatically when `app.json` is saved. Clicking it opens the **Bump Version...** picker.

## File preservation

The version field is updated with a targeted string replacement, so the rest of `app.json` — including indentation, field order, and comments — is left untouched.
