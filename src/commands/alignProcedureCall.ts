import * as vscode from 'vscode';

interface CallAlignmentInfo {
    startLine: number;
    endLine: number;
    prefix: string;
    args: string[];
    suffix: string;
    indent: string;
    isHorizontal: boolean;
}

export async function alignSelectedProcedureCall(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Select the procedure call lines first.');
        return;
    }

    const document = editor.document;
    const call = parseSelectedProcedureCall(document, selection);
    if (!call) {
        vscode.window.showWarningMessage('Selection must contain one complete procedure call expression.');
        return;
    }

    const formatted = call.isHorizontal ? toVerticalCall(call) : toHorizontalCall(call);
    await editor.edit(editBuilder => {
        editBuilder.replace(
            new vscode.Range(call.startLine, 0, call.endLine, document.lineAt(call.endLine).text.length),
            formatted
        );
    });
}

function parseSelectedProcedureCall(document: vscode.TextDocument, selection: vscode.Selection): CallAlignmentInfo | null {
    const startLine = selection.start.line;
    const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
        ? selection.end.line - 1
        : selection.end.line;

    if (endLine < startLine) { return null; }

    const lines: string[] = [];
    for (let line = startLine; line <= endLine; line++) {
        lines.push(document.lineAt(line).text);
    }

    const fullText = lines.join('\n');
    const trimmed = fullText.trim();
    if (trimmed.length === 0 || !trimmed.endsWith(';')) { return null; }
    if (/\b(if|elseif|while|for|foreach|repeat|until|case|with)\b/i.test(lines[0].trim())) { return null; }

    const callRange = findInnermostCall(fullText);
    if (!callRange) { return null; }

    const prefix = fullText.slice(0, callRange.openIdx + 1);
    const argumentSection = fullText.slice(callRange.openIdx + 1, callRange.closeIdx);
    const suffix = fullText.slice(callRange.closeIdx);
    const args = splitArguments(argumentSection);
    if (args.length === 0) { return null; }

    const indentMatch = /^(\s*)/.exec(lines[0]);
    const indent = indentMatch ? indentMatch[1] : '';

    return {
        startLine,
        endLine,
        prefix,
        args,
        suffix,
        indent,
        isHorizontal: startLine === endLine,
    };
}

function findInnermostCall(text: string): { calleeStart: number; openIdx: number; closeIdx: number } | null {
    const callRanges: { calleeStart: number; openIdx: number; closeIdx: number }[] = [];
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';

        if (ch === '\'') {
            if (inString && next === '\'') {
                i++;
                continue;
            }
            inString = !inString;
            continue;
        }

        if (inString || ch !== '(') { continue; }

        const calleeStart = findCalleeStart(text, i);
        if (calleeStart === -1) { continue; }

        const closeIdx = findMatchingParen(text, i);
        if (closeIdx === -1) { continue; }

        callRanges.push({ calleeStart, openIdx: i, closeIdx });
    }

    if (callRanges.length === 0) { return null; }
    return callRanges[callRanges.length - 1];
}

function findCalleeStart(text: string, openIdx: number): number {
    let i = openIdx - 1;
    while (i >= 0 && /\s/.test(text[i])) {
        i--;
    }
    if (i < 0) { return -1; }

    const validChars = /[\w."]/;
    let end = i;
    while (i >= 0 && validChars.test(text[i])) {
        i--;
    }

    const start = i + 1;
    if (start > end) { return -1; }

    const candidate = text.slice(start, end + 1);
    return /^(?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))*$/.test(candidate) ? start : -1;
}

function findMatchingParen(text: string, openIdx: number): number {
    let depth = 0;
    let inString = false;

    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';

        if (ch === '\'') {
            if (inString && next === '\'') {
                i++;
                continue;
            }
            inString = !inString;
            continue;
        }

        if (inString) { continue; }

        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function splitArguments(argumentSection: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;

    for (let i = 0; i < argumentSection.length; i++) {
        const ch = argumentSection[i];
        const next = i + 1 < argumentSection.length ? argumentSection[i + 1] : '';

        if (ch === '\'') {
            current += ch;
            if (inString && next === '\'') {
                current += next;
                i++;
                continue;
            }
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (ch === '(' || ch === '[' || ch === '{') {
                depth++;
            } else if (ch === ')' || ch === ']' || ch === '}') {
                depth--;
            } else if (ch === ',' && depth === 0) {
                const value = current.trim();
                if (value.length > 0) {
                    args.push(value);
                }
                current = '';
                continue;
            }
        }

        current += ch;
    }

    const value = current.trim();
    if (value.length > 0) {
        args.push(value);
    }

    return args;
}

function toVerticalCall(call: CallAlignmentInfo): string {
    const argumentIndent = call.indent + '    ';
    return [
        call.prefix.trimEnd(),
        ...call.args.map((arg, index) => {
            const isLast = index === call.args.length - 1;
            return `${argumentIndent}${arg}${isLast ? call.suffix : ','}`;
        }),
    ].join('\n');
}

function toHorizontalCall(call: CallAlignmentInfo): string {
    return `${call.prefix.trimEnd()}${call.args.join(', ')}${call.suffix}`;
}
