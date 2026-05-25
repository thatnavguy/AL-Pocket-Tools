# Project Overview

Scans all AL files in the workspace and generates two Markdown reports per AL project.

## How to trigger

**Command Palette:** `AL Pocket Tools: Generate Project Overview`

There is no context menu entry — the command always operates on the full workspace.

## Output files

Both files are written to the configured output folder (default: `Project/`) inside each project root (the directory containing `app.json`). The folder is created automatically if it does not exist.

| File | Contents |
|------|----------|
| `ProjectOverview.md` | Summary of object counts by type, complexity overview, and top 10 most complex objects |
| `ALObjectList.md` | Full list of every AL object with its type, ID, name, caption, line count, and complexity rating |

### Multi-project workspaces

If the workspace contains multiple `app.json` files, a separate pair of files is generated for each project under that project's own root folder.

## ProjectOverview.md sections

### Object Summary

A table of object counts grouped by type (Table, TableExtension, Page, PageExtension, Codeunit, Report, Enum, …) with a **Total** row.

### Complexity Overview

A summary of how many objects fall into each tier:

| Tier | Score | Criteria |
|------|------:|---------|
| 🟢 Simple | 3 | All three sub-scores are at their minimum |
| 🟡 Moderate | 4–6 | Mixed sub-scores |
| 🔴 Complex | 7–9 | All or most sub-scores are at their maximum |

### Top 10 Most Complex Objects

A ranked table of the 10 highest-scoring objects showing type, object ID, name, line count, procedure count, trigger count, fields/values count, and complexity label.

## ALObjectList.md columns

| Column | Description |
|--------|-------------|
| Type | AL object type (e.g. Table, Codeunit) |
| Object ID | Numeric ID from the object declaration; `—` for objects without an ID (Interface, Profile) |
| Name | Object name as declared in the AL file |
| Caption | Value of the `Caption` property; falls back to the object name if no caption is defined |
| Lines | Total line count of the AL file |
| Complexity | 🟢 Simple / 🟡 Moderate / 🔴 Complex |

Objects are sorted by type (in declaration-order: Table → TableExtension → Page → … → Interface → Profile), then by numeric ID, then alphabetically by name.

## Complexity scoring

Each object receives a score from **3** (simplest) to **9** (most complex) based on three independent sub-scores:

| Dimension | Low (1) | Medium (2) | High (3) |
|-----------|---------|-----------|---------|
| **Lines** | < 100 | 100–299 | ≥ 300 |
| **Procedures + Triggers** | < 5 | 5–14 | ≥ 15 |
| **Fields / Values** | < 10 | 10–29 | ≥ 30 |

Fields are counted differently per object type:
- **Table / TableExtension** — `field(n; ...)` declarations
- **Enum / EnumExtension** — `value(n; ...)` declarations
- **Page / PageExtension** — `field(...)` controls in the layout
- All other types — always 1 (minimum field sub-score)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `al-pocket-tools.projectOverview.outputFolder` | `"Project"` | Folder name relative to each project root where the reports are written |

## Edge cases

- AL files that do not start with a recognised object declaration are silently skipped.
- If `app.json` cannot be parsed, that project is skipped and a warning is shown.
- The command requires at least one `app.json` in the workspace; otherwise a warning message is displayed.
