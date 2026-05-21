import * as vscode from 'vscode';

type VersionPart = 'major' | 'minor' | 'build' | 'revision';

interface Version {
    major: number;
    minor: number;
    build: number;
    revision: number;
}

function parseVersion(versionStr: string): Version | undefined {
    const parts = versionStr.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) { return undefined; }
    const [major, minor, build, revision] = parts;
    return { major, minor, build, revision };
}

function bumpPart(v: Version, part: VersionPart): Version {
    switch (part) {
        case 'major': return { major: v.major + 1, minor: 0, build: 0, revision: 0 };
        case 'minor': return { ...v, minor: v.minor + 1, build: 0, revision: 0 };
        case 'build': return { ...v, build: v.build + 1, revision: 0 };
        case 'revision': return { ...v, revision: v.revision + 1 };
    }
}

function fmtVersion(v: Version): string {
    return `${v.major}.${v.minor}.${v.build}.${v.revision}`;
}

async function findAppJsonFiles(): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles('**/app.json', '**/{node_modules,.alpackages,.git}/**');
}

async function findNearestAppJson(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return undefined; }

    const roots = new Set(folders.map(f => f.uri.toString()));
    let dir = vscode.Uri.joinPath(fileUri, '..');

    while (true) {
        const candidate = vscode.Uri.joinPath(dir, 'app.json');
        try {
            await vscode.workspace.fs.stat(candidate);
            return candidate;
        } catch {
            // not at this level, walk up
        }

        if (roots.has(dir.toString())) { break; }
        const parent = vscode.Uri.joinPath(dir, '..');
        if (parent.toString() === dir.toString()) { break; }
        dir = parent;
    }

    return undefined;
}

async function resolveAppJson(): Promise<vscode.Uri | undefined> {
    // Prefer the app.json closest to the active file for frictionless single-project use
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const nearest = await findNearestAppJson(activeUri);
        if (nearest) { return nearest; }
    }

    const files = await findAppJsonFiles();

    if (files.length === 0) {
        vscode.window.showErrorMessage('AL Pocket Tools: No app.json found in the workspace.');
        return undefined;
    }

    if (files.length === 1) { return files[0]; }

    const items = files.map(f => ({ label: vscode.workspace.asRelativePath(f), uri: f }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Select AL Project',
        placeHolder: 'Multiple app.json files found — pick a project',
    });
    return picked?.uri;
}

async function readAppJson(uri: vscode.Uri): Promise<{ version: Version; content: string } | undefined> {
    let content: string;
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(raw).toString('utf8');
    } catch {
        vscode.window.showErrorMessage('AL Pocket Tools: Failed to read app.json.');
        return undefined;
    }

    let json: Record<string, unknown>;
    try {
        json = JSON.parse(content) as Record<string, unknown>;
    } catch {
        vscode.window.showErrorMessage('AL Pocket Tools: app.json contains invalid JSON.');
        return undefined;
    }

    const versionStr = typeof json['version'] === 'string' ? json['version'] : undefined;
    if (!versionStr) {
        vscode.window.showErrorMessage('AL Pocket Tools: app.json is missing a "version" field.');
        return undefined;
    }

    const version = parseVersion(versionStr);
    if (!version) {
        vscode.window.showErrorMessage(
            `AL Pocket Tools: Cannot parse version "${versionStr}". Expected Major.Minor.Build.Revision.`
        );
        return undefined;
    }

    return { version, content };
}

// Silent version read for status bar — no error messages
async function tryReadVersion(uri: vscode.Uri): Promise<Version | undefined> {
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const json = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        const versionStr = typeof json['version'] === 'string' ? json['version'] : undefined;
        return versionStr ? parseVersion(versionStr) : undefined;
    } catch {
        return undefined;
    }
}

async function writeVersion(uri: vscode.Uri, content: string, newVersion: Version): Promise<boolean> {
    const updated = content.replace(
        /"version"\s*:\s*"[^"]*"/,
        `"version": "${fmtVersion(newVersion)}"`,
    );

    if (updated === content) {
        vscode.window.showErrorMessage('AL Pocket Tools: Could not locate "version" field in app.json.');
        return false;
    }

    try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
        return true;
    } catch {
        vscode.window.showErrorMessage('AL Pocket Tools: Failed to write app.json.');
        return false;
    }
}

export async function bumpVersion(): Promise<void> {
    const uri = await resolveAppJson();
    if (!uri) { return; }

    const data = await readAppJson(uri);
    if (!data) { return; }

    const cur = data.version;

    const options: { label: string; description: string; detail: string; part: VersionPart }[] = [
        {
            label: 'Major',
            description: `${fmtVersion(cur)}  →  ${fmtVersion(bumpPart(cur, 'major'))}`,
            detail: 'Resets minor, build, and revision to 0',
            part: 'major',
        },
        {
            label: 'Minor',
            description: `${fmtVersion(cur)}  →  ${fmtVersion(bumpPart(cur, 'minor'))}`,
            detail: 'Resets build and revision to 0',
            part: 'minor',
        },
        {
            label: 'Build',
            description: `${fmtVersion(cur)}  →  ${fmtVersion(bumpPart(cur, 'build'))}`,
            detail: 'Resets revision to 0',
            part: 'build',
        },
        {
            label: 'Revision',
            description: `${fmtVersion(cur)}  →  ${fmtVersion(bumpPart(cur, 'revision'))}`,
            detail: 'Increments revision only',
            part: 'revision',
        },
    ];

    const picked = await vscode.window.showQuickPick(options, {
        title: `Bump Version  ·  current: ${fmtVersion(cur)}`,
        placeHolder: 'Select which part to increment',
        matchOnDescription: true,
    });

    if (!picked) { return; }

    const newVersion = bumpPart(cur, picked.part);
    const ok = await writeVersion(uri, data.content, newVersion);
    if (ok) {
        vscode.window.showInformationMessage(
            `Version bumped: ${fmtVersion(cur)} → ${fmtVersion(newVersion)}`
        );
    }
}

export async function incrementVersionPart(part: VersionPart): Promise<void> {
    const uri = await resolveAppJson();
    if (!uri) { return; }

    const data = await readAppJson(uri);
    if (!data) { return; }

    const newVersion = bumpPart(data.version, part);
    const ok = await writeVersion(uri, data.content, newVersion);
    if (ok) {
        vscode.window.showInformationMessage(
            `Version bumped: ${fmtVersion(data.version)} → ${fmtVersion(newVersion)}`
        );
    }
}

export class VersionStatusBar {
    private readonly item: vscode.StatusBarItem;
    // Keyed by workspace folder URI string; null means "no app.json found for this folder"
    private readonly appJsonCache = new Map<string, vscode.Uri | null>();

    constructor(context: vscode.ExtensionContext) {
        this.item = vscode.window.createStatusBarItem(
            'al-pocket-tools.versionStatus',
            vscode.StatusBarAlignment.Left,
            100,
        );
        this.item.name = 'AL Version';
        this.item.command = 'al-pocket-tools.bumpVersion';
        this.item.tooltip = 'AL project version — click to bump';

        context.subscriptions.push(
            this.item,
            vscode.window.onDidChangeActiveTextEditor(editor => { void this.update(editor); }),
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.fileName.endsWith('app.json')) {
                    void this.update(vscode.window.activeTextEditor);
                }
            }),
            vscode.workspace.onDidCreateFiles(() => {
                this.appJsonCache.clear();
                void this.update(vscode.window.activeTextEditor);
            }),
            vscode.workspace.onDidDeleteFiles(() => {
                this.appJsonCache.clear();
                void this.update(vscode.window.activeTextEditor);
            }),
        );

        void this.update(vscode.window.activeTextEditor);
    }

    private async resolveAppJson(editor: vscode.TextEditor | undefined): Promise<vscode.Uri | undefined> {
        const folder = editor
            ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
            : vscode.workspace.workspaceFolders?.[0];

        const key = folder?.uri.toString() ?? '';

        if (this.appJsonCache.has(key)) {
            return this.appJsonCache.get(key) ?? undefined;
        }

        let appJsonUri: vscode.Uri | undefined;
        if (editor) {
            appJsonUri = await findNearestAppJson(editor.document.uri);
        }
        if (!appJsonUri) {
            const files = await findAppJsonFiles();
            appJsonUri = files[0];
        }

        this.appJsonCache.set(key, appJsonUri ?? null);
        return appJsonUri;
    }

    public refresh(): void {
        void this.update(vscode.window.activeTextEditor);
    }

    private async update(editor: vscode.TextEditor | undefined): Promise<void> {
        const appJsonUri = await this.resolveAppJson(editor);

        if (!appJsonUri) {
            this.item.hide();
            return;
        }

        const version = await tryReadVersion(appJsonUri);
        if (!version) {
            this.item.hide();
            return;
        }

        this.item.text = `$(versions) ${fmtVersion(version)}`;
        this.item.show();
    }
}
