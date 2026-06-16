# New Feature

You are helping add a new feature to the AL Pocket Tools VS Code extension. Follow every step below in order. Do not skip any step.

## Step 1 — Clarify the design

Before writing any code, read the feature description the user provided with the slash command argument (if any). Then ask clarifying questions to resolve any ambiguity. At minimum cover:

- **Trigger** — how does the user invoke it? (Explorer context menu, editor context menu, Command Palette, keybinding, status bar, sidebar view, or a combination)
- **Scope** — does it act on the active file, selected files, the whole workspace, or something else?
- **UX flow** — what does the user see step by step? (quick-pick, input box, progress notification, output panel, tree view, etc.)
- **Edge cases** — what happens on empty input, no selection, missing files, conflicts?

Do not start coding until the user has answered. Surface every ambiguity explicitly.

## Step 2 — Explore the codebase

Read these files before writing anything:

- `src/extension.ts` — understand the registration pattern and what is already imported
- `package.json` — the full `contributes` block (commands, menus, submenus, configuration, activationEvents)
- Any existing command file in `src/commands/` that is similar to the feature you are building — study its imports, exports, and async patterns

Use `vscode.workspace.fs` for all file I/O (not `fs/promises` or `fs.readFileSync`). Use `import * as path from 'path'` for path manipulation.

## Step 3 — Implement

Create and modify exactly these artefacts:

### `src/commands/<featureName>.ts` (new file)

- Export one or more named functions that `extension.ts` will call directly.
- Keep all implementation private (not exported).
- Use `vscode.workspace.fs` for I/O, `vscode.window.show*` for UX, `vscode.workspace.getConfiguration('al-pocket-tools')` for settings.
- No sync I/O on the main thread.

### `src/extension.ts` (modify)

- Add an `import` for each exported function.
- Register each command inside `context.subscriptions.push(...)` using `vscode.commands.registerCommand`.
- Explorer context menu commands receive `(uri?: vscode.Uri, allUris?: vscode.Uri[])` — always pass both through so multi-file selection works.

### `package.json` (modify)

Add to **all four** of the following sections as needed:

1. `contributes.commands` — one entry per command with `"category": "AL Pocket Tools"`.
2. `contributes.menus` — place commands in the right menu (`explorer/context`, `al-pocket-tools.explorerFileSubmenu`, `al-pocket-tools.editorAlSubmenu`, `al-pocket-tools.editorLaunchSubmenu`, `view/title`, etc.). Use `when` clauses to scope visibility. Explorer file commands go under `al-pocket-tools.explorerFileSubmenu` (not as direct top-level entries).
3. `contributes.configuration.properties` — one entry per user setting, always prefixed `al-pocket-tools.<featureName>.*`, with `type`, `default`, `description`, and `enum`/`enumDescriptions` where applicable.
4. `activationEvents` — add `"onCommand:al-pocket-tools.<commandId>"` for each new command.

### `docs/features/<feature-name>.md` (new file)

Cover: what it does, how to trigger it, the full UX flow step by step, all settings in a table, and every edge case.

### `README.md` (modify)

Add one row to the Features table: `| [Feature Name](docs/features/<feature-name>.md) | One-line description. |`

## Step 4 — Compile

Run `npm run compile` and fix every error before continuing.

## Step 5 — Performance impact report

Deliver the mandatory report required by CLAUDE.md. Format it as a table with columns: Trigger | Frequency | Risk (Low/Medium/High) | Mitigation. Follow with a short bullet list of any outstanding concerns. Cover every activation path — high-frequency events (`onDidChangeTextDocument`, `onDidChangeActiveTextEditor`) are High risk unless debounced; explicit user actions are Low risk.

## Step 6 — Done

Summarise what was created/modified in two sentences. Do not mark the feature complete until all five artefacts exist and the compile is clean.
