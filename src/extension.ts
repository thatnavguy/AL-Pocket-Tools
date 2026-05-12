import * as vscode from 'vscode';
import { cleanupAppFiles } from './commands/cleanupAppFiles';
import { nukeAlPackages } from './commands/nukeAlPackages';
import { syncAlPackages } from './commands/syncAlPackages';
import { bumpVersion, incrementVersionPart, VersionStatusBar } from './commands/versionBump';
import { showCallGraph } from './commands/callGraph';
import { RegionTreeProvider } from './providers/RegionTreeProvider';
import { PragmaTreeProvider } from './providers/PragmaTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('AL Pocket Tools');
    const regionProvider = new RegionTreeProvider();
    const pragmaProvider = new PragmaTreeProvider();

    new VersionStatusBar(context);

    const regionView = vscode.window.createTreeView('al-pocket-tools.regionViewer', {
        treeDataProvider: regionProvider,
        showCollapseAll: true,
    });

    const pragmaView = vscode.window.createTreeView('al-pocket-tools.pragmaViewer', {
        treeDataProvider: pragmaProvider,
        showCollapseAll: true,
    });

    // Swap in/out the onDidChangeActiveTextEditor listener based on the refreshMode setting.
    let autoRefreshDisposable: vscode.Disposable | undefined;

    const applyRefreshMode = () => {
        autoRefreshDisposable?.dispose();
        const mode = vscode.workspace
            .getConfiguration('al-pocket-tools')
            .get<string>('regionViewer.refreshMode', 'manual');

        void vscode.commands.executeCommand('setContext', 'al-pocket-tools:regionViewerMode', mode);

        if (mode === 'onOpenFile') {
            autoRefreshDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
                if (regionView.visible) {
                    regionProvider.refresh(editor?.document);
                }
            });
        } else {
            autoRefreshDisposable = undefined;
        }
    };

    applyRefreshMode();

    context.subscriptions.push(
        output,
        regionView,
        pragmaView,
        { dispose: () => autoRefreshDisposable?.dispose() },
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('al-pocket-tools.regionViewer.refreshMode')) {
                applyRefreshMode();
                if (regionView.visible) {
                    regionProvider.refresh(vscode.window.activeTextEditor?.document);
                }
            }
        }),
        vscode.commands.registerCommand(
            'al-pocket-tools.cleanupAppFiles',
            (uri?: vscode.Uri) => cleanupAppFiles(output, uri)
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.nukeAlPackages',
            () => nukeAlPackages(output)
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.syncAlPackages',
            () => syncAlPackages(output)
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
            'al-pocket-tools.refreshRegionViewer',
            () => { regionProvider.refresh(vscode.window.activeTextEditor?.document); }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.refreshPragmaViewer',
            () => { void pragmaProvider.scan(); }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.showCallGraph',
            () => { void showCallGraph(); }
        ),
        vscode.commands.registerCommand('al-pocket-tools.bumpVersion', () => { void bumpVersion(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMajor', () => { void incrementVersionPart('major'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMinor', () => { void incrementVersionPart('minor'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementBuild', () => { void incrementVersionPart('build'); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementRevision', () => { void incrementVersionPart('revision'); }),
    );
}

export function deactivate() {}
