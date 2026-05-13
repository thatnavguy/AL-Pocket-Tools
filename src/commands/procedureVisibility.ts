import * as vscode from 'vscode';
import * as path from 'path';

type Visibility = 'local' | 'internal' | 'public';

interface ProcedureInfo {
    name: string;
    visibility: Visibility;
    line: number;
    insertOffset: number;                           // where to insert a keyword (immediately before 'procedure')
    keywordRange?: { start: number; end: number };  // byte range of the existing keyword + trailing space (non-public only)
}

type ProcItem = vscode.QuickPickItem & { proc: ProcedureInfo };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseProcedures(content: string): ProcedureInfo[] {
    const results: ProcedureInfo[] = [];
    const regex = /^([ \t]*)((?:local|internal)\s+)?(procedure)\s+(\w+|"[^"]+")/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
        const indent = match[1];
        const kw = match[2]; // e.g. "local " or "internal " (with trailing whitespace), or undefined
        const name = match[4].replace(/^"|"$/g, '');

        const visibility: Visibility = kw
            ? (kw.trim() === 'local' ? 'local' : 'internal')
            : 'public';

        const before = content.slice(0, match.index);
        const line = (before.match(/\n/g) ?? []).length;

        const indentLen = indent.length;
        const kwLen = kw?.length ?? 0;
        const insertOffset = match.index + indentLen + kwLen;

        const keywordRange = kw
            ? { start: match.index + indentLen, end: match.index + indentLen + kwLen }
            : undefined;

        results.push({ name, visibility, line, insertOffset, keywordRange });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LABEL: Record<Visibility, string> = { local: 'Local', internal: 'Internal', public: 'Public' };
const ICON: Record<Visibility, string>  = { local: '$(lock)', internal: '$(shield)', public: '$(globe)' };
const ALL_VISIBILITIES: Visibility[]    = ['public', 'internal', 'local'];

function offsetToPosition(content: string, offset: number): vscode.Position {
    const before = content.slice(0, offset);
    const lines = before.split('\n');
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

function rangeFromOffsets(content: string, start: number, end: number): vscode.Range {
    return new vscode.Range(offsetToPosition(content, start), offsetToPosition(content, end));
}

async function readFileContent(uri: vscode.Uri): Promise<string> {
    const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
    if (openDoc) { return openDoc.getText(); }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

function getSetting<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('al-pocket-tools').get<T>(key, fallback);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

async function askSourceVisibility(procedures: ProcedureInfo[], titlePrefix: string): Promise<Visibility | undefined> {
    const counts: Record<Visibility, number> = { local: 0, internal: 0, public: 0 };
    for (const p of procedures) { counts[p.visibility]++; }

    const options = ALL_VISIBILITIES
        .filter(v => counts[v] > 0)
        .map(v => ({
            label: LABEL[v],
            description: `${counts[v]} procedure${counts[v] === 1 ? '' : 's'}`,
        }));

    if (options.length === 0) { return undefined; }

    const picked = await vscode.window.showQuickPick(options, {
        title: `${titlePrefix} — Select Source`,
        placeHolder: 'Which procedures do you want to change?',
    });
    return picked ? picked.label.toLowerCase() as Visibility : undefined;
}

async function askTargetVisibility(source: Visibility, titlePrefix: string): Promise<Visibility | undefined> {
    const options = ALL_VISIBILITIES
        .filter(v => v !== source)
        .map(v => ({ label: LABEL[v], description: `Change to ${v}` }));

    const picked = await vscode.window.showQuickPick(options, {
        title: `${titlePrefix} — Select Target`,
        placeHolder: 'Select the target visibility',
    });
    return picked ? picked.label.toLowerCase() as Visibility : undefined;
}

async function confirmPerProcedure(
    procedures: ProcedureInfo[],
    target: Visibility,
    fileName: string,
): Promise<ProcedureInfo[] | null> {
    const approved: ProcedureInfo[] = [];

    for (let i = 0; i < procedures.length; i++) {
        const proc = procedures[i];
        const answer = await vscode.window.showWarningMessage(
            `Change '${proc.name}' from ${proc.visibility} to ${target} in ${fileName}? (${i + 1} of ${procedures.length})`,
            'Yes', 'Yes to All', 'Skip', 'Cancel'
        );
        if (!answer || answer === 'Cancel') { return null; }
        if (answer === 'Yes to All') { approved.push(...procedures.slice(i)); break; }
        if (answer === 'Yes') { approved.push(proc); }
    }

    return approved;
}

// ---------------------------------------------------------------------------
// Edit building
// ---------------------------------------------------------------------------

function addEditsForFile(
    edit: vscode.WorkspaceEdit,
    uri: vscode.Uri,
    procedures: ProcedureInfo[],
    target: Visibility,
    content: string,
): void {
    for (const proc of procedures) {
        if (target === 'public') {
            // Remove existing keyword (e.g. "local " or "internal ")
            edit.delete(uri, rangeFromOffsets(content, proc.keywordRange!.start, proc.keywordRange!.end));
        } else if (proc.visibility === 'public') {
            // Insert keyword before 'procedure'
            edit.insert(uri, offsetToPosition(content, proc.insertOffset), `${target} `);
        } else {
            // Replace one keyword with another (e.g. "local " → "internal ")
            edit.replace(uri, rangeFromOffsets(content, proc.keywordRange!.start, proc.keywordRange!.end), `${target} `);
        }
    }
}

// ---------------------------------------------------------------------------
// Exported commands
// ---------------------------------------------------------------------------

export async function showProcedureVisibility(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const procedures = parseProcedures(editor.document.getText());
    const fileName = path.basename(editor.document.fileName);

    if (procedures.length === 0) {
        vscode.window.showInformationMessage(`AL Pocket Tools: No procedures found in ${fileName}.`);
        return;
    }

    const counts: Record<Visibility, number> = { local: 0, internal: 0, public: 0 };
    for (const p of procedures) { counts[p.visibility]++; }

    const reportStyle = getSetting<string>('procedureVisibility.reportStyle', 'list');

    if (reportStyle === 'dialog') {
        await vscode.window.showInformationMessage(
            `Procedure visibility in ${fileName}`,
            { modal: true, detail: `Local:    ${counts.local}\nInternal: ${counts.internal}\nPublic:   ${counts.public}` },
            'OK'
        );
        return;
    }

    // List style — selecting a procedure navigates to it
    const separator: vscode.QuickPickItem = {
        label: `${counts.local} Local · ${counts.internal} Internal · ${counts.public} Public`,
        kind: vscode.QuickPickItemKind.Separator,
    };

    const items: ProcItem[] = procedures.map(p => ({
        label: `${ICON[p.visibility]} ${p.name}`,
        description: LABEL[p.visibility],
        detail: `Line ${p.line + 1}`,
        proc: p,
    }));

    const picked = await vscode.window.showQuickPick<ProcItem>(
        [separator as ProcItem, ...items],
        {
            title: `Procedure Visibility — ${fileName}`,
            placeHolder: `${procedures.length} procedure${procedures.length === 1 ? '' : 's'} — select one to navigate`,
            matchOnDescription: true,
        }
    );

    if (picked?.proc) {
        const pos = new vscode.Position(picked.proc.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

export async function changeProcedureVisibility(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const content = editor.document.getText();
    const fileName = path.basename(editor.document.fileName);
    const procedures = parseProcedures(content);

    if (procedures.length === 0) {
        vscode.window.showInformationMessage(`AL Pocket Tools: No procedures found in ${fileName}.`);
        return;
    }

    const TITLE = 'Change Procedure Visibility';

    const source = await askSourceVisibility(procedures, TITLE);
    if (!source) { return; }

    const target = await askTargetVisibility(source, TITLE);
    if (!target) { return; }

    const sourceProcs = procedures.filter(p => p.visibility === source);
    const confirmStyle = getSetting<string>('procedureVisibility.confirmationStyle', 'once');
    let toChange: ProcedureInfo[];

    if (confirmStyle === 'perProcedure') {
        const result = await confirmPerProcedure(sourceProcs, target, fileName);
        if (result === null) { return; }
        toChange = result;
    } else {
        const n = sourceProcs.length;
        const answer = await vscode.window.showWarningMessage(
            `Change ${n} ${source} procedure${n === 1 ? '' : 's'} to ${target} in ${fileName}?`,
            'Change', 'Cancel'
        );
        if (!answer || answer === 'Cancel') { return; }
        toChange = sourceProcs;
    }

    if (toChange.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No procedures were changed.');
        return;
    }

    const edit = new vscode.WorkspaceEdit();
    addEditsForFile(edit, editor.document.uri, toChange, target, content);
    await vscode.workspace.applyEdit(edit);

    const n = toChange.length;
    vscode.window.showInformationMessage(
        `AL Pocket Tools: Changed ${n} ${source} procedure${n === 1 ? '' : 's'} to ${target} in ${fileName}.`
    );
}

export async function changeProcedureVisibilityProject(): Promise<void> {
    const TITLE = 'Change Procedure Visibility (Project)';

    // Ask source without file-based counts since we haven't scanned yet
    const sourcePicked = await vscode.window.showQuickPick(
        ALL_VISIBILITIES.map(v => ({ label: LABEL[v], description: `Change ${v} procedures` })),
        { title: `${TITLE} — Select Source`, placeHolder: 'Which procedures do you want to change?' }
    );
    if (!sourcePicked) { return; }
    const source = sourcePicked.label.toLowerCase() as Visibility;

    const target = await askTargetVisibility(source, TITLE);
    if (!target) { return; }

    const alFiles = await vscode.workspace.findFiles('**/*.al', '**/node_modules/**');
    if (alFiles.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No AL files found in the workspace.');
        return;
    }

    type FileEntry = { uri: vscode.Uri; content: string; procs: ProcedureInfo[] };
    const entries: FileEntry[] = [];

    for (const uri of alFiles) {
        const content = await readFileContent(uri);
        const procs = parseProcedures(content).filter(p => p.visibility === source);
        if (procs.length > 0) { entries.push({ uri, content, procs }); }
    }

    if (entries.length === 0) {
        vscode.window.showInformationMessage(`AL Pocket Tools: No ${source} procedures found in the project.`);
        return;
    }

    const totalProcs = entries.reduce((sum, e) => sum + e.procs.length, 0);
    const totalFiles = entries.length;

    const answer = await vscode.window.showWarningMessage(
        `Change ${totalProcs} ${source} procedure${totalProcs === 1 ? '' : 's'} across ${totalFiles} file${totalFiles === 1 ? '' : 's'} to ${target}?`,
        'Change', 'Cancel'
    );
    if (!answer || answer === 'Cancel') { return; }

    const edit = new vscode.WorkspaceEdit();
    for (const { uri, content, procs } of entries) {
        addEditsForFile(edit, uri, procs, target, content);
    }
    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage(
        `AL Pocket Tools: Changed ${totalProcs} procedure${totalProcs === 1 ? '' : 's'} across ${totalFiles} file${totalFiles === 1 ? '' : 's'} to ${target}.`
    );
}
