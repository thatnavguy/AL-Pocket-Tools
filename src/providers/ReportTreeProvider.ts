import * as vscode from 'vscode';

// ─── Node kinds ──────────────────────────────────────────────────────────────

export class ReportSectionItem extends vscode.TreeItem {
    readonly kind = 'section' as const;

    constructor(
        public readonly label: string,
        public readonly children: ReportTreeNode[],
        icon: string,
        lineNumber?: number,
        documentUri?: vscode.Uri,
    ) {
        super(
            label,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = 'reportSection';
        if (lineNumber !== undefined && documentUri !== undefined) {
            this.command = {
                command: 'al-pocket-tools.goToRegion',
                title: 'Go to Section',
                arguments: [documentUri, lineNumber],
            };
        }
    }
}

export class DataItemItem extends vscode.TreeItem {
    readonly kind = 'dataitem' as const;

    constructor(
        public readonly name: string,
        public readonly tableName: string,
        public readonly lineNumber: number,
        public readonly children: (DataItemItem | TriggerItem)[],
        documentUri: vscode.Uri,
    ) {
        super(
            name,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        this.description = tableName;
        this.tooltip = `${name} (${tableName}) — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('table');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to DataItem',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportDataItem';
    }
}

export class TriggerItem extends vscode.TreeItem {
    readonly kind = 'trigger' as const;

    constructor(
        public readonly name: string,
        public readonly lineNumber: number,
        documentUri: vscode.Uri,
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = `line ${lineNumber + 1}`;
        this.tooltip = `${name} — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('zap');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Trigger',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportTrigger';
    }
}

export class LayoutItem extends vscode.TreeItem {
    readonly kind = 'layout' as const;

    constructor(
        public readonly name: string,
        public readonly layoutType: string,
        public readonly lineNumber: number,
        documentUri: vscode.Uri,
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = layoutType;
        this.tooltip = `${name} (${layoutType}) — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('file');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Layout',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportLayout';
    }
}

export class VarItem extends vscode.TreeItem {
    readonly kind = 'var' as const;

    constructor(
        public readonly varName: string,
        public readonly typeName: string,
        public readonly lineNumber: number,
        documentUri: vscode.Uri,
    ) {
        super(varName, vscode.TreeItemCollapsibleState.None);
        this.description = typeName;
        this.tooltip = `${varName}: ${typeName} — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-variable');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Variable',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportVar';
    }
}

export class ProcedureItem extends vscode.TreeItem {
    readonly kind = 'procedure' as const;

    constructor(
        public readonly name: string,
        public readonly visibility: string,
        public readonly lineNumber: number,
        documentUri: vscode.Uri,
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = visibility !== 'public' ? visibility : undefined;
        this.tooltip = `${visibility !== 'public' ? visibility + ' ' : ''}procedure ${name} — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-method');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Procedure',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportProcedure';
    }
}

export class LabelItem extends vscode.TreeItem {
    readonly kind = 'label' as const;

    constructor(
        public readonly labelName: string,
        public readonly labelText: string,
        public readonly lineNumber: number,
        documentUri: vscode.Uri,
    ) {
        super(labelName, vscode.TreeItemCollapsibleState.None);
        this.description = labelText;
        this.tooltip = `${labelName}: ${labelText} — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-string');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Label',
            arguments: [documentUri, lineNumber],
        };
        this.contextValue = 'reportLabel';
    }
}

export type ReportTreeNode =
    | ReportSectionItem
    | DataItemItem
    | TriggerItem
    | LayoutItem
    | VarItem
    | ProcedureItem
    | LabelItem;

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parses dataitems and their direct triggers within a block starting at
 * `openBraceLine` (the line containing the opening `{`). Uses relative brace
 * depth so nested blocks are handled naturally.
 */
function parseDataItems(
    lines: string[],
    openBraceLine: number,
    uri: vscode.Uri,
): (DataItemItem | TriggerItem)[] {
    const results: (DataItemItem | TriggerItem)[] = [];
    let depth = 0;
    let i = openBraceLine + 1;

    while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trimStart();

        // Track brace depth
        const opens = (raw.match(/\{/g) ?? []).length;
        const closes = (raw.match(/\}/g) ?? []).length;

        // At depth 0 before any brace changes on this line, check for keywords
        if (depth === 0) {
            // Closing brace at depth 0 — we are done with this block
            if (trimmed.startsWith('}')) {
                break;
            }

            const dataItemMatch = trimmed.match(/^dataitem\s*\(\s*"?([^"\;)]+)"?\s*;\s*"?([^"\;)]+)"?\s*\)/i);
            if (dataItemMatch) {
                const name = dataItemMatch[1].trim();
                const tableName = dataItemMatch[2].trim();
                // Find the opening brace for this dataitem (may be same line or next)
                let braceStart = i;
                if (!raw.includes('{')) {
                    while (braceStart < lines.length && !lines[braceStart].includes('{')) {
                        braceStart++;
                    }
                }
                const children = parseDataItems(lines, braceStart, uri);
                results.push(new DataItemItem(name, tableName, i, children, uri));
                // Skip past the closing brace of this dataitem
                i = findClosingBrace(lines, braceStart) + 1;
                continue;
            }

            const triggerMatch = trimmed.match(/^trigger\s+(\w+)\s*\(/i);
            if (triggerMatch) {
                results.push(new TriggerItem(triggerMatch[1], i, uri));
            }
        }

        depth += opens - closes;
        i++;
    }

    return results;
}

/**
 * Returns the line index of the `}` that closes the block opened at
 * `openBraceLine`. The opening `{` may appear anywhere on that line.
 */
function findClosingBrace(lines: string[], openBraceLine: number): number {
    let depth = 0;
    for (let i = openBraceLine; i < lines.length; i++) {
        const raw = lines[i];
        depth += (raw.match(/\{/g) ?? []).length;
        depth -= (raw.match(/\}/g) ?? []).length;
        if (depth <= 0) {
            return i;
        }
    }
    return lines.length - 1;
}

/**
 * Parses an AL report document into section items, or returns null if the
 * document is not an AL report.
 */
export function parseReport(document: vscode.TextDocument, showVarDeclarations = false): ReportSectionItem[] | null {
    if (document.languageId !== 'al') {
        return null;
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // Quick check: first non-blank line must start with "report <number>"
    const firstContent = lines.find(l => l.trim().length > 0);
    if (!firstContent?.match(/^\s*report\s+\d+/i)) {
        return null;
    }

    const uri = document.uri;

    // ── State machine ────────────────────────────────────────────────────────
    const dataItems: (DataItemItem | TriggerItem)[] = [];
    let requestPageLine = -1;
    const layouts: LayoutItem[] = [];
    const labelItems: LabelItem[] = [];
    let labelsLine = -1;
    const reportTriggers: TriggerItem[] = [];
    const vars: VarItem[] = [];
    let varLine = -1;
    const procedures: ProcedureItem[] = [];

    let depth = 0; // overall brace depth (0 = before the report's own `{`)

    // Flags for deferred work
    let inVarSection = false; // true while collecting global var declarations

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trimStart();

        const opens = (raw.match(/\{/g) ?? []).length;
        const closes = (raw.match(/\}/g) ?? []).length;

        // ── At depth 1: direct children of the report object ────────────────
        if (depth === 1) {
            // Entering a new keyword section resets the var-collection flag
            if (/^\s*(dataset|requestpage|rendering|labels|trigger|procedure)\b/i.test(raw) ||
                /^\s*(local|internal|protected)\s+procedure\b/i.test(raw)) {
                inVarSection = false;
            }

            // dataset { ... }
            if (/^\s*dataset\s*\{?/i.test(raw)) {
                let braceStart = i;
                if (!raw.includes('{')) {
                    while (braceStart < lines.length && !lines[braceStart].includes('{')) {
                        braceStart++;
                    }
                }
                const children = parseDataItems(lines, braceStart, uri);
                dataItems.push(...children);
                i = findClosingBrace(lines, braceStart);
                depth = 1; // reset depth after jumping past the block
                continue;
            }

            // requestpage { ... }
            if (/^\s*requestpage\s*\{?/i.test(raw) && requestPageLine === -1) {
                requestPageLine = i;
                let braceStart = i;
                if (!raw.includes('{')) {
                    while (braceStart < lines.length && !lines[braceStart].includes('{')) {
                        braceStart++;
                    }
                }
                i = findClosingBrace(lines, braceStart);
                depth = 1;
                continue;
            }

            // rendering { ... }
            if (/^\s*rendering\s*\{?/i.test(raw)) {
                let braceStart = i;
                if (!raw.includes('{')) {
                    while (braceStart < lines.length && !lines[braceStart].includes('{')) {
                        braceStart++;
                    }
                }
                // Scan inside for layout(Name) entries
                let rDepth = 0;
                for (let j = braceStart; j < lines.length; j++) {
                    const rRaw = lines[j];
                    rDepth += (rRaw.match(/\{/g) ?? []).length;
                    rDepth -= (rRaw.match(/\}/g) ?? []).length;
                    if (rDepth <= 0) {
                        i = j;
                        break;
                    }
                    if (rDepth === 1) {
                        // At direct children of the rendering block
                        const layoutMatch = rRaw.trimStart().match(/^layout\s*\(\s*(\w+)\s*\)/i);
                        if (layoutMatch) {
                            // Look ahead for Type = RDLC/Word/Excel
                            let layoutType = '';
                            let lDepth = 0;
                            for (let k = j; k < lines.length; k++) {
                                lDepth += (lines[k].match(/\{/g) ?? []).length;
                                lDepth -= (lines[k].match(/\}/g) ?? []).length;
                                const typeMatch = lines[k].match(/^\s*Type\s*=\s*(\w+)\s*;/i);
                                if (typeMatch) {
                                    layoutType = typeMatch[1];
                                    break;
                                }
                                if (lDepth <= 0) { break; }
                            }
                            layouts.push(new LayoutItem(layoutMatch[1], layoutType, j, uri));
                        }
                    }
                }
                depth = 1;
                continue;
            }

            // labels { ... }
            if (/^\s*labels\s*\{?/i.test(raw)) {
                labelsLine = i;
                let braceStart = i;
                if (!raw.includes('{')) {
                    while (braceStart < lines.length && !lines[braceStart].includes('{')) {
                        braceStart++;
                    }
                }
                let lDepth = 0;
                for (let j = braceStart; j < lines.length; j++) {
                    lDepth += (lines[j].match(/\{/g) ?? []).length;
                    lDepth -= (lines[j].match(/\}/g) ?? []).length;
                    if (lDepth <= 0) { i = j; break; }
                    if (lDepth === 1) {
                        const labelMatch = lines[j].trimStart().match(/^(\w+)\s*:\s*(Label\s+'[^']*')/i);
                        if (labelMatch) {
                            labelItems.push(new LabelItem(labelMatch[1], labelMatch[2], j, uri));
                        }
                    }
                }
                depth = 1;
                continue;
            }

            // Report-level triggers (OnPreReport, OnInitReport, OnPostReport, etc.)
            const repTrigMatch = trimmed.match(/^trigger\s+(\w+)\s*\(/i);
            if (repTrigMatch) {
                reportTriggers.push(new TriggerItem(repTrigMatch[1], i, uri));
                // Skip past the begin...end; body
                let bDepth = 0;
                for (let j = i; j < lines.length; j++) {
                    const t = lines[j].trimStart();
                    if (/^begin\b/i.test(t)) { bDepth++; }
                    if (bDepth > 0 && /^end\s*;/i.test(t)) {
                        bDepth--;
                        if (bDepth <= 0) { i = j; break; }
                    }
                }
                depth = 1;
                continue;
            }

            // var section — "var" or "protected var" at depth 1
            if (/^\s*(protected\s+)?var\s*$/.test(raw)) {
                if (varLine === -1) { varLine = i; }
                inVarSection = true;
                // Don't break out — fall through to depth adjustment
            }

            // Collect var declarations
            if (inVarSection) {
                const varMatch = trimmed.match(/^(\w+)\s*:\s*(.+?)\s*;?\s*$/);
                if (varMatch && !/^(var|begin|end)$/i.test(varMatch[1])) {
                    const typeName = varMatch[2].replace(/;$/, '').trim();
                    vars.push(new VarItem(varMatch[1], typeName, i, uri));
                }
            }

            // procedure declarations
            const procMatch = trimmed.match(
                /^(local\s+|internal\s+|protected\s+)?procedure\s+(\w+)\s*\(/i,
            );
            if (procMatch) {
                inVarSection = false;
                const vis = procMatch[1]?.trim().toLowerCase() ?? 'public';
                procedures.push(new ProcedureItem(procMatch[2], vis, i, uri));
                // Skip past the procedure body
                let braceStart = i;
                if (!raw.includes('{')) {
                    // AL procedures use begin/end — find the matching begin/end
                    let bDepth = 0;
                    let inBody = false;
                    for (let j = i; j < lines.length; j++) {
                        const jRaw = lines[j].trimStart();
                        // Handle local var inside procedure
                        if (/^begin\b/i.test(jRaw)) { inBody = true; bDepth++; }
                        else if (inBody && /^end\s*;/i.test(jRaw)) {
                            bDepth--;
                            if (bDepth <= 0) { i = j; break; }
                        } else if (inBody && /^begin\b/i.test(jRaw)) {
                            bDepth++;
                        }
                    }
                } else {
                    i = findClosingBrace(lines, braceStart);
                }
                depth = 1;
                continue;
            }
        }

        depth += opens - closes;
    }

    // ── Build section items ──────────────────────────────────────────────────
    const sections: ReportSectionItem[] = [];

    if (dataItems.length > 0) {
        sections.push(new ReportSectionItem('dataset', dataItems, 'database'));
    }

    if (requestPageLine >= 0) {
        const rpNav = new DataItemItem('requestpage', '', requestPageLine, [], uri);
        // Override the description/icon for the requestpage nav node
        rpNav.description = undefined;
        rpNav.iconPath = new vscode.ThemeIcon('settings');
        rpNav.tooltip = `requestpage — line ${requestPageLine + 1}`;
        rpNav.contextValue = 'reportRequestPage';
        // Section with one child (the nav node)
        const rpSection = new ReportSectionItem('requestpage', [rpNav], 'settings');
        sections.push(rpSection);
    }

    if (layouts.length > 0) {
        sections.push(new ReportSectionItem('rendering', layouts, 'layout'));
    }

    if (labelsLine >= 0) {
        const labelsChildren: ReportTreeNode[] = [...labelItems];
        if (labelsChildren.length === 0) {
            // Empty block — show a nav node so the user can still navigate to it
            const lNav = new DataItemItem('labels', '', labelsLine, [], uri);
            lNav.description = undefined;
            lNav.iconPath = new vscode.ThemeIcon('tag');
            lNav.tooltip = `labels — line ${labelsLine + 1}`;
            lNav.contextValue = 'reportLabelsBlock';
            labelsChildren.push(lNav);
        }
        sections.push(new ReportSectionItem('labels', labelsChildren, 'tag'));
    }

    if (reportTriggers.length > 0) {
        sections.push(new ReportSectionItem('triggers', reportTriggers, 'zap'));
    }

    if (varLine >= 0) {
        if (showVarDeclarations && vars.length > 0) {
            sections.push(new ReportSectionItem('var', vars, 'symbol-variable', varLine, uri));
        } else {
            const varSection = new ReportSectionItem('var', [], 'symbol-variable', varLine, uri);
            varSection.description = `${vars.length} variable${vars.length !== 1 ? 's' : ''}`;
            sections.push(varSection);
        }
    }

    if (procedures.length > 0) {
        sections.push(new ReportSectionItem('procedures', procedures, 'symbol-method'));
    }

    return sections.length > 0 ? sections : [];
}

// ─── Tree provider ───────────────────────────────────────────────────────────

export class ReportTreeProvider implements vscode.TreeDataProvider<ReportTreeNode> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<ReportTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: ReportSectionItem[] = [];

    refresh(document?: vscode.TextDocument): void {
        if (!document) {
            this.roots = [];
        } else {
            const showVarDeclarations = vscode.workspace
                .getConfiguration('al-pocket-tools')
                .get<boolean>('reportViewer.showVarDeclarations', false);
            const result = parseReport(document, showVarDeclarations);
            this.roots = result ?? [];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ReportTreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ReportTreeNode): ReportTreeNode[] {
        if (!element) {
            return this.roots;
        }
        if (element.kind === 'section') {
            return element.children;
        }
        if (element.kind === 'dataitem') {
            return element.children;
        }
        return [];
    }
}
