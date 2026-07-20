# Renumber Object IDs

Scans your workspace for AL objects that share the same ID (a common mistake when an AI coding agent or a developer picks an ID that's already in use elsewhere), and reassigns a free ID — from the ranges declared in `app.json` — to whichever side of the conflict is newest.

## How to use

**Command palette** — open the palette (`Ctrl+Shift+P`) and run **AL Pocket Tools: Renumber Object IDs**.

The command scans every `.al` file in the workspace, finds any object-type/ID pairs declared more than once, and shows a checklist of the proposed renumbers (`type oldId → newId`, object name, and file path). Confirm the ones you want applied; the rest are left untouched.

## Commands

| Command | Palette title | What it does |
|---|---|---|
| `al-pocket-tools.renumberObjectIds` | AL Pocket Tools: Renumber Object IDs | Scans the workspace for object ID conflicts and lets you apply fixes |

## What counts as a conflict

Two or more objects of the **same object type** (`table`, `page`, `report`, `codeunit`, `query`, `xmlport`, `enum`, `permissionset`, `entitlement`, and their `*extension` variants) declared with the **same ID**, scoped to the AL project they belong to (the nearest `app.json` above the file). A `table 50100` and a `page 50100` are not a conflict — AL numbers each object type independently.

`controladdin`, `profile`, and `interface` objects are skipped — they're identified by name only and don't carry a numeric ID in AL.

## Which side gets renumbered

For each conflicting pair, the extension uses git history to work out which file is newest:

- `git log -1 --format=%ct` is checked for each conflicting file.
- An **untracked** file (no git history yet) is treated as newer than any tracked file — it's almost certainly the one that was just added. If two conflicting files are both untracked, they're tie-broken by on-disk modified time (mtime), so the one edited most recently is still the one considered "new".
- The **oldest** file in the group keeps its ID; every other (newer) file in the group is a candidate for renumbering.
- If git isn't available (not a repository, or git isn't installed), the extension falls back to the file's on-disk modified time and notes this in the **AL Pocket Tools** output channel.

## How the new ID is chosen

The replacement ID is the lowest ID that is:

- Inside one of the `idRanges` entries declared in the nearest `app.json` to the file being renumbered, and
- Not already used by another object of the same type in that project (including other objects being renumbered in the same run).

## When no free ID is available

If none of the declared `idRanges` have room left for an object type, that object is left unchanged and reported separately — both as a warning notification and as a detail line in the **AL Pocket Tools** output channel — so you can extend the range or resolve it by hand.

## Notes

- This command only looks at `.al` files inside your workspace. It does not inspect `.alpackages`/dependency `.app` files, so it won't catch a collision with an object ID reserved by a dependency — only collisions between objects declared in your own project.
- Changes are applied as a single workspace edit; nothing is written to disk until you confirm the checklist.
