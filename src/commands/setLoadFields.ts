import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecordVariable {
    name: string;
    tableName: string;
    isVar: boolean;
    line: number;
}

interface ProcedureBlock {
    name: string;
    params: RecordVariable[];
    localVars: RecordVariable[];
    bodyStart: number; // line index of 'begin'
    bodyEnd: number;   // line index of 'end;'
    bodyText: string;
    fullText: string;
    startLine: number; // line index of the procedure keyword in the document
}

interface FieldAccess {
    fieldName: string;
    source: string; // e.g. "current procedure" or "ProcessOrder()"
}

// ---------------------------------------------------------------------------
// Known Record methods (should not be treated as field names)
// ---------------------------------------------------------------------------

const RECORD_METHODS = new Set([
    'get', 'find', 'findfirst', 'findlast', 'findset', 'next',
    'insert', 'modify', 'delete', 'modifyall', 'deleteall',
    'setrange', 'setfilter', 'setcurrentkey', 'setloadfields', 'addloadfields',
    'reset', 'init', 'copy', 'transferfields',
    'calcfields', 'calcsums', 'fieldno', 'fieldname',
    'count', 'countapprox', 'isempty', 'istemporary',
    'locktable', 'readisolation',
    'mark', 'markedonly', 'clearmarks',
    'ascending', 'setascending',
    'hasfilter', 'getfilters', 'getrangemin', 'getrangemax',
    'consistent', 'rename', 'setrecfilter', 'setpermissionfilter',
    'filtergroup', 'currentcompany', 'changecompany',
    'recordid', 'getposition', 'setposition',
    'tablename', 'tablecaption', 'fieldexist',
    'validate', 'testfield', 'calcfields',
    'currentkey', 'getview', 'setview', 'copyfilters', 'copylinks',
    'addlink', 'deletelink', 'deletelinks', 'haslinks',
    'writeperms', 'readperms', 'securityfiltering',
    'relation', 'fieldactive', 'fieldcount',
]);

// Methods whose first parameter is a field name we should collect
const FIELD_PARAM_METHODS = new Set([
    'validate', 'testfield', 'calcfields', 'calcsums',
]);

// Filter methods whose field parameters are auto-loaded (skip)
const FILTER_METHODS = new Set([
    'setrange', 'setfilter', 'setcurrentkey',
]);

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const RECORD_VAR_REGEX = /^\s*(\w+)\s*:\s*Record\s+"?([^";]+)"?\s*(temporary\s*)?;/i;

function parseGlobalRecordVars(text: string): RecordVariable[] {
    const results: RecordVariable[] = [];
    const lines = text.split('\n');

    // Find global var sections: they appear outside of procedures/triggers,
    // typically after the object declaration line and before or between procedures.
    // Strategy: find all var sections that are NOT inside a procedure/trigger.
    const procBoundaries = findProcTriggerBoundaries(lines);

    let inGlobalVar = false;
    for (let i = 0; i < lines.length; i++) {
        // Skip lines inside procedures/triggers
        if (isInsideProcedure(i, procBoundaries)) {
            inGlobalVar = false;
            continue;
        }

        const trimmed = lines[i].trim().toLowerCase();

        // Detect start of a global var section
        if (trimmed === 'var') {
            inGlobalVar = true;
            continue;
        }

        // A non-var section keyword ends the var block
        if (/^(procedure|local|internal|trigger|protected)\b/i.test(trimmed) || trimmed === 'begin' || trimmed === '}') {
            inGlobalVar = false;
            continue;
        }

        if (inGlobalVar) {
            const varMatch = RECORD_VAR_REGEX.exec(lines[i]);
            if (varMatch) {
                results.push({
                    name: varMatch[1],
                    tableName: varMatch[2].replace(/"/g, '').trim(),
                    isVar: false,
                    line: i,
                });
            }
        }
    }

    return results;
}

interface ProcBoundary { start: number; end: number }

function findProcTriggerBoundaries(lines: string[]): ProcBoundary[] {
    const boundaries: ProcBoundary[] = [];
    const procStartRegex = /^(\s*)(local\s+|internal\s+|protected\s+)?(procedure|trigger)\s+/i;

    for (let i = 0; i < lines.length; i++) {
        if (!procStartRegex.test(lines[i])) { continue; }

        const startLine = i;
        // Find 'begin'
        let bodyStartLine = -1;
        for (let j = i + 1; j < lines.length; j++) {
            const trimmed = lines[j].trim().toLowerCase();
            if (trimmed === 'begin' || trimmed.startsWith('begin')) {
                bodyStartLine = j;
                break;
            }
            // If we hit another procedure/trigger before finding begin, skip
            if (procStartRegex.test(lines[j])) { break; }
        }
        if (bodyStartLine === -1) { continue; }

        // Find matching end
        let depth = 1;
        let bodyEndLine = -1;
        for (let j = bodyStartLine + 1; j < lines.length; j++) {
            const trimmed = lines[j].trim().toLowerCase();
            if (/\bbegin\b/i.test(trimmed) && !isInsideString(lines[j], lines[j].toLowerCase().indexOf('begin'))) {
                depth++;
            }
            if (/\bend\b/i.test(trimmed)) {
                depth--;
                if (depth === 0) {
                    bodyEndLine = j;
                    break;
                }
            }
        }

        if (bodyEndLine !== -1) {
            boundaries.push({ start: startLine, end: bodyEndLine });
            i = bodyEndLine; // skip past this procedure
        }
    }

    return boundaries;
}

function isInsideProcedure(line: number, boundaries: ProcBoundary[]): boolean {
    return boundaries.some(b => line >= b.start && line <= b.end);
}

function parseProcedures(text: string): ProcedureBlock[] {
    const lines = text.split('\n');
    const procedures: ProcedureBlock[] = [];

    // Match procedure/trigger declarations
    const procStartRegex = /^(\s*)(local\s+|internal\s+|protected\s+)?(procedure|trigger)\s+(\w+|"[^"]+")\s*\(?/i;

    for (let i = 0; i < lines.length; i++) {
        const match = procStartRegex.exec(lines[i]);
        if (!match) { continue; }

        const procName = match[4].replace(/^"|"$/g, '');
        const procStartLine = i;
        const isTrigger = match[3].toLowerCase() === 'trigger';

        // Collect the full signature (may span multiple lines until we find the closing paren)
        let sigText = lines[i];
        let sigEndLine = i;

        // Only parse parens if the line has an opening paren (triggers may not)
        if (sigText.includes('(')) {
            let parenDepth = (sigText.match(/\(/g) || []).length - (sigText.match(/\)/g) || []).length;

            while (parenDepth > 0 && sigEndLine < lines.length - 1) {
                sigEndLine++;
                sigText += '\n' + lines[sigEndLine];
                parenDepth += (lines[sigEndLine].match(/\(/g) || []).length;
                parenDepth -= (lines[sigEndLine].match(/\)/g) || []).length;
            }
        }

        // Parse parameters from signature (triggers typically have none)
        const params = isTrigger ? [] : parseRecordParams(sigText);

        // Find var section and begin
        let localVars: RecordVariable[] = [];
        let bodyStartLine = -1;
        let inVarSection = false;

        for (let j = sigEndLine + 1; j < lines.length; j++) {
            const trimmed = lines[j].trim().toLowerCase();
            if (trimmed === 'var') {
                inVarSection = true;
                continue;
            }
            if (trimmed === 'begin') {
                bodyStartLine = j;
                break;
            }
            if (inVarSection) {
                const varMatch = RECORD_VAR_REGEX.exec(lines[j]);
                if (varMatch) {
                    localVars.push({
                        name: varMatch[1],
                        tableName: varMatch[2].replace(/"/g, ''),
                        isVar: false,
                        line: j,
                    });
                }
            }
        }

        if (bodyStartLine === -1) { continue; }

        // Find matching end; by tracking begin/end depth
        let depth = 1;
        let bodyEndLine = -1;
        for (let j = bodyStartLine + 1; j < lines.length; j++) {
            const trimmed = lines[j].trim().toLowerCase();
            // Count begin keywords (but not 'begin' inside strings)
            if (/\bbegin\b/i.test(trimmed) && !isInsideString(lines[j], lines[j].toLowerCase().indexOf('begin'))) {
                depth++;
            }
            if (/\bend\b/i.test(trimmed)) {
                depth--;
                if (depth === 0) {
                    bodyEndLine = j;
                    break;
                }
            }
        }

        if (bodyEndLine === -1) { continue; }

        const bodyLines = lines.slice(bodyStartLine + 1, bodyEndLine);
        const fullLines = lines.slice(procStartLine, bodyEndLine + 1);

        procedures.push({
            name: procName,
            params,
            localVars,
            bodyStart: bodyStartLine,
            bodyEnd: bodyEndLine,
            bodyText: bodyLines.join('\n'),
            fullText: fullLines.join('\n'),
            startLine: procStartLine,
        });
    }

    return procedures;
}

function parseRecordParams(signature: string): RecordVariable[] {
    const results: RecordVariable[] = [];
    // Extract content between outermost parens
    const openIdx = signature.indexOf('(');
    const closeIdx = signature.lastIndexOf(')');
    if (openIdx === -1 || closeIdx === -1) { return results; }

    const paramSection = signature.slice(openIdx + 1, closeIdx);
    // Split by ';' for parameters
    const paramParts = paramSection.split(';');

    for (const part of paramParts) {
        const trimmed = part.trim();
        const recMatch = /^(var\s+)?(\w+)\s*:\s*Record\s+"?([^";]+)"?/i.exec(trimmed);
        if (recMatch) {
            results.push({
                name: recMatch[2],
                tableName: recMatch[3].replace(/"/g, '').trim(),
                isVar: !!recMatch[1],
                line: 0,
            });
        }
    }

    return results;
}

function isInsideString(line: string, pos: number): boolean {
    let inString = false;
    for (let i = 0; i < pos; i++) {
        if (line[i] === '\'') { inString = !inString; }
    }
    return inString;
}

// ---------------------------------------------------------------------------
// Field access detection
// ---------------------------------------------------------------------------

function findFieldAccesses(bodyText: string, varName: string): string[] {
    const fields = new Set<string>();
    const escaped = escapeRegExp(varName);

    // Pattern 1: RecordVar."Quoted Field Name"
    const quotedRegex = new RegExp(`\\b${escaped}\\s*\\.\\s*"([^"]+)"`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = quotedRegex.exec(bodyText)) !== null) {
        // Skip enum option references: Record."Field"::EnumOption — not a field read
        const afterMatch = bodyText.slice(m.index + m[0].length).trimStart();
        if (afterMatch.startsWith('::')) { continue; }
        fields.add(m[1]);
    }

    // Pattern 2: RecordVar.UnquotedField (not followed by '(' — to exclude method calls)
    const unquotedRegex = new RegExp(`\\b${escaped}\\s*\\.\\s*([A-Za-z_]\\w*)\\b`, 'gi');
    while ((m = unquotedRegex.exec(bodyText)) !== null) {
        const name = m[1];
        if (RECORD_METHODS.has(name.toLowerCase())) { continue; }
        // Check if followed by '(' — then it's likely a method call (custom trigger, etc.)
        const afterMatch = bodyText.slice(m.index + m[0].length).trimStart();
        if (afterMatch.startsWith('(')) { continue; }
        fields.add(name);
    }

    // Pattern 3: RecordVar.Validate("Field", ...) / TestField("Field") / CalcFields("Field")
    const methodFieldRegex = new RegExp(
        `\\b${escaped}\\s*\\.\\s*(Validate|TestField|CalcFields|CalcSums)\\s*\\(\\s*"([^"]+)"`,
        'gi'
    );
    while ((m = methodFieldRegex.exec(bodyText)) !== null) {
        fields.add(m[2]);
    }

    return [...fields];
}

function findProcedureCalls(bodyText: string, varName: string, allProcedures: ProcedureBlock[]): { procName: string; paramIndex: number }[] {
    const calls: { procName: string; paramIndex: number }[] = [];
    const procNames = allProcedures.map(p => p.name);
    const escaped = escapeRegExp(varName);

    // Find all function calls in the body
    const callRegex = /\b(\w+)\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;

    while ((m = callRegex.exec(bodyText)) !== null) {
        const calledName = m[1];
        if (!procNames.includes(calledName)) { continue; }

        // Parse the arguments to find which position our variable is in
        const args = splitArgs(m[2]);
        for (let idx = 0; idx < args.length; idx++) {
            if (new RegExp(`^\\s*${escaped}\\s*$`, 'i').test(args[idx])) {
                calls.push({ procName: calledName, paramIndex: idx });
            }
        }
    }

    return calls;
}

function splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of argsStr) {
        if (ch === '(' || ch === '[') { depth++; }
        if (ch === ')' || ch === ']') { depth--; }
        if (ch === ',' && depth === 0) {
            args.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) { args.push(current); }
    return args;
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Retrieval call detection
// ---------------------------------------------------------------------------

const RETRIEVAL_PATTERN = /\b(Get|Find|FindFirst|FindLast|FindSet)\s*\(/i;

function findFirstRetrievalLine(bodyText: string, varName: string, bodyStartLine: number): number | null {
    const escaped = escapeRegExp(varName);
    const regex = new RegExp(`\\b${escaped}\\s*\\.\\s*(Get|Find|FindFirst|FindLast|FindSet)\\s*\\(`, 'i');
    const lines = bodyText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
            return bodyStartLine + 1 + i; // +1 because bodyText starts after 'begin' line
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Existing SetLoadFields detection and merging
// ---------------------------------------------------------------------------

interface ExistingSetLoadFields {
    line: number;
    fields: string[];
    fullMatch: string;
}

function findExistingSetLoadFields(text: string, varName: string, procBodyStart: number, procBodyEnd: number): ExistingSetLoadFields | null {
    const lines = text.split('\n');
    const escaped = escapeRegExp(varName);
    const regex = new RegExp(`^(\\s*)${escaped}\\.SetLoadFields\\((.*)\\);\\s*$`, 'i');

    for (let i = procBodyStart + 1; i < procBodyEnd; i++) {
        const m = regex.exec(lines[i]);
        if (m) {
            const fieldsStr = m[2];
            const fields = parseFieldList(fieldsStr);
            return { line: i, fields, fullMatch: lines[i] };
        }
    }

    // Handle multi-line SetLoadFields
    const multiLineRegex = new RegExp(`${escaped}\\.SetLoadFields\\(`, 'i');
    for (let i = procBodyStart + 1; i < procBodyEnd; i++) {
        if (multiLineRegex.test(lines[i])) {
            // Collect until we find the closing );
            let collected = lines[i];
            let endLine = i;
            while (!collected.includes(');') && endLine < procBodyEnd - 1) {
                endLine++;
                collected += '\n' + lines[endLine];
            }
            const innerMatch = /SetLoadFields\(([\s\S]*)\);/.exec(collected);
            if (innerMatch) {
                const fields = parseFieldList(innerMatch[1]);
                return { line: i, fields, fullMatch: collected };
            }
        }
    }

    return null;
}

function parseFieldList(fieldsStr: string): string[] {
    // Fields are comma-separated, possibly quoted: "Document Type", "No.", Status
    const fields: string[] = [];
    const regex = /"([^"]+)"|(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(fieldsStr)) !== null) {
        fields.push(m[1] || m[2]);
    }
    return fields;
}

function formatFieldList(fields: string[]): string {
    return fields.map(f => {
        // Quote fields that contain spaces or special chars
        if (/\s|\./.test(f)) {
            return `"${f}"`;
        }
        return `"${f}"`;
    }).join(', ');
}

// ---------------------------------------------------------------------------
// ReadIsolation detection
// ---------------------------------------------------------------------------

function findExistingReadIsolation(text: string, varName: string, procBodyStart: number, procBodyEnd: number): number | null {
    const lines = text.split('\n');
    const escaped = escapeRegExp(varName);
    const regex = new RegExp(`^\\s*${escaped}\\.ReadIsolation\\s*:=`, 'i');

    for (let i = procBodyStart + 1; i < procBodyEnd; i++) {
        if (regex.test(lines[i])) {
            return i;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function addSetLoadFields(): Promise<void> {
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
    const readIsolationSetting = config.get<string>('setLoadFields.readIsolation', 'ReadUncommitted');
    const addReadIsolation = readIsolationSetting !== 'None';

    const text = editor.document.getText();
    const cursorLine = editor.selection.active.line;
    const cursorLineText = editor.document.lineAt(cursorLine).text;

    const procedures = parseProcedures(text);
    if (procedures.length === 0) {
        vscode.window.showWarningMessage('No procedures found in this file.');
        return;
    }

    // Find which procedure the cursor is in
    const currentProc = procedures.find(p => cursorLine >= p.startLine && cursorLine <= p.bodyEnd);
    if (!currentProc) {
        vscode.window.showWarningMessage('Place your cursor inside a procedure or trigger.');
        return;
    }

    // Gather all record variables available in this procedure (params + locals + globals)
    const globalVars = parseGlobalRecordVars(text);
    const allRecords = [...currentProc.params, ...currentProc.localVars, ...globalVars];
    if (allRecords.length === 0) {
        vscode.window.showWarningMessage('No Record variables found in this procedure.');
        return;
    }

    // Try to detect the record variable under/near the cursor
    let selectedRecord = detectRecordAtCursor(cursorLineText, allRecords);

    if (!selectedRecord) {
        // Fall back to quick pick
        if (allRecords.length === 1) {
            selectedRecord = allRecords[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                allRecords.map(r => ({
                    label: r.name,
                    description: `Record "${r.tableName}"${r.isVar ? ' (var)' : ''}`,
                    record: r,
                })),
                { placeHolder: 'Select a Record variable to add SetLoadFields for' }
            );
            if (!pick) { return; }
            selectedRecord = pick.record;
        }
    }

    // Collect fields from the current procedure
    const currentFields = findFieldAccesses(currentProc.bodyText, selectedRecord.name);

    // Collect fields from called procedures (one level deep)
    const deepFields: FieldAccess[] = [];
    const calls = findProcedureCalls(currentProc.bodyText, selectedRecord.name, procedures);

    for (const call of calls) {
        const calledProc = procedures.find(p => p.name === call.procName);
        if (!calledProc) { continue; }

        // Find the parameter at the matching index in the called procedure
        const allCalledParams = calledProc.params;
        if (call.paramIndex >= allCalledParams.length) { continue; }

        const paramInCalled = allCalledParams[call.paramIndex];
        if (!paramInCalled || paramInCalled.tableName.toLowerCase() !== selectedRecord.tableName.toLowerCase()) { continue; }

        // Collect fields from the called procedure's body
        const calledFields = findFieldAccesses(calledProc.bodyText, paramInCalled.name);
        for (const f of calledFields) {
            deepFields.push({ fieldName: f, source: `${call.procName}()` });
        }
    }

    // Merge all fields (deduplicate)
    const allFields = new Set<string>();
    for (const f of currentFields) { allFields.add(f); }
    for (const f of deepFields) { allFields.add(f.fieldName); }

    if (allFields.size === 0) {
        vscode.window.showInformationMessage(`No field accesses found for ${selectedRecord.name}.`);
        return;
    }

    const sortedFields = [...allFields].sort((a, b) => a.localeCompare(b));

    // Check for existing SetLoadFields and ReadIsolation
    const existing = findExistingSetLoadFields(text, selectedRecord.name, currentProc.bodyStart, currentProc.bodyEnd);
    const existingReadIsolationLine = findExistingReadIsolation(text, selectedRecord.name, currentProc.bodyStart, currentProc.bodyEnd);

    if (existing) {
        // Merge: add new fields that aren't already in the existing call
        const existingSet = new Set(existing.fields.map(f => f.toLowerCase()));
        const newFields = sortedFields.filter(f => !existingSet.has(f.toLowerCase()));

        const mergedFields = [...existing.fields, ...newFields].sort((a, b) => a.localeCompare(b));
        const indent = getIndent(editor.document.lineAt(existing.line).text);
        const newLine = `${indent}${selectedRecord.name}.SetLoadFields(${formatFieldList(mergedFields)});`;
        const needsReadIsolation = addReadIsolation && existingReadIsolationLine === null;

        if (newFields.length === 0 && !needsReadIsolation) {
            vscode.window.showInformationMessage('SetLoadFields already contains all accessed fields.');
            return;
        }

        await editor.edit(editBuilder => {
            editBuilder.replace(editor.document.lineAt(existing.line).range, newLine);
            if (needsReadIsolation) {
                const pos = new vscode.Position(existing.line + 1, 0);
                editBuilder.insert(pos, `${indent}${selectedRecord.name}.ReadIsolation := IsolationLevel::${readIsolationSetting};\n`);
            }
        });

        const parts: string[] = [];
        if (newFields.length > 0) { parts.push(`Added ${newFields.length} field(s): ${newFields.join(', ')}`); }
        if (needsReadIsolation) { parts.push(`Added ReadIsolation := IsolationLevel::${readIsolationSetting}`); }
        vscode.window.showInformationMessage(parts.join('. '));
    } else {
        // Insert before the first retrieval call
        const retrievalLine = findFirstRetrievalLine(currentProc.bodyText, selectedRecord.name, currentProc.bodyStart);

        if (!retrievalLine) {
            vscode.window.showWarningMessage(
                `No Get/Find call found for ${selectedRecord.name}. SetLoadFields copied to clipboard.`
            );
            const snippet = `${selectedRecord.name}.SetLoadFields(${formatFieldList(sortedFields)});`;
            await vscode.env.clipboard.writeText(snippet);
            return;
        }

        // Determine indent from the retrieval line
        const indent = getIndent(editor.document.lineAt(retrievalLine).text);
        let insertText = `${indent}${selectedRecord.name}.SetLoadFields(${formatFieldList(sortedFields)});\n`;
        if (addReadIsolation && existingReadIsolationLine === null) {
            insertText += `${indent}${selectedRecord.name}.ReadIsolation := IsolationLevel::${readIsolationSetting};\n`;
        }

        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(retrievalLine, 0), insertText);
        });

        const deepSources = [...new Set(deepFields.map(f => f.source))];
        let msg = `Added SetLoadFields with ${allFields.size} field(s).`;
        if (addReadIsolation && existingReadIsolationLine === null) {
            msg += ` Added ReadIsolation := IsolationLevel::${readIsolationSetting}.`;
        }
        if (deepSources.length > 0) {
            msg += ` Includes fields from: ${deepSources.join(', ')}`;
        }
        vscode.window.showInformationMessage(msg);
    }
}

// ---------------------------------------------------------------------------
// Cursor detection
// ---------------------------------------------------------------------------

function detectRecordAtCursor(lineText: string, records: RecordVariable[]): RecordVariable | undefined {
    for (const rec of records) {
        // Check if the variable name appears on the current line
        const regex = new RegExp(`\\b${escapeRegExp(rec.name)}\\b`, 'i');
        if (regex.test(lineText)) {
            return rec;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getIndent(line: string): string {
    const match = /^(\s*)/.exec(line);
    return match ? match[1] : '';
}
