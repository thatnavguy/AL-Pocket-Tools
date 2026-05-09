# AL Pocket Tools

A collection of tools for AL (Business Central Application Language) development in VS Code.

## Features

| Feature | Description |
|---|---|
| [Cleanup Duplicate App Files](docs/features/cleanup-app-files.md) | Scans your repository for duplicate `.app` files and deletes older versions, keeping only the latest of each app. |
| [Region Viewer](docs/features/region-viewer.md) | Shows all `#region` blocks in the active AL file as a navigable tree in the Explorer sidebar. Supports nested regions and live updates as you type. |
| [Pragma Viewer](docs/features/pragma-viewer.md) | Shows all `#if`, `#elseif`, and `#pragma warning` directives across the entire workspace, grouped by symbol or warning code. Click any line to navigate to it. |
| [Version Bump](docs/features/version-bump.md) | Increments the Major, Minor, Build, or Revision segment of `app.json` with a single command, with automatic reset of lower segments. Status bar shows the current version at a glance. |

## Requirements

- VS Code 1.118.0 or later
- A workspace containing AL projects or `.alpackages` folders
