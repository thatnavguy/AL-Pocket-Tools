import * as vscode from 'vscode';

// Tries record-prefixed pattern first (Record.Field := Value;), then bare (Field := Value;).
// Returns the converted line or null if neither pattern matches.
function convertLine(lineText: string): string | null {
    const recordMatch = /^(\s*)(\w+)\.(\"[^\"]+\"|\w+)\s*:=\s*(.+?)\s*;(\s*)$/.exec(lineText);
    if (recordMatch) {
        const [, indent, record, field, value, trailing] = recordMatch;
        return `${indent}${record}.Validate(${field}, ${value});${trailing}`;
    }

    const bareMatch = /^(\s*)(\"[^\"]+\"|\w+)\s*:=\s*(.+?)\s*;(\s*)$/.exec(lineText);
    if (bareMatch) {
        const [, indent, field, value, trailing] = bareMatch;
        return `${indent}Validate(${field}, ${value});${trailing}`;
    }

    return null;
}

export async function convertAssignmentToValidate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Select one or more assignment lines first.');
        return;
    }

    const document = editor.document;
    const edits: { line: number; newText: string }[] = [];

    for (let i = selection.start.line; i <= selection.end.line; i++) {
        const lineText = document.lineAt(i).text;
        const converted = convertLine(lineText);
        if (converted !== null) {
            edits.push({ line: i, newText: converted });
        }
    }

    if (edits.length === 0) {
        vscode.window.showInformationMessage('No assignments found in the selection.');
        return;
    }

    await editor.edit(editBuilder => {
        for (const edit of edits) {
            editBuilder.replace(document.lineAt(edit.line).range, edit.newText);
        }
    });

    vscode.window.showInformationMessage(`Converted ${edits.length} assignment(s) to Validate.`);
}
