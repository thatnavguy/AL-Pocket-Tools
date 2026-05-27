import * as vscode from 'vscode';

export type AssignmentKind = 'validate' | 'direct' | 'compound' | 'transferfields';

export interface AssignmentMatch {
    kind: AssignmentKind;
    lineNumber: number;
    lineText: string;
    fileUri: vscode.Uri;
}

const KIND_ICONS: Record<AssignmentKind, string> = {
    validate: 'symbol-event',
    direct: 'arrow-right',
    compound: 'symbol-operator',
    transferfields: 'package',
};

const KIND_GROUP_LABELS: Record<AssignmentKind, string> = {
    validate: 'Validate()',
    direct: 'Direct Assignment :=',
    compound: 'Compound Assignment +=  -=  *=  /=',
    transferfields: 'TransferFields()',
};

/** Top-level grouping node — one per assignment kind that has results. */
export class AssignmentKindGroupItem extends vscode.TreeItem {
    constructor(
        public readonly kind: AssignmentKind,
        public readonly fileItems: AssignmentFileItem[],
    ) {
        const total = fileItems.reduce((sum, f) => sum + f.matches.length, 0);
        super(KIND_GROUP_LABELS[kind], vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${total} match${total === 1 ? '' : 'es'}`;
        this.iconPath = new vscode.ThemeIcon(KIND_ICONS[kind]);
        this.contextValue = 'assignmentKindGroup';
    }
}

/** Second-level node — one per file within a kind group. */
export class AssignmentFileItem extends vscode.TreeItem {
    constructor(
        public readonly fileUri: vscode.Uri,
        public readonly matches: AssignmentMatchItem[],
    ) {
        super(
            vscode.workspace.asRelativePath(fileUri),
            vscode.TreeItemCollapsibleState.Expanded,
        );
        this.description = `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.tooltip = fileUri.fsPath;
        this.resourceUri = fileUri;
    }
}

/** Leaf node — individual assignment match. */
export class AssignmentMatchItem extends vscode.TreeItem {
    constructor(
        public readonly match: AssignmentMatch,
    ) {
        super(match.lineText.trim(), vscode.TreeItemCollapsibleState.None);

        this.description = match.kind === 'transferfields'
            ? `(bulk assign) line ${match.lineNumber + 1}`
            : `line ${match.lineNumber + 1}`;
        this.tooltip = `${match.lineText.trim()} — line ${match.lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon(KIND_ICONS[match.kind]);
        this.command = {
            command: 'al-pocket-tools.goToAssignment',
            title: 'Go to Assignment',
            arguments: [match.fileUri, match.lineNumber],
        };
    }
}

export type AssignmentTreeItem = AssignmentKindGroupItem | AssignmentFileItem | AssignmentMatchItem;

const KIND_ORDER: AssignmentKind[] = ['validate', 'direct', 'compound', 'transferfields'];

export class AssignmentTrackerProvider
    implements vscode.TreeDataProvider<AssignmentTreeItem> {

    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<AssignmentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private kindGroups: AssignmentKindGroupItem[] = [];
    private _lastFieldName: string | undefined = undefined;
    private _lastScope: 'workspace' | 'file' = 'workspace';
    private _scanning = false;

    get lastFieldName(): string | undefined { return this._lastFieldName; }
    get lastScope(): 'workspace' | 'file' { return this._lastScope; }
    get isScanning(): boolean { return this._scanning; }

    setResults(fieldName: string, scope: 'workspace' | 'file', groups: Map<string, AssignmentMatch[]>): void {
        this._lastFieldName = fieldName;
        this._lastScope = scope;
        this._scanning = false;

        // Collect all matches, then group by kind → file
        const byKind = new Map<AssignmentKind, Map<string, AssignmentMatch[]>>();
        for (const kind of KIND_ORDER) {
            byKind.set(kind, new Map());
        }

        for (const [uriString, matches] of groups) {
            for (const match of matches) {
                const kindMap = byKind.get(match.kind)!;
                if (!kindMap.has(uriString)) {
                    kindMap.set(uriString, []);
                }
                kindMap.get(uriString)!.push(match);
            }
        }

        this.kindGroups = [];
        for (const kind of KIND_ORDER) {
            const kindMap = byKind.get(kind)!;
            if (kindMap.size === 0) { continue; }

            const fileItems: AssignmentFileItem[] = [];
            for (const [uriString, matches] of kindMap) {
                const fileUri = vscode.Uri.parse(uriString);
                const matchItems = matches.map(m => new AssignmentMatchItem(m));
                fileItems.push(new AssignmentFileItem(fileUri, matchItems));
            }
            this.kindGroups.push(new AssignmentKindGroupItem(kind, fileItems));
        }

        this._onDidChangeTreeData.fire();
    }

    setScanning(scanning: boolean): void {
        this._scanning = scanning;
        if (scanning) {
            this._onDidChangeTreeData.fire();
        }
    }

    clear(): void {
        this._lastFieldName = undefined;
        this.kindGroups = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AssignmentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AssignmentTreeItem): AssignmentTreeItem[] {
        if (element instanceof AssignmentKindGroupItem) {
            return element.fileItems;
        }
        if (element instanceof AssignmentFileItem) {
            return element.matches;
        }
        return this.kindGroups;
    }
}
