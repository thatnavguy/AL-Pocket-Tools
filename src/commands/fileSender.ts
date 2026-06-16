import * as vscode from 'vscode';
import * as path from 'path';

interface SavedFolder {
    label: string;
    path: string;
}

type SaveBehavior = 'always' | 'ask' | 'never';
type FolderQuickPickItem = vscode.QuickPickItem & { folderPath?: string };

async function promptForLabel(folderPath: string, existing: SavedFolder[]): Promise<string | undefined> {
    let value = path.basename(folderPath);
    while (true) {
        const label = await vscode.window.showInputBox({
            title: 'Save Folder to Favourites',
            prompt: 'Enter a name for this folder',
            value,
        });
        if (label === undefined) { return undefined; }
        if (existing.some(f => f.label === label)) {
            const action = await vscode.window.showWarningMessage(
                `A saved folder named "${label}" already exists. Choose a different name.`,
                'Try Again', 'Cancel'
            );
            if (action !== 'Try Again') { return undefined; }
            value = label;
            continue;
        }
        return label;
    }
}

async function addToFavourites(folderPath: string, existing: SavedFolder[]): Promise<void> {
    const label = await promptForLabel(folderPath, existing);
    if (!label) { return; }
    const config = vscode.workspace.getConfiguration('al-pocket-tools');
    await config.update(
        'fileSender.savedFolders',
        [...existing, { label, path: folderPath }],
        vscode.ConfigurationTarget.Global
    );
}

async function pickDestinationFolder(savedFolders: SavedFolder[]): Promise<string | undefined> {
    const items: FolderQuickPickItem[] = [
        ...savedFolders.map(f => ({
            label: f.label,
            description: f.path,
            folderPath: f.path,
        })),
        ...(savedFolders.length > 0
            ? [{ label: '', kind: vscode.QuickPickItemKind.Separator } as FolderQuickPickItem]
            : []),
        { label: '$(folder-opened) Browse for folder...' },
    ];

    const selected = await vscode.window.showQuickPick<FolderQuickPickItem>(items, {
        title: 'Select Destination Folder',
        placeHolder: 'Choose a saved folder or browse…',
        matchOnDescription: true,
    });
    if (!selected) { return undefined; }

    if (selected.folderPath) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(selected.folderPath));
        } catch {
            vscode.window.showErrorMessage(
                `Saved folder "${selected.label}" no longer exists: ${selected.folderPath}`
            );
            return undefined;
        }
        return selected.folderPath;
    }

    // Browse for a new folder
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Folder',
    });
    if (!uris || uris.length === 0) { return undefined; }
    const chosenPath = uris[0].fsPath;

    // Re-read config so we have the freshest saved folders list before appending
    const config = vscode.workspace.getConfiguration('al-pocket-tools');
    const freshSaved = config.get<SavedFolder[]>('fileSender.savedFolders', []);
    const behavior = config.get<SaveBehavior>('fileSender.saveBrowsedFolder', 'always');

    if (behavior === 'always') {
        await addToFavourites(chosenPath, freshSaved);
    } else if (behavior === 'ask') {
        const answer = await vscode.window.showInformationMessage(
            `Save "${path.basename(chosenPath)}" to favourites?`,
            'Yes', 'No'
        );
        if (answer === 'Yes') {
            await addToFavourites(chosenPath, freshSaved);
        }
    }

    return chosenPath;
}

async function sendFiles(
    uri: vscode.Uri | undefined,
    allUris: vscode.Uri[] | undefined,
    operation: 'copy' | 'move'
): Promise<void> {
    // VS Code passes allUris when multiple files are selected; fall back to single uri
    const sources = allUris && allUris.length > 0 ? allUris : (uri ? [uri] : []);
    if (sources.length === 0) {
        vscode.window.showErrorMessage('No file selected.');
        return;
    }

    const config = vscode.workspace.getConfiguration('al-pocket-tools');
    const savedFolders = config.get<SavedFolder[]>('fileSender.savedFolders', []);

    const destFolder = await pickDestinationFolder(savedFolders);
    if (!destFolder) { return; }

    // Detect conflicts
    const conflicts: vscode.Uri[] = [];
    for (const src of sources) {
        const destUri = vscode.Uri.file(path.join(destFolder, path.basename(src.fsPath)));
        try { await vscode.workspace.fs.stat(destUri); conflicts.push(src); } catch { /* no conflict */ }
    }

    let overwriteAll = false;
    if (conflicts.length > 0) {
        const names = conflicts.map(u => path.basename(u.fsPath)).join(', ');
        const msg = conflicts.length === 1
            ? `"${names}" already exists in the destination. Overwrite?`
            : `${conflicts.length} files already exist in the destination (${names}). Overwrite all?`;
        const answer = await vscode.window.showWarningMessage(msg, { modal: true }, 'Overwrite');
        if (answer !== 'Overwrite') { return; }
        overwriteAll = true;
    }

    const verb = operation === 'copy' ? 'Copied' : 'Moved';
    let succeeded = 0;
    const errors: string[] = [];

    for (const src of sources) {
        const fileName = path.basename(src.fsPath);
        const destUri = vscode.Uri.file(path.join(destFolder, fileName));
        const isConflict = conflicts.some(c => c.fsPath === src.fsPath);
        if (isConflict && !overwriteAll) { continue; }
        try {
            await vscode.workspace.fs.copy(src, destUri, { overwrite: true });
            if (operation === 'move') {
                await vscode.workspace.fs.delete(src);
            }
            succeeded++;
        } catch (err) {
            errors.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (errors.length > 0) {
        vscode.window.showErrorMessage(`Failed to ${operation} ${errors.length} file(s): ${errors.join('; ')}`);
    }
    if (succeeded > 0) {
        const label = succeeded === 1 ? `"${path.basename(sources.find(s => !errors.some(e => e.startsWith(path.basename(s.fsPath))))?.fsPath ?? '')}"` : `${succeeded} files`;
        vscode.window.showInformationMessage(`${verb} ${label} to "${destFolder}".`);
    }
}

export function copyFileTo(uri?: vscode.Uri, allUris?: vscode.Uri[]): void {
    void sendFiles(uri, allUris, 'copy');
}

export function moveFileTo(uri?: vscode.Uri, allUris?: vscode.Uri[]): void {
    void sendFiles(uri, allUris, 'move');
}
