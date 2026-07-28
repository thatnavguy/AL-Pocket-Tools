import * as vscode from 'vscode';
import * as path from 'path';

// ─── Model ───────────────────────────────────────────────────────────────────

type ApiObjectType = 'Page' | 'Query';

interface ParsedApi {
    objectType: ApiObjectType;
    objectId: string;
    objectName: string;
    publisher: string;
    group: string;
    version: string;
    entityName: string;
    entitySetName: string;
    line: number;
    uri: vscode.Uri;
}

// ─── Path building ───────────────────────────────────────────────────────────

const API_HOST = 'https://api.businesscentral.dynamics.com/v2.0';

function buildRelativePath(api: ParsedApi): string {
    const segments = ['api'];
    if (api.publisher) { segments.push(api.publisher); }
    if (api.group) { segments.push(api.group); }
    if (api.version) { segments.push(api.version); }
    segments.push('companies({companyId})');
    segments.push(api.entitySetName || api.entityName);
    return '/' + segments.join('/');
}

function buildFullUrl(api: ParsedApi): string {
    return `${API_HOST}/{tenantId}/{environment}${buildRelativePath(api)}`;
}

// ─── Tree items ──────────────────────────────────────────────────────────────

export class ApiGroupItem extends vscode.TreeItem {
    readonly kind = 'group' as const;

    constructor(
        public readonly label: string,
        public readonly entities: ApiEntityItem[],
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${entities.length} ${entities.length === 1 ? 'entity' : 'entities'}`;
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        this.contextValue = 'apiGroup';
    }
}

export class ApiEntityItem extends vscode.TreeItem {
    readonly kind = 'entity' as const;
    readonly relativePath: string;
    readonly fullUrl: string;

    constructor(public readonly api: ParsedApi) {
        super(api.entitySetName || api.entityName, vscode.TreeItemCollapsibleState.None);
        this.relativePath = buildRelativePath(api);
        this.fullUrl = buildFullUrl(api);

        this.description = `${api.objectType} ${api.objectId}`;
        this.iconPath = new vscode.ThemeIcon(api.objectType === 'Query' ? 'graph' : 'symbol-interface');
        this.contextValue = 'apiEntity';
        this.tooltip = new vscode.MarkdownString(
            `**${api.objectType} ${api.objectId}** ${api.objectName}\n\n` +
            `Entity: \`${api.entityName}\` · Set: \`${api.entitySetName}\`\n\n` +
            `**Path**\n\n\`${this.relativePath}\`\n\n` +
            `**Full URL**\n\n\`${this.fullUrl}\``,
        );
        this.command = {
            command: 'al-pocket-tools.goToRegion',
            title: 'Go to API definition',
            arguments: [api.uri, api.line],
        };
    }
}

export type ApiTreeItem = ApiGroupItem | ApiEntityItem;

// ─── Parsing ─────────────────────────────────────────────────────────────────

function extractProp(body: string, name: string): string {
    const m = body.match(new RegExp(`\\b${name}\\s*=\\s*([^;]+);`, 'i'));
    return m ? m[1].trim() : '';
}

function quotedValues(raw: string): string[] {
    const values = [...raw.matchAll(/'([^']*)'/g)].map(m => m[1]);
    return values.length > 0 ? values : (raw ? [raw.replace(/['"]/g, '').trim()] : ['']);
}

function firstQuoted(raw: string): string {
    return quotedValues(raw)[0] ?? '';
}

export function parseApiObjects(text: string, uri: vscode.Uri): ParsedApi[] {
    const results: ParsedApi[] = [];
    const headerRe = /\b(page|query)\s+(\d+)\s+("(?:[^"]|"")+"|[A-Za-z0-9_]+)/gi;
    const matches = [...text.matchAll(headerRe)];

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const start = match.index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
        const body = text.slice(start, end);

        const objectType: ApiObjectType = /^page$/i.test(match[1]) ? 'Page' : 'Query';
        const typeProp = objectType === 'Page' ? 'PageType' : 'QueryType';
        if (!new RegExp(`\\b${typeProp}\\s*=\\s*API\\s*;`, 'i').test(body)) { continue; }

        const publisher = firstQuoted(extractProp(body, 'APIPublisher'));
        const group = firstQuoted(extractProp(body, 'APIGroup'));
        const versions = quotedValues(extractProp(body, 'APIVersion'));
        const entityName = firstQuoted(extractProp(body, 'EntityName'));
        const entitySetName = firstQuoted(extractProp(body, 'EntitySetName'));

        const objectName = match[3].replace(/^"|"$/g, '').replace(/""/g, '"');
        const line = text.slice(0, start).split(/\r?\n/).length - 1;

        for (const version of versions) {
            results.push({
                objectType,
                objectId: match[2],
                objectName,
                publisher,
                group,
                version,
                entityName,
                entitySetName,
                line,
                uri,
            });
        }
    }

    return results;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class ApiTreeProvider implements vscode.TreeDataProvider<ApiTreeItem> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<ApiTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: ApiGroupItem[] = [];
    private scanning: Promise<void> | undefined;

    scan(): Promise<void> {
        // Guard against overlapping scans: if one is already running, reuse it
        // instead of piling up concurrent workspace-wide file reads.
        if (this.scanning) { return this.scanning; }
        this.scanning = this.doScan().finally(() => { this.scanning = undefined; });
        return this.scanning;
    }

    private async doScan(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.al', '**/{.git,node_modules,.alpackages}/**');

        const openDocs = new Map<string, string>();
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'al') {
                openDocs.set(doc.uri.toString(), doc.getText());
            }
        }

        const all: ParsedApi[] = [];
        await Promise.all(files.map(async uri => {
            try {
                const text = openDocs.get(uri.toString())
                    ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                all.push(...parseApiObjects(text, uri));
            } catch {
                // ignore unreadable files
            }
        }));

        this.rebuild(all);
    }

    hasData(): boolean {
        return this.roots.length > 0;
    }

    private rebuild(apis: ParsedApi[]): void {
        const groupMap = new Map<string, ApiEntityItem[]>();

        for (const api of apis) {
            const key = [api.publisher, api.group, api.version].filter(Boolean).join('/') || '(no publisher/group/version)';
            if (!groupMap.has(key)) { groupMap.set(key, []); }
            groupMap.get(key)!.push(new ApiEntityItem(api));
        }

        this.roots = [...groupMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, entities]) => {
                entities.sort((a, b) =>
                    String(a.label).localeCompare(String(b.label)) ||
                    path.basename(a.api.uri.fsPath).localeCompare(path.basename(b.api.uri.fsPath)),
                );
                return new ApiGroupItem(label, entities);
            });

        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ApiTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ApiTreeItem): ApiTreeItem[] {
        if (!element) { return this.roots; }
        if (element.kind === 'group') { return element.entities; }
        return [];
    }
}
