# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AL Pocket Tools is a VS Code extension (v0.0.1, early development) providing a collection of tools for AL (Business Central Application Language) development.

## Commands

```bash
# Compile TypeScript to out/
npm run compile

# Watch mode (used during development/debugging)
npm run watch

# Lint
npm run lint

# Run tests (requires compiled output first)
npm run compile && npm test

# Package for publishing (runs compile first)
npm run vscode:prepublish
```

To debug: press **F5** in VS Code — this launches the Extension Development Host using the `.vscode/launch.json` configuration (runs `npm run compile` as a pre-launch task).

To run a single test file, the test runner uses `@vscode/test-cli` with the glob `out/test/**/*.test.js`. There is no built-in single-file filter; run all tests with `npm test`.

## Architecture

**Entry point**: `src/extension.ts` exports `activate(context)` and `deactivate()`. All command registrations and subscriptions go inside `activate`.

**Output**: TypeScript compiles to `out/` (ES2022, Node16 modules). The extension main is `./out/extension.js` as declared in `package.json`.

**Commands** are declared in `package.json` under `contributes.commands` and registered in `src/extension.ts` via `vscode.commands.registerCommand`. Both locations must be kept in sync.

**Tests** live in `src/test/` and are compiled to `out/test/`. The test framework is Mocha (via `@vscode/test-electron`). Tests run inside an Extension Development Host, giving access to the full VS Code API.

**ESLint** uses the flat config format (`eslint.config.mjs`). Rules are set to `"warn"` level; key rules: `naming-convention`, `curly`, `eqeqeq`, `no-throw-literal`, `semi`.

**Packaging**: `.vscodeignore` excludes `src/`, `*.ts`, `*.map`, config files — only `out/` JS files and `package.json` ship in the VSIX.

## Documentation Convention

Every feature gets a dedicated doc page at `docs/features/<feature-name>.md`. Cover: what it does, how to trigger it (command palette and any context menu), the output/UX flow, and any file format conventions or edge cases. `README.md` lists all features in a table with a one-line description and links to the doc page.

## Performance Requirements

**Every feature must not degrade VS Code performance.** This is a hard constraint, not a guideline.

- **Lazy activation**: use specific activation events (`onCommand`, `onLanguage:al`) — never `"*"`
- **No sync I/O on the main thread**: use `vscode.workspace.fs` or `fs.promises`; never `fs.readFileSync` in hot paths
- **Debounce high-frequency events**: `onDidChangeTextDocument` and similar must be debounced/throttled before triggering any work
- **Cache aggressively**: cache computed results and invalidate on relevant workspace events (`onDidSaveTextDocument`, `onDidCreateFiles`, etc.)
- **Avoid workspace-wide scans on startup**: only scan when explicitly triggered by the user
- **Scope language providers to AL**: always pass `{ language: 'al' }` when registering language feature providers

## VS Code Extension Patterns

- Disposables returned from `registerCommand` must be pushed to `context.subscriptions` to avoid leaks.
- The extension activates on command execution (`onCommand` in `package.json`). Add activation events there when introducing new triggers.
- Use `vscode.window.showInformationMessage` / `showErrorMessage` for user-facing feedback.
- Configuration contributions go under `contributes.configuration` in `package.json`; read them via `vscode.workspace.getConfiguration('al-pocket-tools')`.

## AL Development Context

AL is the programming language for Microsoft Dynamics 365 Business Central extensions. When implementing AL-specific tools, relevant VS Code APIs include:
- `vscode.languages` — for AL language features (hover, completion, diagnostics)
- `vscode.workspace.findFiles` — for discovering AL files (`.al`)
- The official AL Language extension (`ms-dynamics-smb.al`) may already provide language server features; complement rather than duplicate them.
