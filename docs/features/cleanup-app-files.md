# Cleanup Duplicate App Files

Scans your repository for duplicate AL `.app` files and deletes older versions, keeping only the latest of each app.

## How to use

**Command palette** — press `Ctrl+Shift+P` and run:
```
AL Pocket Tools: Cleanup Duplicate App Files
```
Scans the entire workspace.

**Right-click menu** — right-click any `.app` file in the Explorer and select **Cleanup Duplicate App Files**.
Scans only the folder containing that file.

## What it does

1. **Discovers folders** — looks for `.alpackages` directories and AL project folders (any folder containing an `app.json`).
2. **Parses filenames** — reads the publisher, app name, and version from each filename. Files that don't match the convention are skipped and listed as `[skipped]` in the report.
3. **Detects duplicates** — within each folder, groups files by identity (`Publisher_AppName`). Any group with two or more versions has duplicates; the highest version is kept and all lower versions are marked for deletion.
4. **Shows a report** — opens the **AL Pocket Tools** Output panel with a full KEEP / DELETE breakdown before touching any files.
5. **Confirms before deleting** — a modal dialog shows the total count. Deletion only proceeds if you click **Delete**.

## File naming convention

```
Publisher_AppName_Major.Minor.Build.Revision.app
```

Examples:
```
Microsoft_Base Application_25.0.0.0.app
Contoso_Sales Extension_3.2.1.0.app
```

The last `_`-delimited segment before `.app` is the version. Everything before it is the identity key used to group duplicates. Files with fewer than three `_`-separated segments or an unparseable version are skipped.

## Output panel report

```
=== Scanned 2 folder(s) ===

  .alpackages  (5 files)
    Microsoft_Base Application
      KEEP   : Microsoft_Base Application_25.0.0.0.app
      DELETE : Microsoft_Base Application_24.0.0.0.app

  src\.alpackages  (3 files)
    No duplicates found.

Total files to delete: 1
```
