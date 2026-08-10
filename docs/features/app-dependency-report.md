# App Dependency Report

Scans every `app.json` file in the workspace, builds a per-app dependency list, and writes a workspace-level markdown report that also shows which matching `.app` package versions are currently available for those dependencies.

## How to trigger

**Command palette**: `AL Pocket Tools: Generate App Dependency Report`

## UX flow

1. Run **AL Pocket Tools: Generate App Dependency Report** from the Command Palette.
2. If `APP-DEPENDENCIES.md` already exists in the workspace root, the extension shows a modal overwrite confirmation.
3. The extension scans the whole workspace for `app.json` files and `.app` packages, excluding `node_modules`.
4. A markdown report is written to the workspace root as `APP-DEPENDENCIES.md`.
5. The generated report opens in the editor.
6. The report header includes the generation timestamp so you can see when it was last refreshed.

## Output format

The report contains three sections:

1. **Dependency diagram** — a single Mermaid graph showing the dependency chain across the workspace. If a dependency is also one of the workspace apps, it is merged into the same node so the graph reads like one connected flow. Dependencies that do not exist as workspace apps are highlighted in one color, and any node whose name contains `Test` is highlighted in a different color.
2. **Apps** — one section per `app.json`, including app metadata, its declared dependencies, and the matching workspace `.app` version or versions for each dependency.
3. **Available dependency packages in workspace** — one section per declared dependency, showing matching `.app` versions currently found in the workspace, the path of each package, and which apps depend on it.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `al-pocket-tools.appDependencyReport.reportFileName` | string | `APP-DEPENDENCIES.md` | Reserved setting entry for this feature. The current implementation always writes `APP-DEPENDENCIES.md` in the workspace root. |

## Edge cases

- If no `app.json` files are found, the command still creates the report and includes a clear "none found" message.
- If no `.app` files are found, the command still creates the report and shows that no matching workspace packages were found.
- If a dependency is declared in `app.json` but no matching `.app` package exists in the workspace, that dependency is listed with a "No matching `.app` found in workspace" row.
- If `APP-DEPENDENCIES.md` already exists and you cancel the overwrite confirmation, the command stops without changing the file.
- If an `app.json` file contains invalid JSON or missing required fields (`id`, `name`, `publisher`, `version`), the command stops and shows an error message naming the offending file.
