import * as vscode from 'vscode';

const OBJECT_DECLARATION_REGEX = /^\s*(codeunit|table|tableextension|page|pageextension|report|query|xmlport|enum|enumextension|permissionset|profile|interface|controladdin)\s+\d*\s*"?([^"\r\n]+?)"?\s*$/im;

const OBJECT_TYPE_NAMES: Record<string, string> = {
    codeunit: 'Codeunit',
    table: 'Table',
    tableextension: 'TableExtension',
    page: 'Page',
    pageextension: 'PageExtension',
    report: 'Report',
    query: 'Query',
    xmlport: 'XmlPort',
    enum: 'Enum',
    enumextension: 'EnumExtension',
    permissionset: 'PermissionSet',
    profile: 'Profile',
    interface: 'Interface',
    controladdin: 'ControlAddIn',
};

const OBJECT_REFERENCE_NAMES: Record<string, string> = {
    ...OBJECT_TYPE_NAMES,
    table: 'Database',
    tableextension: 'Database',
};

interface IntegrationEventInfo {
    startLine: number;
    endLine: number;
    attributeArgs: string;
    procedureName: string;
    procedureRest: string;
}

export async function convertIntegrationEventToSubscriber(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const document = editor.document;
    const selection = editor.selection;
    const eventInfo = findIntegrationEvent(document, selection);
    if (!eventInfo) {
        vscode.window.showWarningMessage('Place the cursor inside an [IntegrationEvent(...)] procedure declaration, or on a call to one, in this file.');
        return;
    }

    const objectRef = findEnclosingObject(document, eventInfo.startLine);
    if (!objectRef) {
        vscode.window.showWarningMessage('Could not determine the enclosing object type/name for this file.');
        return;
    }

    const subscriberText = buildSubscriberText(document, eventInfo, objectRef);
    await vscode.env.clipboard.writeText(subscriberText);
    vscode.window.showInformationMessage(`EventSubscriber for '${eventInfo.procedureName}' copied to clipboard.`);
}

function findIntegrationEvent(document: vscode.TextDocument, selection: vscode.Selection): IntegrationEventInfo | null {
    const cursorLine = selection.isEmpty ? selection.active.line : selection.start.line;

    let attributeLine = -1;
    for (let line = cursorLine; line >= 0; line--) {
        const text = document.lineAt(line).text;
        if (/^\s*\[IntegrationEvent\s*\(/i.test(text)) {
            attributeLine = line;
            break;
        }
        if (line < cursorLine && /^\s*(procedure|local procedure|internal procedure|end;)/i.test(text)) {
            break;
        }
    }

    if (attributeLine !== -1) {
        const eventInfo = readIntegrationEventAt(document, attributeLine);
        if (eventInfo) { return eventInfo; }
    }

    return findIntegrationEventByCallSite(document, cursorLine);
}

function readIntegrationEventAt(document: vscode.TextDocument, attributeLine: number): IntegrationEventInfo | null {
    const attributeMatch = /^\s*\[IntegrationEvent\s*\((.*)\)\]\s*$/i.exec(document.lineAt(attributeLine).text);
    if (!attributeMatch) { return null; }

    let procedureLine = -1;
    for (let line = attributeLine + 1; line < document.lineCount; line++) {
        const text = document.lineAt(line).text.trim();
        if (text.length === 0) { continue; }
        if (/^(local\s+|internal\s+)?procedure\s+/i.test(text)) {
            procedureLine = line;
        }
        break;
    }

    if (procedureLine === -1) { return null; }

    const procedureMatch = /^(\s*)((?:local\s+|internal\s+)?procedure\s+)([A-Za-z_][\w]*)(\s*\(.*)$/i.exec(document.lineAt(procedureLine).text);
    if (!procedureMatch) { return null; }

    const [, , procedureKeyword, procedureName, procedureRest] = procedureMatch;

    return {
        startLine: attributeLine,
        endLine: procedureLine,
        attributeArgs: attributeMatch[1],
        procedureName,
        procedureRest: `${procedureKeyword}${procedureName}${procedureRest}`,
    };
}

// Falls back to the call site (e.g. `OnRunTransformationRule(TextValue, RecordRef, Rec);`) when the
// cursor isn't on the event declaration itself, and looks up the matching declaration in this file.
function findIntegrationEventByCallSite(document: vscode.TextDocument, cursorLine: number): IntegrationEventInfo | null {
    const callMatch = /^\s*([A-Za-z_]\w*)\s*\(.*\)\s*;\s*$/.exec(document.lineAt(cursorLine).text);
    if (!callMatch) { return null; }

    const calledName = callMatch[1];
    const declarationRegex = new RegExp(`^(\\s*)((?:local\\s+|internal\\s+)?procedure\\s+)${calledName}(\\s*\\(.*)$`, 'i');

    for (let line = 0; line < document.lineCount; line++) {
        if (!declarationRegex.test(document.lineAt(line).text)) { continue; }

        for (let attributeLine = line - 1; attributeLine >= 0; attributeLine--) {
            const text = document.lineAt(attributeLine).text.trim();
            if (text.length === 0) { continue; }
            if (/^\[IntegrationEvent\s*\(/i.test(text)) {
                const eventInfo = readIntegrationEventAt(document, attributeLine);
                if (eventInfo) { return eventInfo; }
            }
            break;
        }
    }

    return null;
}

interface ObjectRef {
    objectType: string;
    objectReference: string;
    objectName: string;
}

function findEnclosingObject(document: vscode.TextDocument, fromLine: number): ObjectRef | null {
    for (let line = fromLine; line >= 0; line--) {
        const match = OBJECT_DECLARATION_REGEX.exec(document.lineAt(line).text);
        if (match) {
            const keyword = match[1].toLowerCase();
            return {
                objectType: OBJECT_TYPE_NAMES[keyword],
                objectReference: OBJECT_REFERENCE_NAMES[keyword],
                objectName: match[2],
            };
        }
    }
    return null;
}

function buildSubscriberText(
    document: vscode.TextDocument,
    eventInfo: IntegrationEventInfo,
    objectRef: ObjectRef
): string {
    const indentMatch = /^(\s*)/.exec(document.lineAt(eventInfo.startLine).text);
    const indent = indentMatch ? indentMatch[1] : '';

    const attributeArgs = eventInfo.attributeArgs.split(',').map(arg => arg.trim());
    const [deprecated = 'false', deprecatedInfo = 'false'] = attributeArgs;

    const subscriberAttribute =
        `${indent}[EventSubscriber(ObjectType::${objectRef.objectType}, ${objectRef.objectReference}::${quoteIdentifier(objectRef.objectName)}, ` +
        `${eventInfo.procedureName}, '', ${deprecated}, ${deprecatedInfo})]`;

    const subscriberProcedureName = `${sanitizeForIdentifier(objectRef.objectName)}_${eventInfo.procedureName}`;
    const subscriberProcedureLine = `${indent}${eventInfo.procedureRest.replace(eventInfo.procedureName, subscriberProcedureName)}`;

    const bodyLines: string[] = [];
    let line = eventInfo.endLine + 1;
    let depth = 1;
    while (line < document.lineCount && depth > 0) {
        const text = document.lineAt(line).text;
        bodyLines.push(text);
        if (/^\s*end;\s*$/i.test(text)) {
            depth--;
        }
        line++;
        if (depth === 0) { break; }
    }

    return [subscriberAttribute, subscriberProcedureLine, ...bodyLines].join('\n');
}

const PLAIN_IDENTIFIER_REGEX = /^[A-Za-z_]\w*$/;

function quoteIdentifier(name: string): string {
    return PLAIN_IDENTIFIER_REGEX.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function sanitizeForIdentifier(name: string): string {
    const sanitized = name.replace(/[^A-Za-z0-9_]/g, '');
    return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
