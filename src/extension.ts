import * as vscode from 'vscode';
import { cleanupAppFiles } from './commands/cleanupAppFiles';
import { bumpVersion, incrementVersionPart, VersionStatusBar } from './commands/versionBump';
import { RegionTreeProvider } from './providers/RegionTreeProvider';
import { PragmaTreeProvider } from './providers/PragmaTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('AL Pocket Tools');
    const regionProvider = new RegionTreeProvider(context);
    const pragmaProvider = new PragmaTreeProvider();

    new VersionStatusBar(context);

    const pragmaView = vscode.window.createTreeView('al-pocket-tools.pragmaViewer', {
        treeDataProvider: pragmaProvider,
        showCollapseAll: true,
    });

    // Scan when view first becomes visible (or is already visible at activation).
    // setImmediate yields so VS Code can propagate the initial visible state first.
    const triggerScanIfNeeded = () => {
        if (pragmaView.visible && !pragmaProvider.hasData()) {
            void pragmaProvider.scan();
        }
    };
    setImmediate(triggerScanIfNeeded);
    context.subscriptions.push(pragmaView.onDidChangeVisibility(triggerScanIfNeeded));

    context.subscriptions.push(
        output,
        vscode.window.createTreeView('al-pocket-tools.regionViewer', {
            treeDataProvider: regionProvider,
            showCollapseAll: true,
        }),
        pragmaView,
        vscode.commands.registerCommand(
            'al-pocket-tools.cleanupAppFiles',
            (uri?: vscode.Uri) => cleanupAppFiles(output, uri)
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.goToRegion',
            async (uri: vscode.Uri, line: number) => {
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc);
                const pos = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.refreshPragmaViewer',
            () => { void pragmaProvider.scan(); }
        ),
        vscode.commands.registerCommand('al-pocket-tools.bumpVersion', () => { void bumpVersion(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMajor', () => { void incrementVersionPart('major'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMinor', () => { void incrementVersionPart('minor'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementBuild', () => { void incrementVersionPart('build'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementRevision', () => { void incrementVersionPart('revision'); }),
    );
}

export function deactivate() {}
