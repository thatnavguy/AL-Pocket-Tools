import * as vscode from 'vscode';

// Returns the parts of a Caption = '...' line, or null if the line is not a Caption property.
// Uses lastIndexOf to find the closing quote, so it correctly handles any characters in the value.
function parseCaptionLine(lineText: string): { pre: string; value: string; post: string } | null {
    const openMatch = /^(\s*Caption\s*=\s*')/i.exec(lineText);
    if (!openMatch) { return null; }

    const pre = openMatch[1];
    const rest = lineText.slice(pre.length);
    const closeIdx = rest.lastIndexOf("'");
    if (closeIdx === -1) { return null; }

    return {
        pre,
        value: rest.slice(0, closeIdx),
        post: rest.slice(closeIdx), // closing quote + whatever follows (e.g. ';')
    };
}

async function removeCaptionAffix(mode: 'suffix' | 'prefix'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    if (editor.document.languageId !== 'al') {
        vscode.window.showWarningMessage('This command only works in AL files.');
        return;
    }

    const config = vscode.workspace.getConfiguration('al-pocket-tools');
    const settingKey = mode === 'suffix'
        ? 'captionAffix.defaultSuffix'
        : 'captionAffix.defaultPrefix';
    const defaultValue = config.get<string>(settingKey, '');
    const label = mode === 'suffix' ? 'suffix' : 'prefix';

    const affix = await vscode.window.showInputBox({
        title: `Remove Caption ${mode === 'suffix' ? 'Suffix' : 'Prefix'}`,
        prompt: `Enter the ${label} to strip from all Caption values in this file`,
        value: defaultValue,
        placeHolder: mode === 'suffix' ? 'e.g. TNG' : 'e.g. BC_',
        validateInput: v => v.trim().length === 0 ? `${label} cannot be empty` : undefined,
    });

    if (affix === undefined) { return; }
    if (affix.trim().length === 0) {
        vscode.window.showWarningMessage(`${label} cannot be empty.`);
        return;
    }

    const document = editor.document;
    const edits: { line: number; newText: string }[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const parsed = parseCaptionLine(document.lineAt(i).text);
        if (!parsed) { continue; }

        let newValue: string;
        if (mode === 'suffix') {
            if (!parsed.value.endsWith(affix)) { continue; }
            newValue = parsed.value.slice(0, parsed.value.length - affix.length);
        } else {
            if (!parsed.value.startsWith(affix)) { continue; }
            newValue = parsed.value.slice(affix.length);
        }

        edits.push({ line: i, newText: parsed.pre + newValue + parsed.post });
    }

    if (edits.length === 0) {
        vscode.window.showInformationMessage(`No captions found with that ${label}.`);
        return;
    }

    await editor.edit(editBuilder => {
        for (const edit of edits) {
            editBuilder.replace(document.lineAt(edit.line).range, edit.newText);
        }
    });

    vscode.window.showInformationMessage(
        `Removed ${label} "${affix}" from ${edits.length} caption(s).`
    );
}

export async function removeCaptionSuffix(): Promise<void> {
    return removeCaptionAffix('suffix');
}

export async function removeCaptionPrefix(): Promise<void> {
    return removeCaptionAffix('prefix');
}
