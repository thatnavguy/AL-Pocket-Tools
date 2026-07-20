import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExistingVar {
    line: number;
    name: string;
    isLabel: boolean;
    labelText?: string;
}

interface ProcedureInfo {
    headerLine: number;
    varLine: number | null; // line index of the 'var' keyword, if a var section already exists
    beginLine: number;      // line index of 'begin'
    indent: string;         // indentation of the procedure/trigger header
    existingVars: ExistingVar[];
}

const STOPWORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or', 'be',
]);

// Maps the supported functions to their conventional label suffix.
const FUNCTION_SUFFIXES: Record<string, string> = {
    error: 'Err',
    message: 'Msg',
    confirm: 'Qst',
    strsubstno: 'Lbl',
};

const SUPPORTED_FUNCTIONS = Object.keys(FUNCTION_SUFFIXES).join('|');

function getIndent(lineText: string): string {
    const match = /^(\s*)/.exec(lineText);
    return match ? match[1] : '';
}

// Splits an argument list on top-level commas, respecting nested parens/brackets and string literals.
function splitTopLevelArgs(source: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    let inString = false;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];

        if (inString) {
            current += ch;
            if (ch === '\'') {
                if (source[i + 1] === '\'') {
                    current += source[++i];
                } else {
                    inString = false;
                }
            }
            continue;
        }

        if (ch === '\'') { inString = true; current += ch; continue; }
        if (ch === '(' || ch === '[') { depth++; current += ch; continue; }
        if (ch === ')' || ch === ']') { depth--; current += ch; continue; }
        if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }

        current += ch;
    }

    if (current.trim().length > 0) { args.push(current.trim()); }
    return args;
}

// Generates a label name from the message text and function suffix, e.g. "Item No. %1 is not valid." + Err -> "ItemNoNotValidErr".
function generateLabelName(rawMessage: string, suffix: string, existingNames: Set<string>, reuseCheck: (name: string) => boolean): string {
    let text = rawMessage.replace(/''/g, '\'');
    text = text.replace(/%\d+/g, ' ');
    text = text.replace(/[^a-zA-Z0-9\s]/g, ' ');

    const words = text
        .split(/\s+/)
        .filter(w => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))
        .slice(0, 6)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    const base = (words.join('') || 'Message') + suffix;

    if (!existingNames.has(base) || reuseCheck(base)) {
        return base;
    }

    let counter = 2;
    while (existingNames.has(`${base}${counter}`) && !reuseCheck(`${base}${counter}`)) {
        counter++;
    }
    return `${base}${counter}`;
}

function findEnclosingProcedure(lines: string[], selectionLine: number): ProcedureInfo | null {
    const procRegex = /^(\s*)(local\s+|internal\s+|protected\s+)?(procedure|trigger)\s+/i;

    let headerLine = -1;
    for (let i = selectionLine; i >= 0; i--) {
        if (procRegex.test(lines[i])) { headerLine = i; break; }
    }
    if (headerLine === -1) { return null; }

    const indent = getIndent(lines[headerLine]);
    let varLine: number | null = null;
    let beginLine = -1;
    const existingVars: ExistingVar[] = [];

    for (let j = headerLine + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();

        if (/^begin\b/i.test(trimmed)) { beginLine = j; break; }
        if (/^var$/i.test(trimmed)) { varLine = j; continue; }

        if (varLine !== null && trimmed.length > 0) {
            const labelMatch = /^(\w+)\s*:\s*Label\s*'((?:[^']|'')*)'/i.exec(trimmed);
            if (labelMatch) {
                existingVars.push({ line: j, name: labelMatch[1], isLabel: true, labelText: labelMatch[2] });
            } else {
                const nameMatch = /^(\w+)\s*:/.exec(trimmed);
                if (nameMatch) { existingVars.push({ line: j, name: nameMatch[1], isLabel: false }); }
            }
        }
    }

    if (beginLine === -1) { return null; }

    return { headerLine, varLine, beginLine, indent, existingVars };
}

interface ParsedCall {
    functionName: string;
    rawMessage: string;
    args: string[];
    trailingSemicolon: string;
}

interface ProcedureCache {
    info: ProcedureInfo;
    labels: { name: string; labelText: string }[];
    pendingDeclText: string;
}

const CALL_REGEX = new RegExp(`^(${SUPPORTED_FUNCTIONS})\\s*\\(\\s*'((?:[^']|'')*)'\\s*(?:,([\\s\\S]*))?\\)\\s*(;?)\\s*$`, 'i');

function parseCall(text: string): ParsedCall | null {
    const callMatch = CALL_REGEX.exec(text.trim());
    if (!callMatch) { return null; }

    return {
        functionName: callMatch[1],
        rawMessage: callMatch[2],
        args: callMatch[3] ? splitTopLevelArgs(callMatch[3]) : [],
        trailingSemicolon: callMatch[4],
    };
}

// Builds the Comment property from %N placeholders mapped to argument expressions.
function buildComment(rawMessage: string, args: string[]): string | undefined {
    const placeholderIndices = new Set<number>();
    const placeholderRegex = /%(\d+)/g;
    let placeholderMatch: RegExpExecArray | null;
    while ((placeholderMatch = placeholderRegex.exec(rawMessage)) !== null) {
        placeholderIndices.add(parseInt(placeholderMatch[1], 10));
    }
    const commentParts = [...placeholderIndices]
        .sort((a, b) => a - b)
        .filter(idx => args[idx - 1] !== undefined)
        .map(idx => `%${idx} = ${args[idx - 1]}`);
    return commentParts.length > 0 ? `${commentParts.join(', ')}.` : undefined;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function convertTextToLabel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Select an Error(...), Message(...), Confirm(...), or StrSubstNo(...) call first.');
        return;
    }

    const document = editor.document;
    const lines = document.getText().split('\n');

    // Single-line selections are matched precisely against the selected substring
    // (the user may have selected just the call, not the whole line). Multi-line
    // selections are scanned line by line, skipping lines that aren't a full call.
    const isSingleLine = selection.start.line === selection.end.line;
    const matches: { range: vscode.Range; call: ParsedCall }[] = [];

    if (isSingleLine) {
        const call = parseCall(document.getText(selection));
        if (!call) {
            vscode.window.showErrorMessage('Selection is not a valid Error/Message/Confirm/StrSubstNo(\'...\', ...) call with a string literal message.');
            return;
        }
        matches.push({ range: selection, call });
    } else {
        for (let i = selection.start.line; i <= selection.end.line; i++) {
            const lineText = lines[i];
            const trimmed = lineText.trim();
            if (trimmed.length === 0) { continue; }

            const call = parseCall(trimmed);
            if (!call) { continue; }

            const startChar = getIndent(lineText).length;
            const endChar = lineText.trimEnd().length;
            matches.push({ range: new vscode.Range(i, startChar, i, endChar), call });
        }

        if (matches.length === 0) {
            vscode.window.showWarningMessage('No Error/Message/Confirm/StrSubstNo(...) calls found in the selection.');
            return;
        }
    }

    const procedureCaches = new Map<number, ProcedureCache>();
    const replacements: { range: vscode.Range; text: string }[] = [];
    let newCount = 0;
    let reusedCount = 0;
    const convertedNames: string[] = [];

    for (const { range, call } of matches) {
        const procInfo = findEnclosingProcedure(lines, range.start.line);
        if (!procInfo) {
            vscode.window.showErrorMessage('Could not find the enclosing procedure or trigger for this selection.');
            return;
        }

        let cache = procedureCaches.get(procInfo.headerLine);
        if (!cache) {
            cache = {
                info: procInfo,
                labels: procInfo.existingVars
                    .filter(v => v.isLabel && v.labelText !== undefined)
                    .map(v => ({ name: v.name, labelText: v.labelText as string })),
                pendingDeclText: '',
            };
            procedureCaches.set(procInfo.headerLine, cache);
        }

        const suffix = FUNCTION_SUFFIXES[call.functionName.toLowerCase()];
        const existingLabel = cache.labels.find(l => l.labelText === call.rawMessage);
        let labelName: string;

        if (existingLabel) {
            labelName = existingLabel.name;
            reusedCount++;
        } else {
            const existingNames = new Set(cache.labels.map(l => l.name));
            labelName = generateLabelName(call.rawMessage, suffix, existingNames, name => cache!.labels.some(l => l.name === name && l.labelText === call.rawMessage));

            const comment = buildComment(call.rawMessage, call.args);
            const declIndent = `${cache.info.indent}    `;
            const commentClause = comment ? `, Comment = '${comment}'` : '';
            const declText = `${declIndent}${labelName}: Label '${call.rawMessage}'${commentClause};\n`;
            cache.pendingDeclText += declText;
            cache.labels.push({ name: labelName, labelText: call.rawMessage });
            newCount++;
        }

        convertedNames.push(labelName);
        const newCallArgs = [labelName, ...call.args].join(', ');
        replacements.push({ range, text: `${call.functionName}(${newCallArgs})${call.trailingSemicolon}` });
    }

    await editor.edit(editBuilder => {
        for (const replacement of replacements) {
            editBuilder.replace(replacement.range, replacement.text);
        }

        for (const cache of procedureCaches.values()) {
            if (cache.pendingDeclText.length === 0) { continue; }

            if (cache.info.varLine !== null) {
                const existingVars = cache.info.existingVars;
                const insertLine = existingVars.length > 0
                    ? existingVars[existingVars.length - 1].line + 1
                    : cache.info.varLine + 1;
                editBuilder.insert(new vscode.Position(insertLine, 0), cache.pendingDeclText);
            } else {
                const varBlock = `${cache.info.indent}var\n${cache.pendingDeclText}`;
                editBuilder.insert(new vscode.Position(cache.info.beginLine, 0), varBlock);
            }
        }
    });

    if (matches.length === 1) {
        vscode.window.showInformationMessage(
            reusedCount > 0
                ? `Reused existing label '${convertedNames[0]}'.`
                : `Converted to label '${convertedNames[0]}'.`
        );
    } else {
        const details: string[] = [];
        if (newCount > 0) { details.push(`${newCount} new`); }
        if (reusedCount > 0) { details.push(`${reusedCount} reused`); }
        const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
        vscode.window.showInformationMessage(`Converted ${matches.length} call(s) to label(s)${suffix}.`);
    }
}
