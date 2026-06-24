import * as vscode from 'vscode';
import * as path from 'path';

interface ParsedApp {
    uri: vscode.Uri;
    identity: string;
    version: [number, number, number, number];
    isDep: boolean;
}

interface DuplicateGroup {
    identity: string;
    kept: ParsedApp;
    toDelete: ParsedApp[];
}

interface FolderResult {
    folderPath: string;
    groups: DuplicateGroup[];
    skipped: string[];
    totalFiles: number;
}

// Filename convention: Publisher_AppName_Major.Minor.Build.Revision[.dep].app
// Last underscore-delimited segment is version; everything before is identity.
function parseAppFile(uri: vscode.Uri): ParsedApp | null {
    const filename = path.basename(uri.fsPath);
    const isDep = filename.endsWith('.dep.app');
    const base = isDep ? filename.slice(0, -'.dep.app'.length) : filename.slice(0, -'.app'.length);

    const segments = base.split('_');
    if (segments.length < 3) { return null; }

    const versionStr = segments[segments.length - 1];
    const identity = segments.slice(0, -1).join('_');
    const parts = versionStr.split('.').map(Number);

    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) { return null; }

    return { uri, identity, version: parts as [number, number, number, number], isDep };
}

function compareVersionDesc(a: ParsedApp, b: ParsedApp): number {
    for (let i = 0; i < 4; i++) {
        if (a.version[i] !== b.version[i]) { return b.version[i] - a.version[i]; }
    }
    return 0;
}

async function findDuplicates(fileUri?: vscode.Uri): Promise<{
    folderResults: FolderResult[];
    totalToDelete: number;
}> {
    const exclude = '**/node_modules/**';
    let appFiles: vscode.Uri[];
    let validDirs: Set<string>;

    if (fileUri) {
        // Right-click scope: only the folder containing the clicked file
        const folder = path.dirname(fileUri.fsPath);
        appFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '*.app'),
            exclude
        );
        validDirs = new Set([folder]);
    } else {
        // Command palette scope: entire workspace
        [appFiles, validDirs] = await Promise.all([
            vscode.workspace.findFiles('**/*.app', exclude),
            vscode.workspace.findFiles('**/app.json', exclude).then(
                uris => new Set(uris.map(u => path.dirname(u.fsPath)))
            ),
        ]);
    }

    // Group files by folder — only .alpackages dirs and AL project dirs (with app.json)
    const byFolder = new Map<string, vscode.Uri[]>();
    for (const uri of appFiles) {
        const dir = path.dirname(uri.fsPath);
        if (path.basename(dir) === '.alpackages' || validDirs.has(dir)) {
            const existing = byFolder.get(dir);
            if (existing) { existing.push(uri); }
            else { byFolder.set(dir, [uri]); }
        }
    }

    const folderResults: FolderResult[] = [];
    let totalToDelete = 0;

    for (const [folderPath, files] of byFolder) {
        const parsed: ParsedApp[] = [];
        const skipped: string[] = [];

        for (const uri of files) {
            const p = parseAppFile(uri);
            if (p) { parsed.push(p); }
            else { skipped.push(path.basename(uri.fsPath)); }
        }

        const byIdentity = new Map<string, ParsedApp[]>();
        for (const p of parsed) {
            const key = `${p.identity}|${p.isDep ? 'dep' : 'app'}`;
            const list = byIdentity.get(key);
            if (list) { list.push(p); }
            else { byIdentity.set(key, [p]); }
        }

        const groups: DuplicateGroup[] = [];
        for (const [identity, apps] of byIdentity) {
            if (apps.length < 2) { continue; }
            apps.sort(compareVersionDesc);
            groups.push({ identity, kept: apps[0], toDelete: apps.slice(1) });
            totalToDelete += apps.length - 1;
        }

        folderResults.push({ folderPath, groups, skipped, totalFiles: files.length });
    }

    return { folderResults, totalToDelete };
}

function writeReport(
    output: vscode.OutputChannel,
    folderResults: FolderResult[],
    totalToDelete: number
): void {
    output.clear();
    output.appendLine('');
    output.appendLine(`=== Scanned ${folderResults.length} folder(s) ===`);
    output.appendLine('');

    for (const result of folderResults) {
        const relPath = vscode.workspace.asRelativePath(result.folderPath);
        output.appendLine(`  ${relPath}  (${result.totalFiles} files)`);

        for (const s of result.skipped) {
            output.appendLine(`    [skipped] ${s}`);
        }

        if (result.groups.length === 0) {
            output.appendLine('    No duplicates found.');
        } else {
            for (const g of result.groups) {
                output.appendLine(`    ${g.identity}`);
                output.appendLine(`      KEEP   : ${path.basename(g.kept.uri.fsPath)}`);
                for (const old of g.toDelete) {
                    output.appendLine(`      DELETE : ${path.basename(old.uri.fsPath)}`);
                }
            }
        }
        output.appendLine('');
    }

    if (totalToDelete === 0) {
        output.appendLine('No duplicate apps found. Nothing to delete.');
    } else {
        output.appendLine(`Total files to delete: ${totalToDelete}`);
    }
}

export async function cleanupAppFiles(
    output: vscode.OutputChannel,
    fileUri?: vscode.Uri
): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage('AL Pocket Tools: No workspace folder is open.');
        return;
    }

    let scan: { folderResults: FolderResult[]; totalToDelete: number } | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'AL Pocket Tools: Scanning for duplicate .app files…',
            cancellable: false,
        },
        async () => {
            scan = await findDuplicates(fileUri);
        }
    );

    if (!scan) { return; }

    const { folderResults, totalToDelete } = scan;

    output.show(true);
    writeReport(output, folderResults, totalToDelete);

    if (totalToDelete === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No duplicate .app files found.');
        return;
    }

    const action = await vscode.window.showWarningMessage(
        `AL Pocket Tools: Found ${totalToDelete} duplicate .app file(s) to delete. Check the Output panel for details.`,
        { modal: true },
        'Delete'
    );

    if (action !== 'Delete') { return; }

    let deleted = 0;
    for (const result of folderResults) {
        for (const g of result.groups) {
            for (const old of g.toDelete) {
                await vscode.workspace.fs.delete(old.uri);
                deleted++;
            }
        }
    }

    output.appendLine('');
    output.appendLine(`Done. ${deleted} old version(s) removed.`);
    vscode.window.showInformationMessage(
        `AL Pocket Tools: Removed ${deleted} duplicate .app file(s).`
    );
}
