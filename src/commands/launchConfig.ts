import * as vscode from 'vscode';

type LaunchConfig = Record<string, unknown>;

const SETTING_KEY = 'launch.configurations';

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripJsonComments(text: string): string {
    let result = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"') {
            // Copy string literal verbatim, respecting escapes.
            result += ch;
            i++;
            while (i < text.length) {
                result += text[i];
                if (text[i] === '\\' && i + 1 < text.length) {
                    i++;
                    result += text[i];
                } else if (text[i] === '"') {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        if (ch === '/' && next === '/') {
            // Skip until end of line, but keep the line ending.
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
                i++;
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            // Skip block comment.
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i += 2;
            continue;
        }

        result += ch;
        i++;
    }
    return result;
}

function parseLaunchJson(content: string): { configurations: LaunchConfig[]; error?: string } {
    try {
        const parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
        if (!Array.isArray(parsed['configurations'])) { return { configurations: [] }; }
        return { configurations: parsed['configurations'] as LaunchConfig[] };
    } catch (err) {
        return { configurations: [], error: err instanceof Error ? err.message : String(err) };
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

function findConfigurationsArrayRange(content: string): { start: number; end: number } | undefined {
    const arrayMatch = /"configurations"\s*:\s*\[/.exec(content);
    if (!arrayMatch) { return undefined; }

    const start = arrayMatch.index + arrayMatch[0].length;
    let depth = 1;
    let idx = start;
    while (idx < content.length && depth > 0) {
        if (content[idx] === '[') { depth++; }
        else if (content[idx] === ']') { depth--; }
        idx++;
    }
    if (depth !== 0) { return undefined; }

    return { start, end: idx - 1 };
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

    const indentUnit = detectIndentUnit(content);
    const arrayMatch = /"configurations"\s*:\s*\[/.exec(content);

    if (!arrayMatch) {
        // "configurations" key is missing — create it before the root closing brace
        const rootClosing = content.lastIndexOf('}');
        if (rootClosing === -1) {
            vscode.window.showErrorMessage('AL Pocket Tools: Could not parse launch.json — check for syntax errors.');
            return;
        }

        const rootIndent = indentUnit;
        const configIndent = rootIndent + indentUnit;
        const formatted = JSON.stringify(config, null, indentUnit);
        const indented = configIndent + formatted.split('\n').join('\n' + configIndent);

        const innerContent = stripJsonComments(content.slice(content.indexOf('{') + 1, rootClosing)).trim();
        const needsComma = innerContent.length > 0 && !innerContent.endsWith(',');

        const insertText = `${needsComma ? ',' : ''}\n${rootIndent}"configurations": [\n${indented}\n${rootIndent}]`;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, doc.positionAt(rootClosing), insertText);
        await vscode.workspace.applyEdit(edit);
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
    if (parsed?.error) {
        vscode.window.showErrorMessage(`AL Pocket Tools: Could not parse launch.json — ${parsed.error}`);
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

export async function clearAndPasteLaunchConfig(): Promise<void> {
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
        { title: 'Clear and Paste Launch Configuration', placeHolder: 'Select a saved configuration to replace all existing ones', matchOnDescription: true }
    );
    if (!picked) { return; }

    const doc = editor.document;
    const content = doc.getText();
    const parsed = parseLaunchJson(content);
    if (parsed.error) {
        vscode.window.showErrorMessage(`AL Pocket Tools: Could not parse launch.json — ${parsed.error}`);
        return;
    }

    const name = typeof picked.config['name'] === 'string' ? picked.config['name'] : 'configuration';
    const count = parsed.configurations.length;
    const answer = await vscode.window.showWarningMessage(
        count > 0
            ? `This will remove ${count} existing configuration${count === 1 ? '' : 's'} and insert "${name}".`
            : `This will insert "${name}" into the empty configurations array.`,
        'Clear and Paste', 'Cancel'
    );
    if (answer !== 'Clear and Paste') { return; }

    const arrayRange = findConfigurationsArrayRange(content);
    if (!arrayRange) {
        // No configurations array at all — append creates the key
        await appendConfigToDocument(editor, picked.config);
        vscode.window.showInformationMessage(`AL Pocket Tools: Added "${name}" to launch.json.`);
        return;
    }

    const indentUnit = detectIndentUnit(content);
    const parentIndent = doc.lineAt(doc.positionAt(arrayRange.start).line).text.match(/^([ \t]*)/)?.[1] ?? '';
    const configIndent = parentIndent + indentUnit;
    const indented = configIndent + JSON.stringify(picked.config, null, indentUnit).split('\n').join('\n' + configIndent);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(arrayRange.start), doc.positionAt(arrayRange.end)),
        `\n${indented}\n${parentIndent}`
    );
    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage(
        `AL Pocket Tools: Replaced ${count} configuration${count === 1 ? '' : 's'} with "${name}" in launch.json.`
    );
}

export async function clearLaunchConfigs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const content = editor.document.getText();
    const parsed = parseLaunchJson(content);
    if (parsed?.error) {
        vscode.window.showErrorMessage(`AL Pocket Tools: Could not parse launch.json — ${parsed.error}`);
        return;
    }

    if (parsed.configurations.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: The configurations array is already empty.');
        return;
    }

    const count = parsed.configurations.length;
    const answer = await vscode.window.showWarningMessage(
        `This will remove all ${count} configuration${count === 1 ? '' : 's'} from launch.json.`,
        'Clear', 'Cancel'
    );
    if (!answer || answer === 'Cancel') { return; }

    const arrayRange = findConfigurationsArrayRange(content);
    if (!arrayRange) {
        vscode.window.showErrorMessage('AL Pocket Tools: Could not find "configurations" array in launch.json.');
        return;
    }

    const doc = editor.document;
    const range = new vscode.Range(doc.positionAt(arrayRange.start), doc.positionAt(arrayRange.end));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, '');
    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage(
        `AL Pocket Tools: Cleared ${count} configuration${count === 1 ? '' : 's'} from launch.json.`
    );
}

export async function clearAllLaunchConfigsInWorkspace(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No workspace folder is open.');
        return;
    }

    interface ClearTarget {
        uri: vscode.Uri;
        document: vscode.TextDocument;
        count: number;
        range: { start: number; end: number };
    }
    const targets: ClearTarget[] = [];
    let parseFailures = 0;

    for (const folder of folders) {
        const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'launch.json');
        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(uri);
        } catch {
            continue; // no launch.json in this workspace folder
        }
        const content = document.getText();
        const parsed = parseLaunchJson(content);
        if (parsed.error) { parseFailures++; continue; }
        if (parsed.configurations.length === 0) { continue; }
        const range = findConfigurationsArrayRange(content);
        if (!range) { continue; }
        targets.push({ uri, document, count: parsed.configurations.length, range });
    }

    if (targets.length === 0) {
        vscode.window.showInformationMessage(
            parseFailures > 0
                ? 'AL Pocket Tools: No launch.json configurations to clear. Some files could not be parsed — check for syntax errors.'
                : 'AL Pocket Tools: No launch.json configurations found in this workspace.'
        );
        return;
    }

    const total = targets.reduce((sum, t) => sum + t.count, 0);
    const fileList = targets.map(t => vscode.workspace.asRelativePath(t.uri)).join(', ');
    const answer = await vscode.window.showWarningMessage(
        `This will remove ${total} configuration${total === 1 ? '' : 's'} from ${targets.length} launch.json file${targets.length === 1 ? '' : 's'} (${fileList}).`,
        { modal: true },
        'Clear All'
    );
    if (answer !== 'Clear All') { return; }

    const edit = new vscode.WorkspaceEdit();
    for (const target of targets) {
        edit.replace(
            target.uri,
            new vscode.Range(target.document.positionAt(target.range.start), target.document.positionAt(target.range.end)),
            ''
        );
    }
    await vscode.workspace.applyEdit(edit);
    await Promise.all(targets.map(t => t.document.save()));

    vscode.window.showInformationMessage(
        `AL Pocket Tools: Cleared ${total} configuration${total === 1 ? '' : 's'} from ${targets.length} launch.json file${targets.length === 1 ? '' : 's'}.`
    );
}

export async function saveLaunchConfig(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const content = editor.document.getText();
    const parsed = parseLaunchJson(content);
    if (parsed?.error) {
        vscode.window.showErrorMessage(`AL Pocket Tools: Could not parse launch.json — ${parsed.error}`);
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
