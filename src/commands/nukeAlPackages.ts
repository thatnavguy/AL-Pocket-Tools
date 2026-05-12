import * as vscode from 'vscode';
import * as path from 'path';

export async function nukeAlPackages(output: vscode.OutputChannel): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage('AL Pocket Tools: No workspace folder is open.');
        return;
    }

    let appFiles: vscode.Uri[] | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'AL Pocket Tools: Scanning .alpackages folders…',
            cancellable: false,
        },
        async () => {
            appFiles = await vscode.workspace.findFiles('**/.alpackages/*.app', '**/node_modules/**');
        }
    );

    if (!appFiles) { return; }

    output.clear();
    output.appendLine('');
    output.appendLine('=== .alpackages nuke scan ===');
    output.appendLine('');

    if (appFiles.length === 0) {
        output.appendLine('No .app files found in any .alpackages folder.');
        vscode.window.showInformationMessage('AL Pocket Tools: No .app files found in .alpackages folders.');
        return;
    }

    const byFolder = new Map<string, vscode.Uri[]>();
    for (const uri of appFiles) {
        const dir = path.dirname(uri.fsPath);
        const existing = byFolder.get(dir);
        if (existing) { existing.push(uri); }
        else { byFolder.set(dir, [uri]); }
    }

    for (const [folderPath, files] of byFolder) {
        const relPath = vscode.workspace.asRelativePath(folderPath);
        output.appendLine(`  ${relPath}  (${files.length} file(s))`);
        for (const uri of files) {
            output.appendLine(`    DELETE : ${path.basename(uri.fsPath)}`);
        }
        output.appendLine('');
    }
    output.appendLine(`Total files to delete: ${appFiles.length}`);
    output.show(true);

    const action = await vscode.window.showWarningMessage(
        `AL Pocket Tools: Found ${appFiles.length} .app file(s) across ${byFolder.size} .alpackages folder(s). This will delete ALL of them. Check the Output panel for the full list.`,
        { modal: true },
        'Delete All'
    );

    if (action !== 'Delete All') { return; }

    let deleted = 0;
    for (const uri of appFiles) {
        await vscode.workspace.fs.delete(uri);
        deleted++;
    }

    output.appendLine('');
    output.appendLine(`Done. ${deleted} .app file(s) removed.`);
    vscode.window.showInformationMessage(
        `AL Pocket Tools: Removed ${deleted} .app file(s) from .alpackages folders.`
    );
}
