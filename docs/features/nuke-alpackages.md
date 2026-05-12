# Nuke .alpackages

Deletes every `.app` file found inside any `.alpackages` folder in the workspace. Use this to force a clean re-download of all package dependencies.

## How to trigger

**Command palette**: `AL Pocket Tools: Nuke .alpackages`

## Flow

1. The extension scans the workspace for all `.app` files under any `.alpackages` directory.
2. The Output panel opens and lists every file that will be deleted, grouped by folder.
3. A modal confirmation dialog shows the total count. You must click **Delete All** to proceed.
4. All matched files are deleted. Cancelling the dialog leaves files untouched.

## Edge cases

- If no `.app` files are found, an info message is shown and nothing is deleted.
- Only files directly inside a `.alpackages` folder are matched (`**/.alpackages/*.app`). Files in subdirectories of `.alpackages` are not affected.
- `node_modules` trees are excluded from the scan.
