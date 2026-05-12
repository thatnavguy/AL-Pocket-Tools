import * as vscode from 'vscode';

type LaunchConfig = Record<string, unknown>;

const SETTING_KEY = 'launch.configurations';

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripJsonComments(text: string): string {
    return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseLaunchJson(content: string): { configurations: LaunchConfig[] } | undefined {
    try {
        const parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
        if (!Array.isArray(parsed['configurations'])) { return { configurations: [] }; }
        return { configurations: parsed['configurations'] as LaunchConfig[] };
    } catch {
        return undefined;
    }
}

function getSavedConfigs(): LaunchConfig[] {
    return vscode.workspace.getConfiguration('al-pocket-tools').get<LaunchConfig[]>(SETTING_KEY, []);
}

function configLabel(c: LaunchConfig): string {
    return typeof c['name'] === 'string' ? c['name'] : '(unnamed)';
}

function configDescription(c: LaunchConfig): string {
    const parts: string[] = [];
    if (typeof c['environmentType'] === 'string') { parts.push(c['environmentType']); }
    if (typeof c['environmentName'] === 'string') { parts.push(c['environmentName']); }
    else if (typeof c['server'] === 'string') { parts.push(c['server']); }
    return parts.join(' · ');
}

function detectIndentUnit(content: string): string {
    const match = /\n([ \t]+)"/.exec(content);
    if (!match) { return '    '; }
    const ws = match[1];
    return ws.includes('\t') ? '\t' : (ws.length <= 2 ? '  ' : '    ');
}

function findConfigObjectRange(
    document: vscode.TextDocument,
    content: string,
    configName: string,
): vscode.Range | undefined {
    const arrayMatch = /"configurations"\s*:\s*\[/.exec(content);
    if (!arrayMatch) { return undefined; }

    const arrayStart = arrayMatch.index + arrayMatch[0].length;
    const nameMatch = new RegExp(`"name"\\s*:\\s*"${escapeRegex(configName)}"`).exec(content.slice(arrayStart));
    if (!nameMatch) { return undefined; }

    const nameOffset = arrayStart + nameMatch.index;

    let start = nameOffset;
    while (start > arrayStart && content[start] !== '{') { start--; }
    if (content[start] !== '{') { return undefined; }

    let depth = 0;
    let end = start;
    while (end < content.length) {
        if (content[end] === '{') { depth++; }
        else if (content[end] === '}') {
            depth--;
            if (depth === 0) { break; }
        }
        end++;
    }
    if (depth !== 0) { return undefined; }

    return new vscode.Range(document.positionAt(start), document.positionAt(end + 1));
}

function findConfigAtCursor(
    document: vscode.TextDocument,
    content: string,
    position: vscode.Position,
    configs: LaunchConfig[],
): LaunchConfig | undefined {
    const cursorOffset = document.offsetAt(position);
    for (const config of configs) {
        const name = typeof config['name'] === 'string' ? config['name'] : null;
        if (!name) { continue; }
        const range = findConfigObjectRange(document, content, name);
        if (!range) { continue; }
        if (cursorOffset >= document.offsetAt(range.start) && cursorOffset <= document.offsetAt(range.end)) {
            return config;
        }
    }
    return undefined;
}

async function appendConfigToDocument(editor: vscode.TextEditor, config: LaunchConfig): Promise<void> {
    const doc = editor.document;
    const content = doc.getText();

    const arrayMatch = /"configurations"\s*:\s*\[/.exec(content);
    if (!arrayMatch) {
        vscode.window.showErrorMessage('AL Pocket Tools: Could not find "configurations" array in launch.json.');
        return;
    }

    const arrayStart = arrayMatch.index + arrayMatch[0].length;
    let depth = 1;
    let idx = arrayStart;
    while (idx < content.length && depth > 0) {
        if (content[idx] === '[') { depth++; }
        else if (content[idx] === ']') { depth--; }
        idx++;
    }
    const closingBracketOffset = idx - 1;

    const parentIndent = doc.lineAt(doc.positionAt(arrayMatch.index).line).text.match(/^([ \t]*)/)?.[1] ?? '';
    const indentUnit = detectIndentUnit(content);
    const configIndent = parentIndent + indentUnit;

    const formatted = JSON.stringify(config, null, indentUnit);
    const indented = configIndent + formatted.split('\n').join('\n' + configIndent);

    const hasEntries = /\}/.test(content.slice(arrayStart, closingBracketOffset).trim());

    let insertText: string;
    let insertOffset: number;

    if (hasEntries) {
        insertOffset = content.lastIndexOf('}', closingBracketOffset - 1) + 1;
        insertText = `,\n${indented}`;
    } else {
        insertOffset = closingBracketOffset;
        insertText = `\n${indented}\n${parentIndent}`;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(insertOffset), insertText);
    await vscode.workspace.applyEdit(edit);
}

async function replaceConfigInDocument(editor: vscode.TextEditor, existingName: string, newConfig: LaunchConfig): Promise<void> {
    const doc = editor.document;
    const content = doc.getText();

    const range = findConfigObjectRange(doc, content, existingName);
    if (!range) {
        vscode.window.showErrorMessage(`AL Pocket Tools: Could not locate "${existingName}" in launch.json.`);
        return;
    }

    const indentUnit = detectIndentUnit(content);
    const configIndent = doc.lineAt(range.start.line).text.match(/^([ \t]*)/)?.[1] ?? '';
    const replacement = JSON.stringify(newConfig, null, indentUnit).split('\n').join('\n' + configIndent);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, replacement);
    await vscode.workspace.applyEdit(edit);
}

export async function pasteLaunchConfig(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const saved = getSavedConfigs();
    if (saved.length === 0) {
        vscode.window.showInformationMessage(
            'AL Pocket Tools: No saved launch configurations. Right-click inside a configuration in launch.json and select "Save Launch Configuration".'
        );
        return;
    }

    const picked = await vscode.window.showQuickPick(
        saved.map(c => ({ label: configLabel(c), description: configDescription(c), config: c })),
        { title: 'Paste Launch Configuration', placeHolder: 'Select a saved configuration to insert', matchOnDescription: true }
    );
    if (!picked) { return; }

    const parsed = parseLaunchJson(editor.document.getText());
    if (!parsed) {
        vscode.window.showErrorMessage('AL Pocket Tools: Could not parse launch.json — check for syntax errors.');
        return;
    }

    const name = typeof picked.config['name'] === 'string' ? picked.config['name'] : null;
    const hasConflict = name ? parsed.configurations.some(c => c['name'] === name) : false;

    if (hasConflict) {
        const answer = await vscode.window.showWarningMessage(
            `A configuration named "${name}" already exists in launch.json.`,
            'Append Anyway', 'Replace', 'Cancel'
        );
        if (!answer || answer === 'Cancel') { return; }
        if (answer === 'Replace') {
            await replaceConfigInDocument(editor, name!, picked.config);
            vscode.window.showInformationMessage(`AL Pocket Tools: Replaced "${name}" in launch.json.`);
            return;
        }
    }

    await appendConfigToDocument(editor, picked.config);
    vscode.window.showInformationMessage(`AL Pocket Tools: Added "${name ?? 'configuration'}" to launch.json.`);
}

export async function saveLaunchConfig(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const content = editor.document.getText();
    const parsed = parseLaunchJson(content);
    if (!parsed) {
        vscode.window.showErrorMessage('AL Pocket Tools: Could not parse launch.json — check for syntax errors.');
        return;
    }

    if (parsed.configurations.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No configurations found in launch.json.');
        return;
    }

    const cursorConfig = findConfigAtCursor(editor.document, content, editor.selection.active, parsed.configurations);

    const items = parsed.configurations.map(c => ({
        label: configLabel(c),
        description: configDescription(c),
        detail: c === cursorConfig ? '← cursor is here' : undefined,
        config: c,
    }));

    if (cursorConfig) {
        const idx = items.findIndex(item => item.config === cursorConfig);
        if (idx > 0) { items.unshift(...items.splice(idx, 1)); }
    }

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Save Launch Configuration to User Settings',
        placeHolder: 'Select a configuration to save',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) { return; }

    const cfg = vscode.workspace.getConfiguration('al-pocket-tools');
    const existing = cfg.get<LaunchConfig[]>(SETTING_KEY, []);
    const name = typeof picked.config['name'] === 'string' ? picked.config['name'] : null;
    const existingIdx = name ? existing.findIndex(c => c['name'] === name) : -1;

    if (existingIdx >= 0) {
        const answer = await vscode.window.showWarningMessage(
            `A saved configuration named "${name}" already exists in your user settings. Replace it?`,
            'Replace', 'Cancel'
        );
        if (answer !== 'Replace') { return; }
        const updated = [...existing];
        updated[existingIdx] = picked.config;
        await cfg.update(SETTING_KEY, updated, vscode.ConfigurationTarget.Global);
    } else {
        await cfg.update(SETTING_KEY, [...existing, picked.config], vscode.ConfigurationTarget.Global);
    }

    vscode.window.showInformationMessage(
        `AL Pocket Tools: Saved "${name ?? 'configuration'}" to user settings.`
    );
}
