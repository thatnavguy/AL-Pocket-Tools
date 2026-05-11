import * as vscode from 'vscode';

export class RegionItem extends vscode.TreeItem {
    constructor(
        public readonly regionName: string,
        public readonly lineNumber: number,
        public readonly children: RegionItem[],
        documentUri: vscode.Uri,
    ) {
        super(
            regionName,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );
        this.description = `line ${lineNumber + 1}`;
        this.tooltip = `${regionName} — line ${lineNumber + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Region',
            arguments: [documentUri, lineNumber],
        };
    }
}

function parseRegions(document: vscode.TextDocument): RegionItem[] {
    const stack: { name: string; line: number; children: RegionItem[] }[] = [];
    const roots: RegionItem[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text.trimStart();
        const regionMatch = text.match(/^#region\s+(.+)$/i);

        if (regionMatch) {
            stack.push({ name: regionMatch[1].trim(), line: i, children: [] });
        } else if (/^#endregion/i.test(text) && stack.length > 0) {
            const top = stack.pop()!;
            const item = new RegionItem(top.name, top.line, top.children, document.uri);
            if (stack.length > 0) {
                stack[stack.length - 1].children.push(item);
            } else {
                roots.push(item);
            }
        }
    }

    // Unclosed regions surface to the top in reverse stack order
    while (stack.length > 0) {
        const top = stack.pop()!;
        roots.unshift(new RegionItem(top.name, top.line, top.children, document.uri));
    }

    return roots;
}

export class RegionTreeProvider implements vscode.TreeDataProvider<RegionItem> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<RegionItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: RegionItem[] = [];

    refresh(document?: vscode.TextDocument): void {
        this.roots = document?.languageId === 'al' ? parseRegions(document) : [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RegionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RegionItem): RegionItem[] {
        return element ? element.children : this.roots;
    }
}
