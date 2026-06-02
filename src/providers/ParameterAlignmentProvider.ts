import * as vscode from 'vscode';

const PROC_DECL_REGEX = /^\s*(?:local\s+|internal\s+|protected\s+)*(?:procedure|trigger)\s+(?:\w+|"[^"]+")\s*\(/i;

interface SignatureInfo {
    startLine: number;
    endLine: number;
    prefix: string;
    params: string[];
    suffix: string;
    isHorizontal: boolean;
    indent: string;
}

export class ParameterAlignmentProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorRewrite];

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const sig = findProcedureSignature(document, range.start.line);
        if (!sig) { return []; }

        if (sig.isHorizontal) {
            return [createVerticalAction(document, sig, 'Expand parameters vertically')];
        }

        const actions: vscode.CodeAction[] = [];
        if (!isFirstLineClean(document.lineAt(sig.startLine).text)) {
            actions.push(createVerticalAction(document, sig, 'Normalize parameter alignment'));
        }
        actions.push(createCollapseAction(document, sig));
        return actions;
    }
}

export function registerParameterAlignmentProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'al' },
            new ParameterAlignmentProvider(),
            { providedCodeActionKinds: ParameterAlignmentProvider.providedCodeActionKinds }
        )
    );
}

function isFirstLineClean(line: string): boolean {
    return /\(\s*$/.test(line);
}

function findProcedureSignature(document: vscode.TextDocument, cursorLine: number): SignatureInfo | null {
    let startLine = -1;
    for (let i = cursorLine; i >= Math.max(0, cursorLine - 5); i--) {
        if (PROC_DECL_REGEX.test(document.lineAt(i).text)) {
            startLine = i;
            break;
        }
    }
    if (startLine === -1) { return null; }

    let depth = 0;
    let endLine = -1;
    let fullText = '';
    let foundOpen = false;

    for (let i = startLine; i < Math.min(document.lineCount, startLine + 20); i++) {
        const lineText = document.lineAt(i).text;
        fullText += (i > startLine ? '\n' : '') + lineText;

        for (const ch of lineText) {
            if (ch === '(') { depth++; foundOpen = true; }
            else if (ch === ')' && foundOpen) {
                depth--;
                if (depth === 0) { endLine = i; break; }
            }
        }
        if (endLine !== -1) { break; }
    }

    if (endLine === -1 || cursorLine > endLine) { return null; }

    return parseSignature(fullText, startLine, endLine);
}

function parseSignature(fullText: string, startLine: number, endLine: number): SignatureInfo | null {
    const openIdx = fullText.indexOf('(');
    if (openIdx === -1) { return null; }

    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < fullText.length; i++) {
        if (fullText[i] === '(') { depth++; }
        else if (fullText[i] === ')') {
            depth--;
            if (depth === 0) { closeIdx = i; break; }
        }
    }
    if (closeIdx === -1) { return null; }

    const prefix = fullText.slice(0, openIdx + 1);
    const paramSection = fullText.slice(openIdx + 1, closeIdx);
    const suffix = fullText.slice(closeIdx);

    const normalized = paramSection.replace(/\s+/g, ' ').trim();
    if (!normalized) { return null; }

    const params = normalized.split(';').map(p => p.trim()).filter(Boolean);
    if (params.length === 0) { return null; }

    const indentMatch = /^(\s*)/.exec(prefix);
    const indent = indentMatch ? indentMatch[1] : '';

    return { startLine, endLine, prefix, params, suffix, isHorizontal: startLine === endLine, indent };
}

function createVerticalAction(document: vscode.TextDocument, sig: SignatureInfo, label: string): vscode.CodeAction {
    const action = new vscode.CodeAction(label, vscode.CodeActionKind.RefactorRewrite);
    const paramIndent = sig.indent + '    ';
    const lines = [
        sig.prefix.trimEnd(),
        ...sig.params.map((p, i) => {
            const isLast = i === sig.params.length - 1;
            return `${paramIndent}${p}${isLast ? sig.suffix : ';'}`;
        }),
    ];
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(sig.startLine, 0, sig.endLine, document.lineAt(sig.endLine).text.length),
        lines.join('\n')
    );
    action.edit = edit;
    return action;
}

function createCollapseAction(document: vscode.TextDocument, sig: SignatureInfo): vscode.CodeAction {
    const action = new vscode.CodeAction('Collapse parameters to single line', vscode.CodeActionKind.RefactorRewrite);
    const newText = sig.prefix.trimEnd() + sig.params.join('; ') + sig.suffix;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(sig.startLine, 0, sig.endLine, document.lineAt(sig.endLine).text.length),
        newText
    );
    action.edit = edit;
    return action;
}
