# Launch Config Manager

Save and reuse AL launch configurations across projects. Store configurations in your VS Code user settings and paste them into any project's `launch.json` with a single right-click.

## How to use

Both commands are available from the **editor context menu** (right-click inside an open `launch.json` file) and from the **Command Palette** (`Ctrl+Shift+P`).

### Paste a saved configuration

1. Open `.vscode/launch.json` in the editor.
2. Right-click anywhere and select **AL Pocket Tools: Paste Launch Configuration**.
3. Pick a saved configuration from the Quick Pick list.
4. The configuration is appended to the `configurations` array.

If a configuration with the same `name` already exists in `launch.json`, you will be prompted to **Append Anyway**, **Replace**, or **Cancel**.

### Save a configuration to user settings

1. Open `.vscode/launch.json` in the editor.
2. Place your cursor inside the configuration object you want to save (optional — the list will highlight it automatically).
3. Right-click and select **AL Pocket Tools: Save Launch Configuration**.
4. A Quick Pick lists all configurations in the file. The one your cursor is inside appears at the top with a `← cursor is here` marker.
5. Select the configuration to save. It is written to your VS Code user settings under `al-pocket-tools.launch.configurations`.

If a configuration with the same `name` already exists in your saved list, you will be prompted to **Replace** or **Cancel**.

## User settings format

Saved configurations are stored in your VS Code user `settings.json`:

```json
"al-pocket-tools.launch.configurations": [
    {
        "name": "bc28 (User)",
        "request": "launch",
        "type": "al",
        "environmentType": "OnPrem",
        "server": "http://bc28",
        "serverInstance": "BC",
        "authentication": "UserPassword",
        "startupObjectType": "Page",
        "breakOnError": true,
        "launchBrowser": true,
        "enableLongRunningSqlStatements": true,
        "enableSqlInformationDebugger": true,
        "tenant": "default",
        "schemaUpdateMode": "ForceSync"
    },
    {
        "name": "BC Sandbox-dev",
        "type": "al",
        "request": "launch",
        "environmentType": "Sandbox",
        "environmentName": "sandbox-dev",
        "breakOnError": "All",
        "launchBrowser": true,
        "tenant": "6af225e5-...",
        "schemaUpdateMode": "Synchronize"
    }
]
```

You can also edit this list directly in your user `settings.json` (`Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**).

## Commands

| Command | Palette title | What it does |
|---|---|---|
| `al-pocket-tools.pasteLaunchConfig` | AL Pocket Tools: Paste Launch Configuration | Pick from saved configs and append (or replace) in the open `launch.json` |
| `al-pocket-tools.saveLaunchConfig` | AL Pocket Tools: Save Launch Configuration | Pick from configs in the open `launch.json` and save to user settings |

## Edge cases

- **No saved configurations** — Paste will show an info message directing you to use Save first.
- **Empty `configurations` array** — Paste correctly inserts the first entry.
- **JSONC (comments in launch.json)** — Line comments (`//`) and block comments (`/* */`) are stripped before parsing. Comments are preserved in the file for all other content since only targeted insertions or replacements are made.
- **Indentation** — The pasted configuration adopts the indentation style already present in the file (tabs or spaces, detected automatically). If the file is empty or has no existing entries, 4-space indentation is used as a default.
