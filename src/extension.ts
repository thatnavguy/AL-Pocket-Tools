import * as vscode from 'vscode';
import { cleanupAppFiles } from './commands/cleanupAppFiles';
import { nukeAlPackages } from './commands/nukeAlPackages';
import { syncAlPackages } from './commands/syncAlPackages';
import { bumpVersion, incrementVersionPart, VersionStatusBar } from './commands/versionBump';
import { clearLaunchConfigs, pasteLaunchConfig, saveLaunchConfig } from './commands/launchConfig';
import { changeProcedureVisibility, changeProcedureVisibilityProject, showProcedureVisibility } from './commands/procedureVisibility';
import { RainbowIndentController } from './commands/rainbowIndent';
import { searchAssignments, refreshAssignmentTracker, toggleAssignmentTrackerScope } from './commands/assignmentTracker';
import { addSetLoadFields } from './commands/setLoadFields';
import { registerParameterAlignmentProvider } from './providers/ParameterAlignmentProvider';
import { AssignmentTrackerProvider } from './providers/AssignmentTrackerProvider';
import { RegionTreeProvider } from './providers/RegionTreeProvider';
import { PragmaTreeProvider } from './providers/PragmaTreeProvider';
import { ReportTreeProvider } from './providers/ReportTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('AL Pocket Tools');
    const regionProvider = new RegionTreeProvider();
    const pragmaProvider = new PragmaTreeProvider();
    const reportProvider = new ReportTreeProvider();

    const assignmentProvider = new AssignmentTrackerProvider();
    const versionStatusBar = new VersionStatusBar(context);
    const rainbowIndent = new RainbowIndentController();

    const regionView = vscode.window.createTreeView('al-pocket-tools.regionViewer', {
        treeDataProvider: regionProvider,
        showCollapseAll: true,
    });

    const pragmaView = vscode.window.createTreeView('al-pocket-tools.pragmaViewer', {
        treeDataProvider: pragmaProvider,
        showCollapseAll: true,
    });

    const reportView = vscode.window.createTreeView('al-pocket-tools.reportViewer', {
        treeDataProvider: reportProvider,
        showCollapseAll: true,
    });

    const assignmentTrackerView = vscode.window.createTreeView('al-pocket-tools.assignmentTracker', {
        treeDataProvider: assignmentProvider,
        showCollapseAll: true,
    });

    // Swap in/out the onDidChangeActiveTextEditor listener based on the refreshMode settings.
    let reportAutoRefreshDisposable: vscode.Disposable | undefined;

    const applyReportRefreshMode = () => {
        reportAutoRefreshDisposable?.dispose();
        const mode = vscode.workspace
            .getConfiguration('al-pocket-tools')
            .get<string>('reportViewer.refreshMode', 'manual');

        void vscode.commands.executeCommand('setContext', 'al-pocket-tools:reportViewerMode', mode);

        if (mode === 'onOpenFile') {
            reportAutoRefreshDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
                if (reportView.visible) {
                    reportProvider.refresh(editor?.document);
                }
            });
        } else {
            reportAutoRefreshDisposable = undefined;
        }
    };

    applyReportRefreshMode();

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
        reportView,
        assignmentTrackerView,
        { dispose: () => reportAutoRefreshDisposable?.dispose() },
        { dispose: () => autoRefreshDisposable?.dispose() },
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('al-pocket-tools.regionViewer.refreshMode')) {
                applyRefreshMode();
                if (regionView.visible) {
                    regionProvider.refresh(vscode.window.activeTextEditor?.document);
                }
            }
            if (e.affectsConfiguration('al-pocket-tools.reportViewer.refreshMode')) {
                applyReportRefreshMode();
                if (reportView.visible) {
                    reportProvider.refresh(vscode.window.activeTextEditor?.document);
                }
            }
            if (e.affectsConfiguration('al-pocket-tools.reportViewer.showVarDeclarations')) {
                reportProvider.refresh(vscode.window.activeTextEditor?.document);
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
            'al-pocket-tools.refreshReportViewer',
            () => { reportProvider.refresh(vscode.window.activeTextEditor?.document); }
        ),
        vscode.commands.registerCommand('al-pocket-tools.bumpVersion', async () => { await bumpVersion(); versionStatusBar.refresh(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMajor', async () => { await incrementVersionPart('major'); versionStatusBar.refresh(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementMinor', async () => { await incrementVersionPart('minor'); versionStatusBar.refresh(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementBuild', async () => { await incrementVersionPart('build'); versionStatusBar.refresh(); }),
        vscode.commands.registerCommand('al-pocket-tools.incrementRevision', async () => { await incrementVersionPart('revision'); versionStatusBar.refresh(); }),
        vscode.commands.registerCommand('al-pocket-tools.pasteLaunchConfig', () => { void pasteLaunchConfig(); }),
        vscode.commands.registerCommand('al-pocket-tools.saveLaunchConfig', () => { void saveLaunchConfig(); }),
        vscode.commands.registerCommand('al-pocket-tools.clearLaunchConfigs', () => { void clearLaunchConfigs(); }),
        vscode.commands.registerCommand('al-pocket-tools.showProcedureVisibility', () => { void showProcedureVisibility(); }),
        vscode.commands.registerCommand('al-pocket-tools.changeProcedureVisibility', () => { void changeProcedureVisibility(); }),
        vscode.commands.registerCommand('al-pocket-tools.changeProcedureVisibilityProject', () => { void changeProcedureVisibilityProject(); }),
        vscode.commands.registerCommand('al-pocket-tools.toggleRainbowIndent', () => { rainbowIndent.toggle(); }),
        vscode.commands.registerCommand(
            'al-pocket-tools.searchAssignments',
            () => { void searchAssignments(assignmentProvider, assignmentTrackerView); }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.refreshAssignmentTracker',
            () => { void refreshAssignmentTracker(assignmentProvider, assignmentTrackerView); }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.toggleAssignmentTrackerScope',
            () => { void toggleAssignmentTrackerScope(assignmentProvider, assignmentTrackerView); }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.goToAssignment',
            async (uri: vscode.Uri, line: number) => {
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc);
                const pos = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        ),
        vscode.commands.registerCommand(
            'al-pocket-tools.addSetLoadFields',
            () => { void addSetLoadFields(); }
        ),
        rainbowIndent,
    );

    registerParameterAlignmentProvider(context);
}

export function deactivate() {}
