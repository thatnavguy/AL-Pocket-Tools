import * as vscode from 'vscode';
import * as path from 'path';

type PragmaDirective = '#if' | '#elseif' | '#pragma warning disable' | '#pragma warning restore';

interface ParsedPragma {
    symbol: string;
    directive: PragmaDirective;
    line: number;
    rawText: string;
}

export class PragmaSymbolItem extends vscode.TreeItem {
    readonly kind = 'symbol' as const;

    constructor(
        public readonly symbol: string,
        public readonly fileItems: PragmaFileItem[],
        isActive: boolean,
        totalCount: number,
    ) {
        super(symbol, vscode.TreeItemCollapsibleState.Expanded);
        const isWarningCode = /^AL\d+$/i.test(symbol);

        if (isWarningCode) {
            this.description = `${totalCount} use${totalCount !== 1 ? 's' : ''}`;
            this.tooltip = new vscode.MarkdownString(`**${symbol}** (warning code)\n\nOccurrences: ${totalCount}`);
            this.iconPath = new vscode.ThemeIcon('warning');
        } else {
            this.description = isActive
                ? `ON · ${totalCount} use${totalCount !== 1 ? 's' : ''}`
                : `${totalCount} use${totalCount !== 1 ? 's' : ''}`;
            this.tooltip = new vscode.MarkdownString(
                `**${symbol}**\n\n` +
                `Status: ${isActive ? '✓ Defined (ON)' : 'Not defined (OFF)'}\n\n` +
                `Total occurrences: ${totalCount}`
            );
            this.iconPath = new vscode.ThemeIcon(
                'symbol-constant',
                isActive
                    ? new vscode.ThemeColor('testing.iconPassed')
                    : new vscode.ThemeColor('disabledForeground'),
            );
        }
        this.contextValue = 'pragmaSymbol';
    }
}

export class PragmaFileItem extends vscode.TreeItem {
    readonly kind = 'file' as const;

    constructor(
        public readonly uri: vscode.Uri,
        public readonly lineItems: PragmaLineItem[],
    ) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${lineItems.length} use${lineItems.length !== 1 ? 's' : ''}`;
        this.tooltip = uri.fsPath;
        this.resourceUri = uri;
        this.contextValue = 'pragmaFile';
    }
}

export class PragmaLineItem extends vscode.TreeItem {
    readonly kind = 'line' as const;

    constructor(
        uri: vscode.Uri,
        lineNumber: number,
        _directive: PragmaDirective,
        rawText: string,
    ) {
        super(`Line ${lineNumber + 1}`, vscode.TreeItemCollapsibleState.None);
        this.description = rawText.trim();
        this.tooltip = new vscode.MarkdownString(`\`\`\`al\n${rawText.trim()}\n\`\`\``);
        this.iconPath = new vscode.ThemeIcon('symbol-keyword');
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to Pragma',
            arguments: [uri, lineNumber],
        };
        this.contextValue = 'pragmaLine';
    }
}

export type PragmaTreeItem = PragmaSymbolItem | PragmaFileItem | PragmaLineItem;

function parsePragmas(text: string): ParsedPragma[] {
    const results: ParsedPragma[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // #if / #elseif SYMBOL [&& !OTHER ...]
        const ifMatch = line.match(/^\s*#(if|elseif)\s+(.+)$/i);
        if (ifMatch) {
            const directive = `#${ifMatch[1].toLowerCase()}` as PragmaDirective;
            const symbols = new Set<string>();
            for (const m of ifMatch[2].matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
                symbols.add(m[1].toUpperCase());
            }
            for (const symbol of symbols) {
                results.push({ symbol, directive, line: i, rawText: line });
            }
            continue;
        }

        // #pragma warning disable/restore AL0468[, AL0001, ...]
        const pragmaMatch = line.match(/^\s*#pragma\s+warning\s+(disable|restore)\s+(.+)$/i);
        if (pragmaMatch) {
            const directive = `#pragma warning ${pragmaMatch[1].toLowerCase()}` as PragmaDirective;
            for (const code of pragmaMatch[2].split(',')) {
                const trimmed = code.trim();
                if (trimmed) { results.push({ symbol: trimmed.toUpperCase(), directive, line: i, rawText: line }); }
            }
        }
    }

    return results;
}

async function readDefinedSymbols(): Promise<Set<string>> {
    const [appJson] = await vscode.workspace.findFiles('app.json', null, 1);
    if (!appJson) { return new Set(); }

    try {
        const raw = await vscode.workspace.fs.readFile(appJson);
        const json = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        const symbols = Array.isArray(json['preprocessorSymbols']) ? json['preprocessorSymbols'] as string[] : [];
        return new Set(symbols.map(s => String(s).toUpperCase()));
    } catch {
        return new Set();
    }
}

export class PragmaTreeProvider implements vscode.TreeDataProvider<PragmaTreeItem> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<PragmaTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly cache = new Map<string, ParsedPragma[]>();
    private roots: PragmaSymbolItem[] = [];
    private definedSymbols = new Set<string>();

    async scan(): Promise<void> {
        this.cache.clear();
        const files = await vscode.workspace.findFiles('**/*.al', '**/{.git,node_modules}/**');

        const openDocs = new Map<string, string>();
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'al') {
                openDocs.set(doc.uri.toString(), doc.getText());
            }
        }

        await Promise.all(files.map(async uri => {
            const uriStr = uri.toString();
            try {
                const text = openDocs.get(uriStr)
                    ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                const pragmas = parsePragmas(text);
                if (pragmas.length > 0) {
                    this.cache.set(uriStr, pragmas);
                }
            } catch {
                // ignore unreadable files
            }
        }));

        this.definedSymbols = await readDefinedSymbols();
        this.rebuild();
    }

    hasData(): boolean {
        return this.cache.size > 0;
    }

    private rebuild(): void {
        const symbolMap = new Map<string, Map<string, { uri: vscode.Uri; pragmas: ParsedPragma[] }>>();

        for (const [uriStr, pragmas] of this.cache) {
            const uri = vscode.Uri.parse(uriStr);
            for (const pragma of pragmas) {
                if (!symbolMap.has(pragma.symbol)) {
                    symbolMap.set(pragma.symbol, new Map());
                }
                const fileMap = symbolMap.get(pragma.symbol)!;
                if (!fileMap.has(uriStr)) {
                    fileMap.set(uriStr, { uri, pragmas: [] });
                }
                fileMap.get(uriStr)!.pragmas.push(pragma);
            }
        }

        this.roots = [...symbolMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([symbol, fileMap]) => {
                const fileItems = [...fileMap.values()]
                    .sort((a, b) => path.basename(a.uri.fsPath).localeCompare(path.basename(b.uri.fsPath)))
                    .map(({ uri, pragmas }) => {
                        const lineItems = pragmas
                            .sort((a, b) => a.line - b.line)
                            .map(p => new PragmaLineItem(uri, p.line, p.directive, p.rawText));
                        return new PragmaFileItem(uri, lineItems);
                    });
                const totalCount = fileItems.reduce((sum, f) => sum + f.lineItems.length, 0);
                const isActive = this.definedSymbols.has(symbol);
                return new PragmaSymbolItem(symbol, fileItems, isActive, totalCount);
            });

        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PragmaTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PragmaTreeItem): PragmaTreeItem[] {
        if (!element) { return this.roots; }
        if (element.kind === 'symbol') { return element.fileItems; }
        if (element.kind === 'file') { return element.lineItems; }
        return [];
    }
}
