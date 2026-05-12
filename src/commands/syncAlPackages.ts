import * as vscode from 'vscode';
import * as path from 'path';

interface ParsedApp {
    uri: vscode.Uri;
    folderPath: string;
    identity: string;
    version: [number, number, number, number];
    filename: string;
}

interface IdentityAction {
    identity: string;
    toDelete: ParsedApp[];
    copySource: vscode.Uri | null;
    copyDestFilename: string | null;
}

interface FolderAction {
    folderPath: string;
    identityActions: IdentityAction[];
}

// Filename convention: Publisher_AppName_Major.Minor.Build.Revision.app
function parseAppFile(uri: vscode.Uri): ParsedApp | null {
    const base = path.basename(uri.fsPath, '.app');
    const segments = base.split('_');
    if (segments.length < 3) { return null; }

    const versionStr = segments[segments.length - 1];
    const identity = segments.slice(0, -1).join('_');
    const parts = versionStr.split('.').map(Number);

    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) { return null; }

    return {
        uri,
        folderPath: path.dirname(uri.fsPath),
        identity,
        version: parts as [number, number, number, number],
        filename: path.basename(uri.fsPath),
    };
}

function compareVersion(a: [number, number, number, number], b: [number, number, number, number]): number {
    for (let i = 0; i < 4; i++) {
        if (a[i] !== b[i]) { return a[i] - b[i]; }
    }
    return 0;
}

function buildSyncPlan(appFiles: vscode.Uri[]): {
    folderActions: FolderAction[];
    totalDeletes: number;
    totalCopies: number;
    skipped: string[];
} {
    const parsed: ParsedApp[] = [];
    const skipped: string[] = [];

    for (const uri of appFiles) {
        const p = parseAppFile(uri);
        if (p) { parsed.push(p); }
        else { skipped.push(path.basename(uri.fsPath)); }
    }

    // Find the newest version of each identity across all .alpackages folders
    const newestByIdentity = new Map<string, ParsedApp>();
    for (const p of parsed) {
        const cur = newestByIdentity.get(p.identity);
        if (!cur || compareVersion(p.version, cur.version) > 0) {
            newestByIdentity.set(p.identity, p);
        }
    }

    // Group: folder → identity → [apps]
    const byFolder = new Map<string, Map<string, ParsedApp[]>>();
    for (const p of parsed) {
        let identMap = byFolder.get(p.folderPath);
        if (!identMap) {
            identMap = new Map();
            byFolder.set(p.folderPath, identMap);
        }
        const list = identMap.get(p.identity);
        if (list) { list.push(p); }
        else { identMap.set(p.identity, [p]); }
    }

    const folderActions: FolderAction[] = [];
    let totalDeletes = 0;
    let totalCopies = 0;

    for (const [folderPath, identMap] of byFolder) {
        const identityActions: IdentityAction[] = [];

        for (const [identity, folderApps] of identMap) {
            const newest = newestByIdentity.get(identity)!;
            const hasNewest = folderApps.some(a => compareVersion(a.version, newest.version) === 0);
            const toDelete = folderApps.filter(a => compareVersion(a.version, newest.version) < 0);

            if (toDelete.length === 0) { continue; } // already up to date

            totalDeletes += toDelete.length;
            let copySource: vscode.Uri | null = null;
            let copyDestFilename: string | null = null;

            if (!hasNewest) {
                copySource = newest.uri;
                copyDestFilename = newest.filename;
                totalCopies++;
            }

            identityActions.push({ identity, toDelete, copySource, copyDestFilename });
        }

        if (identityActions.length > 0) {
            folderActions.push({ folderPath, identityActions });
        }
    }

    return { folderActions, totalDeletes, totalCopies, skipped };
}

function writeReport(
    output: vscode.OutputChannel,
    folderActions: FolderAction[],
    totalDeletes: number,
    totalCopies: number,
    skipped: string[],
): void {
    output.clear();
    output.appendLine('');
    output.appendLine('=== .alpackages sync plan ===');
    output.appendLine('');

    if (skipped.length > 0) {
        output.appendLine('Skipped (unrecognised filename format):');
        for (const s of skipped) {
            output.appendLine(`  ${s}`);
        }
        output.appendLine('');
    }

    if (folderActions.length === 0) {
        output.appendLine('All .alpackages folders are already in sync.');
        return;
    }

    for (const fa of folderActions) {
        const relPath = vscode.workspace.asRelativePath(fa.folderPath);
        output.appendLine(`  ${relPath}`);
        for (const ia of fa.identityActions) {
            for (const old of ia.toDelete) {
                output.appendLine(`    DELETE : ${old.filename}`);
            }
            if (ia.copySource && ia.copyDestFilename) {
                const sourceRel = vscode.workspace.asRelativePath(ia.copySource);
                output.appendLine(`    COPY   : ${ia.copyDestFilename}  (from ${path.dirname(sourceRel)})`);
            }
        }
        output.appendLine('');
    }

    output.appendLine(`Total: ${totalDeletes} file(s) to delete, ${totalCopies} file(s) to copy.`);
}

export async function syncAlPackages(output: vscode.OutputChannel): Promise<void> {
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

    if (appFiles.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No .app files found in .alpackages folders.');
        return;
    }

    const { folderActions, totalDeletes, totalCopies, skipped } = buildSyncPlan(appFiles);

    output.show(true);
    writeReport(output, folderActions, totalDeletes, totalCopies, skipped);

    if (folderActions.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: All .alpackages folders are already in sync.');
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `AL Pocket Tools: ${totalDeletes} file(s) will be deleted and ${totalCopies} file(s) copied across ${folderActions.length} folder(s). Check the Output panel for details.`,
        { modal: true },
        'Sync'
    );

    if (confirmed !== 'Sync') { return; }

    let deleted = 0;
    let copied = 0;

    for (const fa of folderActions) {
        for (const ia of fa.identityActions) {
            for (const old of ia.toDelete) {
                await vscode.workspace.fs.delete(old.uri);
                deleted++;
            }
            if (ia.copySource && ia.copyDestFilename) {
                const destUri = vscode.Uri.file(path.join(fa.folderPath, ia.copyDestFilename));
                await vscode.workspace.fs.copy(ia.copySource, destUri, { overwrite: false });
                copied++;
            }
        }
    }

    output.appendLine('');
    output.appendLine(`Done. ${deleted} file(s) deleted, ${copied} file(s) copied.`);
    vscode.window.showInformationMessage(
        `AL Pocket Tools: Sync complete — ${deleted} removed, ${copied} copied.`
    );
}
