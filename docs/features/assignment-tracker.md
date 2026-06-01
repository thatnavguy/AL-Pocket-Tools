# Assignment Tracker

## What It Does

Assignment Tracker finds every place in your AL code where a specific field or variable is assigned a value. It detects four assignment patterns:

| Pattern | Example |
|---------|---------|
| `Validate` | `Rec.Validate("Source No.", SalesLine."Document No.");` |
| Direct `:=` | `Rec."Source No." := SalesLine."Document No.";` |
| Compound `+= -= *= /=` | `Rec.Amount += SurchargeAmt;` |
| `TransferFields` | `Rec.TransferFields(SalesLine);` *(bulk assign — all matching fields)* |

Results are displayed in a dedicated sidebar panel, grouped first by **assignment kind** and then by file, with click-to-navigate to each line.

## How to Trigger

### From the Command Palette

1. Open any AL file and place your cursor on a field name (quoted or unquoted).
2. Run **AL Pocket Tools: Search Assignments...** (`Ctrl+Shift+P` → `Search Assignments`).
3. If the cursor is on a field reference, the field name is pre-filled. Otherwise, type the field name manually.
4. Choose the scope: **Workspace** (all `.al` files) or **Current File**.

### From the Editor Context Menu

Right-click inside any `.al` file → **AL Pocket Tools** → **Search Assignments...**

### From the Assignment Tracker Sidebar

Click the search icon (`$(search)`) in the Assignment Tracker sidebar title bar.

## Sidebar Location

Assignment Tracker lives in the **AL Pocket Tools** sidebar — look for the AL Pocket Tools icon in the VS Code activity bar on the left. Click it to open the panel, then select the **Assignment Tracker** view.

The sidebar title bar has three buttons:

| Button | Action |
|--------|--------|
| `$(search)` Search | Run a new search (opens field input + scope picker) |
| `$(refresh)` Refresh | Re-run the last search with the same field and scope |
| `$(globe)` Toggle Scope | Switch between Workspace and Current File scope |

## Output / UX Flow

1. You trigger the command. If the cursor is on a field, the name is auto-detected.
2. A scope picker appears (Workspace / Current File).
3. The Assignment Tracker sidebar focuses and a progress indicator runs while files are scanned.
4. Results appear as a three-level tree:
   - **Kind group** — assignment kind label + total match count (only groups with matches are shown, in order: Validate → Direct → Compound → TransferFields)
   - **File node** — relative path + match count for that kind in that file
   - **Match leaf** — truncated line text, line number
5. Click any match leaf to navigate to that exact line in the file.

### Assignment Kind Icons

| Icon | Kind | Meaning |
|------|------|---------|
| `$(symbol-event)` | Validate | Field set via `.Validate()` trigger |
| `$(arrow-right)` | Direct `:=` | Direct assignment |
| `$(symbol-operator)` | Compound `+=` / `-=` / `*=` / `/=` | Compound assignment operator |
| `$(package)` | TransferFields | Bulk field copy (all matching fields) |

TransferFields results show **(bulk assign)** as their description to distinguish them from targeted assignments.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `al-pocket-tools.assignmentTracker.includeTransferFields` | `boolean` | `true` | When `true`, `TransferFields()` calls appear in results with a bulk-assign indicator. Set to `false` to show only Validate, direct `:=`, and compound assignments. |

## Edge Cases

- **Quoted vs unquoted field names**: The tracker matches both `"Field Name"` and `FieldName` forms case-insensitively.
- **Any record variable**: Results include assignments to the field regardless of which record variable is used (e.g. `Rec`, `SalesHeader`, `Header`).
- **TransferFields scope**: A `TransferFields` match means the field *may* be assigned — it depends on whether the source record has a matching field. The result is shown with a `(bulk assign)` indicator to make this clear.
- **Workspace scan on large projects**: Scanning is cancellable. Click the ✕ in the progress bar to abort.
- **`.alpackages` files**: The workspace scan excludes files under `.alpackages` folders to avoid false positives from dependency packages.