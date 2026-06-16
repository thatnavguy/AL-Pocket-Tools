# File Sender

Copy or move any file to a saved destination folder directly from the Explorer context menu.

## How to trigger

Right-click any file in the Explorer sidebar and choose **AL Pocket Tools → Copy File To...** or **AL Pocket Tools → Move File To...**

Both commands are also available from the Command Palette (`Ctrl+Shift+P`) as **AL Pocket Tools: Copy File To...** and **AL Pocket Tools: Move File To...**

## UX flow

1. A quick-pick list appears showing your saved destination folders (with their friendly label and full path as a hint).
2. Select a saved folder to copy/move the file there immediately.
3. Or choose **Browse for folder...** to open a folder picker dialog.
   - After selecting a folder, the extension follows the `fileSender.saveBrowsedFolder` setting (see below) to decide whether to save it.
   - If saving, you are prompted for a friendly label. The folder's own name is pre-filled as the default. If the label already exists in the list, a warning appears and you must choose a different name.
4. If a file with the same name already exists in the destination, a modal confirmation dialog asks whether to overwrite it.
5. A notification confirms the operation or reports the error.

**Move vs Copy**: Copy leaves the original file in place. Move deletes it after a successful copy.

## Settings

| Setting | Default | Description |
|---|---|---|
| `al-pocket-tools.fileSender.savedFolders` | `[]` | Array of `{ label, path }` objects — the favourites list shown in the picker. Edit directly in settings JSON to rename or remove entries. |
| `al-pocket-tools.fileSender.saveBrowsedFolder` | `"always"` | `"always"` — prompt for a label and save every browsed folder automatically. `"ask"` — ask each time. `"never"` — never save browsed folders. |

## Edge cases

- If a saved folder's path no longer exists on disk, the extension shows an error and does not proceed.
- Cancelling at any step (the picker, the folder browser, the label prompt, or the overwrite dialog) safely aborts the operation with no changes.
- The saved folders list is stored in **User Settings** (global), so it is shared across all workspaces.
