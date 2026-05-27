import * as vscode from 'vscode';
import { AssignmentMatch, AssignmentKind, AssignmentTrackerProvider } from '../providers/AssignmentTrackerProvider';

// ---------------------------------------------------------------------------
// Field name extraction
// ---------------------------------------------------------------------------

/**
 * Tries to extract a field or variable name from the cursor position in an AL document.
 * Handles both quoted ("Field Name") and unquoted (FieldName) identifiers.
 * Returns undefined when the cursor position cannot be resolved to an identifier.
 */
function extractFieldNameAtCursor(editor: vscode.TextEditor): string | undefined {
    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;
    const col = position.character;

    // Try quoted identifier: "Field Name"
    const quotedPattern = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = quotedPattern.exec(line)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (col >= start && col <= end) {
            return m[1];
        }
    }

    // Try unquoted identifier
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (wordRange) {
        return document.getText(wordRange);
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Builds regexes that match the three AL assignment patterns for a given field name.
 * Pass an empty string to match ALL assignments regardless of field/variable name.
 *
 * Patterns detected:
 *   validate       — SomeRec.Validate("Field Name", ...)  or  SomeRec.Validate(FieldName, ...)
 *   direct         — SomeRec."Field Name" :=              or  SomeRec.FieldName :=
 *                    also catches bare variable assignments: VariableName :=
 *   transferfields — AnyRec.TransferFields(
 *
 * The record-variable prefix (\w+\.) is intentionally loose so we find assignments
 * from any record variable.
 */
function buildPatterns(fieldName: string): { kind: AssignmentKind; regex: RegExp }[] {
    if (!fieldName) {
        // Catch-all: match any assignment regardless of field or variable name
        return [
            {
                kind: 'validate' as AssignmentKind,
                regex: /\w+\.Validate\(/i,
            },
            {
                kind: 'direct' as AssignmentKind,
                // Any identifier (optionally prefixed by record.) followed by :=
                regex: /(?:\w+\.)?(?:"[^"]+"|[A-Za-z_]\w*)\s*:=/i,
            },
            {
                kind: 'compound' as AssignmentKind,
                // Any identifier (optionally prefixed by record.) followed by +=, -=, *=, /=
                regex: /(?:\w+\.)?(?:"[^"]+"|[A-Za-z_]\w*)\s*[+\-*/]=/i,
            },
            {
                kind: 'transferfields' as AssignmentKind,
                regex: /\w+\.TransferFields\(/i,
            },
        ];
    }

    // Escape special regex characters in the field name, then allow both
    // quoted ("Field Name") and unquoted (FieldName) forms.
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fieldPattern = `(?:"${escaped}"|${escaped})`;

    return [
        {
            kind: 'validate' as AssignmentKind,
            regex: new RegExp(`\\w+\\.Validate\\(\\s*${fieldPattern}\\s*,`, 'i'),
        },
        {
            kind: 'direct' as AssignmentKind,
            regex: new RegExp(`(?:\\w+\\.)?${fieldPattern}\\s*:=`, 'i'),
        },
        {
            kind: 'compound' as AssignmentKind,
            regex: new RegExp(`(?:\\w+\\.)?${fieldPattern}\\s*[+\\-*/]=`, 'i'),
        },
        {
            kind: 'transferfields' as AssignmentKind,
            regex: /\w+\.TransferFields\(/i,
        },
    ];
}

interface ParseOptions {
    includeTransferFields: boolean;
}

function parseFileContent(
    content: string,
    fileUri: vscode.Uri,
    fieldName: string,
    opts: ParseOptions,
): AssignmentMatch[] {
    const patterns = buildPatterns(fieldName);
    const lines = content.split(/\r?\n/);
    const results: AssignmentMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];

        for (const { kind, regex } of patterns) {
            if (kind === 'transferfields' && !opts.includeTransferFields) {
                continue;
            }
            if (regex.test(lineText)) {
                results.push({ kind, lineNumber: i, lineText, fileUri });
                break; // Only record one match per line
            }
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

async function scanWorkspace(
    fieldName: string,
    opts: ParseOptions,
    token: vscode.CancellationToken,
): Promise<Map<string, AssignmentMatch[]>> {
    const uris = await vscode.workspace.findFiles('**/*.al', '**/.alpackages/**');
    const groups = new Map<string, AssignmentMatch[]>();

    for (const uri of uris) {
        if (token.isCancellationRequested) { break; }

        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(raw).toString('utf8');
            const matches = parseFileContent(content, uri, fieldName, opts);
            if (matches.length > 0) {
                groups.set(uri.toString(), matches);
            }
        } catch {
            // Skip unreadable files
        }
    }

    return groups;
}

async function scanCurrentFile(
    fieldName: string,
    opts: ParseOptions,
): Promise<Map<string, AssignmentMatch[]>> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'al') {
        return new Map();
    }

    const content = editor.document.getText();
    const matches = parseFileContent(content, editor.document.uri, fieldName, opts);
    const groups = new Map<string, AssignmentMatch[]>();
    if (matches.length > 0) {
        groups.set(editor.document.uri.toString(), matches);
    }
    return groups;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function searchAssignments(
    provider: AssignmentTrackerProvider,
    assignmentTrackerView: vscode.TreeView<import('../providers/AssignmentTrackerProvider').AssignmentTreeItem>,
): Promise<void> {
    // 1. Try to get field name from cursor
    const editor = vscode.window.activeTextEditor;
    let fieldName: string | undefined;

    if (editor?.document.languageId === 'al') {
        fieldName = extractFieldNameAtCursor(editor);
    }

    // 2. Fall back to QuickPick input
    if (fieldName === undefined) {
        fieldName = await vscode.window.showInputBox({
            title: 'Assignment Tracker — Search Field',
            prompt: 'Enter a field or variable name, or leave blank to find ALL assignments',
            placeHolder: 'Field / variable name (leave blank for all)',
            value: provider.lastFieldName ?? '',
        });
    }

    // undefined = user pressed Escape; empty string = find all assignments
    if (fieldName === undefined) { return; }

    // 3. Pick scope
    type ScopeItem = vscode.QuickPickItem & { value: 'workspace' | 'file' };
    const scopeItems: ScopeItem[] = [
        { label: '$(globe)  Workspace', description: 'Search all .al files in the workspace', value: 'workspace' },
        { label: '$(file-code)  Current File', description: 'Search only the active editor', value: 'file' },
    ];
    const scopeQP = vscode.window.createQuickPick<ScopeItem>();
    scopeQP.items = scopeItems;
    scopeQP.title = 'Assignment Tracker — Search Scope';
    const scopePick = await new Promise<ScopeItem | undefined>(resolve => {
        scopeQP.onDidAccept(() => { resolve(scopeQP.activeItems[0]); scopeQP.dispose(); });
        scopeQP.onDidHide(() => { resolve(undefined); scopeQP.dispose(); });
        scopeQP.show();
    });

    if (!scopePick) { return; }

    const scope = scopePick.value;
    const includeTransferFields = vscode.workspace
        .getConfiguration('al-pocket-tools')
        .get<boolean>('assignmentTracker.includeTransferFields', true);

    const opts: ParseOptions = { includeTransferFields };

    const searchLabel = fieldName || 'all assignments';

    // 4. Focus the sidebar
    await vscode.commands.executeCommand('al-pocket-tools.assignmentTracker.focus');

    provider.setScanning(true);

    await vscode.window.withProgress(
        {
            location: { viewId: 'al-pocket-tools.assignmentTracker' },
            title: `Searching for ${fieldName ? `assignments to "${fieldName}"` : 'all assignments'}…`,
            cancellable: true,
        },
        async (_progress, token) => {
            let groups: Map<string, AssignmentMatch[]>;

            if (scope === 'workspace') {
                groups = await scanWorkspace(fieldName!, opts, token);
            } else {
                groups = await scanCurrentFile(fieldName!, opts);
            }

            if (!token.isCancellationRequested) {
                provider.setResults(fieldName!, scope, groups);

                const total = [...groups.values()].reduce((s, m) => s + m.length, 0);
                if (total === 0) {
                    void vscode.window.showInformationMessage(
                        `Assignment Tracker: No assignments found for ${searchLabel}.`,
                    );
                }
            } else {
                provider.setScanning(false);
            }
        },
    );
}

export async function refreshAssignmentTracker(
    provider: AssignmentTrackerProvider,
    assignmentTrackerView: vscode.TreeView<import('../providers/AssignmentTrackerProvider').AssignmentTreeItem>,
): Promise<void> {
    if (provider.lastFieldName === undefined) {
        return searchAssignments(provider, assignmentTrackerView);
    }

    const fieldName = provider.lastFieldName;
    const includeTransferFields = vscode.workspace
        .getConfiguration('al-pocket-tools')
        .get<boolean>('assignmentTracker.includeTransferFields', true);

    const opts: ParseOptions = { includeTransferFields };
    const scope = provider.lastScope;

    provider.setScanning(true);

    await vscode.window.withProgress(
        {
            location: { viewId: 'al-pocket-tools.assignmentTracker' },
            title: `Refreshing ${fieldName ? `assignments for "${fieldName}"` : 'all assignments'}…`,
            cancellable: true,
        },
        async (_progress, token) => {
            let groups: Map<string, AssignmentMatch[]>;

            if (scope === 'workspace') {
                groups = await scanWorkspace(fieldName, opts, token);
            } else {
                groups = await scanCurrentFile(fieldName, opts);
            }

            if (!token.isCancellationRequested) {
                provider.setResults(fieldName, scope, groups);
            } else {
                provider.setScanning(false);
            }
        },
    );
}

export async function toggleAssignmentTrackerScope(
    provider: AssignmentTrackerProvider,
    assignmentTrackerView: vscode.TreeView<import('../providers/AssignmentTrackerProvider').AssignmentTreeItem>,
): Promise<void> {
    if (provider.lastFieldName === undefined) {
        return searchAssignments(provider, assignmentTrackerView);
    }

    const fieldName = provider.lastFieldName;
    const newScope: 'workspace' | 'file' =
        provider.lastScope === 'workspace' ? 'file' : 'workspace';

    const includeTransferFields = vscode.workspace
        .getConfiguration('al-pocket-tools')
        .get<boolean>('assignmentTracker.includeTransferFields', true);

    const opts: ParseOptions = { includeTransferFields };

    provider.setScanning(true);

    await vscode.window.withProgress(
        {
            location: { viewId: 'al-pocket-tools.assignmentTracker' },
            title: `Switching to ${newScope === 'workspace' ? 'workspace' : 'current file'} scope…`,
            cancellable: false,
        },
        async () => {
            let groups: Map<string, AssignmentMatch[]>;

            if (newScope === 'workspace') {
                groups = await scanWorkspace(fieldName, opts, new vscode.CancellationTokenSource().token);
            } else {
                groups = await scanCurrentFile(fieldName, opts);
            }

            provider.setResults(fieldName, newScope, groups);
        },
    );
}
