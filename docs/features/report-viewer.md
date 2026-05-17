# Report Viewer

![Report Viewer](../../image/ReportViewer.gif)

Shows the structure of the active AL report file as a navigable tree in the Explorer sidebar. Navigate directly to data items, triggers, the request page, rendering layouts, global variables, and procedures.

## How to use

Open any AL report file (`.al` starting with `report <ID> "<Name>"`). The **Report Viewer** panel in the Explorer sidebar automatically loads its structure.

- Click any tree node to jump to that line in the editor.
- Use the **Refresh** button (↺) in the panel header to reload the current file at any time.
- If the panel is **hidden** when you switch to a report file, the tree will not update automatically — show the panel first, then click Refresh.

## What it does

1. **Detects AL reports** — the viewer activates only when the active editor contains an AL report (`report N "Name" { ... }`). Non-report `.al` files (codeunits, pages, tables, etc.) clear the tree.
2. **Loads once per file switch** — when you switch to a report file in the editor, the tree is populated once. It does not re-parse on every keystroke.
3. **No background scanning** — the viewer only reads the single active file; it does not scan the whole workspace.
4. **Visibility-gated** — if the Report Viewer panel is not visible when you switch to a report file, no parsing is done. Show the panel and click Refresh to load.

## Tree structure

```
dataset
└── DataItemName (TableName)          — navigates to the dataitem line
    ├── OnPreDataItem                  — navigates to the trigger line
    ├── OnAfterGetRecord               — navigates to the trigger line
    └── NestedDataItem (NestedTable)
        └── OnAfterGetRecord

requestpage
└── requestpage                        — navigates to the requestpage line

rendering
└── LayoutName (RDLC | Word | Excel)  — navigates to the layout() line

var
├── VariableName: Record "Table Name" — navigates to the declaration line
└── VariableName: Codeunit CodeunitName

procedures
└── ProcedureName                      — local / internal / protected / (public)
```

## Sections

| Section | What it shows |
|---|---|
| **dataset** | Nested data items in the order they appear; each expanded to show its triggers (`OnPreDataItem`, `OnAfterGetRecord`, `OnPostDataItem`, etc.). Nesting mirrors the AL source. |
| **requestpage** | A single navigation node pointing to the `requestpage` block. |
| **rendering** | One entry per `layout(...)` declaration inside the `rendering` block; description shows the layout type (RDLC, Word, Excel). |
| **var** | Each global variable declared in the report-level `var` section; description shows the type. Local vars inside procedures are not shown. |
| **procedures** | Each `procedure`, `local procedure`, `internal procedure`, and `protected procedure` declared at the report level; description shows the visibility keyword for non-public procedures. |

## Panel states

| State | What you see |
|---|---|
| Report file active, panel visible | Full tree of all sections present in the report |
| Report file active, panel hidden | Tree unchanged from last load |
| Non-report AL file active | Empty tree |
| No active editor | Empty tree |
| Empty report (no recognisable sections) | Empty tree (no welcome message override) |
| Panel never shown / no file opened | "Open an AL report file to see its structure. [Refresh]" |

## Refresh behaviour

| Action | Result |
|---|---|
| Switch to a report file (panel visible) | Tree updates automatically (once) |
| Switch to a report file (panel hidden) | Tree does **not** update |
| Click Refresh button | Tree reloads from the current active editor |
| Edit the file | Tree does **not** update automatically — click Refresh |
| Switch to a non-report file | Tree clears |
