# Sync .alpackages to Latest

Scans every `.alpackages` folder in the workspace, identifies the newest version of each app across all folders, then removes older copies and propagates the newest version to any folder that was behind.

## How to trigger

**Command palette**: `AL Pocket Tools: Sync .alpackages to Latest`

## Flow

1. The extension scans all `.app` files under every `.alpackages` folder in the workspace.
2. For each app identity (`Publisher_AppName`), the newest version found anywhere in the workspace is selected as the target.
3. The Output panel opens and shows the full sync plan: which files will be deleted and which will be copied, grouped by folder.
4. A modal confirmation dialog shows the total counts. You must click **Sync** to proceed.
5. Older versions are deleted; the newest version is copied into any folder that lacked it.

## Example

Given:

```
ProjectA/.alpackages/
  Contoso_BaseApp_1.0.0.5.app
  Contoso_Library_2.0.0.0.app

ProjectB/.alpackages/
  Contoso_BaseApp_2.0.0.0.app
  Contoso_Library_1.9.0.0.app
```

After sync:

```
ProjectA/.alpackages/
  Contoso_BaseApp_2.0.0.0.app   ← copied from ProjectB
  Contoso_Library_2.0.0.0.app   ← unchanged (already latest)

ProjectB/.alpackages/
  Contoso_BaseApp_2.0.0.0.app   ← unchanged (was already latest)
  Contoso_Library_2.0.0.0.app   ← copied from ProjectA
```

## Edge cases

- Only `.alpackages` folders are considered. Regular project folders are ignored.
- If a folder already has the newest version of every app it contains, it is reported as in sync and no changes are made.
- Files whose names do not follow the `Publisher_AppName_Major.Minor.Build.Revision.app` convention are skipped and listed in the Output panel.
- `node_modules` trees are excluded from the scan.
- If a folder has multiple older copies of the same app (e.g. two stale versions), all of them are deleted and the single newest version is copied in.
- Apps that exist only in one folder and are already the newest are left untouched — nothing is added to folders that never had that app.
