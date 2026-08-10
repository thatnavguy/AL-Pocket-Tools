import * as path from 'path';
import * as vscode from 'vscode';

interface AppDependency {
    id: string;
    name: string;
    publisher: string;
    version: string;
}

interface AppManifestSummary {
    appId: string;
    name: string;
    publisher: string;
    version: string;
    relativePath: string;
    dependencies: AppDependency[];
}

interface AvailablePackage {
    id: string;
    name: string;
    publisher: string;
    version: string;
    relativePath: string;
}

interface DependencyMatch {
    dependency: AppDependency;
    matches: AvailablePackage[];
    usedByApps: AppManifestSummary[];
}

interface WorkspaceReport {
    appSummaries: AppManifestSummary[];
    dependencyMatches: Map<string, DependencyMatch>;
    packageMatches: Map<string, AvailablePackage[]>;
    packageCount: number;
    generatedAt: string;
}

const REPORT_FILENAME = 'APP-DEPENDENCIES.md';
const EXCLUDE_GLOB = '**/node_modules/**';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function parseDependency(value: unknown, sourcePath: string): AppDependency {
    if (!isRecord(value)) {
        throw new Error(`Invalid dependency entry in ${sourcePath}.`);
    }

    const { id, name, publisher, version } = value;
    if (!isString(id) || !isString(name) || !isString(publisher) || !isString(version)) {
        throw new Error(`Dependency entries in ${sourcePath} must contain string id, name, publisher, and version values.`);
    }

    return { id, name, publisher, version };
}

function parseAppManifest(content: string, uri: vscode.Uri): AppManifestSummary {
    let parsed: unknown;

    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error(`Failed to parse JSON in ${vscode.workspace.asRelativePath(uri)}.`);
    }

    if (!isRecord(parsed)) {
        throw new Error(`Expected an object in ${vscode.workspace.asRelativePath(uri)}.`);
    }

    const { id, name, publisher, version, dependencies } = parsed;
    if (!isString(id) || !isString(name) || !isString(publisher) || !isString(version)) {
        throw new Error(`app.json at ${vscode.workspace.asRelativePath(uri)} must contain string id, name, publisher, and version values.`);
    }

    const dependencyList = Array.isArray(dependencies)
        ? dependencies.map(item => parseDependency(item, vscode.workspace.asRelativePath(uri)))
        : [];

    return {
        appId: id,
        name,
        publisher,
        version,
        relativePath: vscode.workspace.asRelativePath(uri),
        dependencies: dependencyList,
    };
}

function parsePackageFilename(uri: vscode.Uri): AvailablePackage | null {
    const filename = path.basename(uri.fsPath, '.app');
    const segments = filename.split('_');
    if (segments.length < 3) {
        return null;
    }

    const version = segments[segments.length - 1];
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
        return null;
    }

    const publisher = segments[0].replace(/_/g, ' ');
    const name = segments.slice(1, -1).join('_').replace(/_/g, ' ');

    return {
        id: '',
        name,
        publisher,
        version,
        relativePath: vscode.workspace.asRelativePath(uri),
    };
}

function dependencyKey(dependency: AppDependency): string {
    return `${dependency.id}||${dependency.publisher}||${dependency.name}`;
}

function packageMatchKey(publisher: string, name: string): string {
    return `${publisher}||${name}`;
}

function getWorkspaceVersionSummary(matches: AvailablePackage[]): string {
    if (matches.length === 0) {
        return 'Not found';
    }

    return matches.map(match => match.version).join(', ');
}

function renderDependencyTableRows(matches: AvailablePackage[]): string[] {
    if (matches.length === 0) {
        return ['| No matching `.app` found in workspace | - |'];
    }

    return matches.map(match => `| ${match.version} | \`${match.relativePath}\` |`);
}

function renderUsedByApps(apps: AppManifestSummary[]): string {
    if (apps.length === 0) {
        return 'None';
    }

    return apps.map(app => `\`${app.name}\``).join(', ');
}

function toMermaidNodeId(prefix: string, value: string): string {
    return `${prefix}_${value.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function escapeMermaidLabel(value: string): string {
    return value.replace(/"/g, '\\"');
}

function appIdentityKey(app: AppManifestSummary): string {
    return packageMatchKey(app.publisher, app.name);
}

function isTestNode(name: string): boolean {
    return name.toLowerCase().includes('test');
}

function buildMermaidDiagram(appSummaries: AppManifestSummary[]): string[] {
    const lines: string[] = [
        '```mermaid',
        'graph LR',
        '    classDef missingWorkspace fill:#fff1f2,stroke:#e11d48,stroke-width:2px,color:#881337;',
        '    classDef testNode fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#92400e;',
    ];
    const appNodeIds = new Map<string, string>();
    const declaredNodeIds = new Map<string, string>();
    const emittedNodes = new Set<string>();
    const edges = new Set<string>();
    const nodeClasses = new Map<string, string[]>();

    const addNodeClass = (nodeId: string, className: string) => {
        const classes = nodeClasses.get(nodeId);
        if (classes) {
            if (!classes.includes(className)) {
                classes.push(className);
            }
            return;
        }

        nodeClasses.set(nodeId, [className]);
    };

    for (const app of appSummaries) {
        const identity = appIdentityKey(app);
        const appNodeId = toMermaidNodeId('node', identity);
        appNodeIds.set(identity, appNodeId);

        if (!emittedNodes.has(appNodeId)) {
            lines.push(`    ${appNodeId}["${escapeMermaidLabel(app.name)}"]`);
            emittedNodes.add(appNodeId);
        }

        if (isTestNode(app.name)) {
            addNodeClass(appNodeId, 'testNode');
        }
    }

    for (const app of appSummaries) {
        const appNodeId = appNodeIds.get(appIdentityKey(app));
        if (!appNodeId) {
            continue;
        }

        for (const dependency of app.dependencies) {
            const dependencyIdentity = packageMatchKey(dependency.publisher, dependency.name);
            const dependencyNodeId = appNodeIds.get(dependencyIdentity)
                ?? declaredNodeIds.get(dependencyIdentity)
                ?? toMermaidNodeId('node', dependencyIdentity);

            if (!declaredNodeIds.has(dependencyIdentity)) {
                declaredNodeIds.set(dependencyIdentity, dependencyNodeId);
            }

            if (!emittedNodes.has(dependencyNodeId)) {
                lines.push(`    ${dependencyNodeId}["${escapeMermaidLabel(`${dependency.publisher} / ${dependency.name}`)}"]`);
                emittedNodes.add(dependencyNodeId);
            }

            if (!appNodeIds.has(dependencyIdentity)) {
                addNodeClass(dependencyNodeId, 'missingWorkspace');
            }

            if (isTestNode(dependency.name)) {
                addNodeClass(dependencyNodeId, 'testNode');
            }

            const edge = `    ${appNodeId} --> ${dependencyNodeId}`;
            if (!edges.has(edge)) {
                lines.push(edge);
                edges.add(edge);
            }
        }
    }

    for (const [nodeId, classes] of nodeClasses) {
        lines.push(`    class ${nodeId} ${classes.join(',')}`);
    }

    lines.push('```');
    return lines;
}

function buildMarkdown(report: WorkspaceReport): string {
    const lines: string[] = [
        '# App dependency report',
        '',
        `Generated from ${report.appSummaries.length} \`app.json\` file(s) and ${report.packageCount} \`.app\` file(s).`,
        `Generated at: ${report.generatedAt}`,
        '',
        '## Dependency diagram',
        '',
    ];

    if (report.appSummaries.length === 0) {
        lines.push('No `app.json` files were found in this workspace.', '');
    } else {
        lines.push(...buildMermaidDiagram(report.appSummaries), '');
    }

    lines.push(
        '## Apps',
        '',
    );

    if (report.appSummaries.length === 0) {
        lines.push('No `app.json` files were found in this workspace.', '');
    } else {
        for (const app of report.appSummaries) {
            lines.push(`### ${app.name}`);
            lines.push('');
            lines.push(`- **Path:** \`${app.relativePath}\``);
            lines.push(`- **Publisher:** ${app.publisher}`);
            lines.push(`- **Version:** ${app.version}`);
            lines.push(`- **App ID:** \`${app.appId}\``);
            lines.push('');

            if (app.dependencies.length === 0) {
                lines.push('No dependencies declared.', '');
                continue;
            }

            lines.push('| Dependency | Declared version | Workspace app version | App ID |');
            lines.push('|---|---|---|---|');
            for (const dependency of app.dependencies) {
                const matches = report.packageMatches.get(packageMatchKey(dependency.publisher, dependency.name)) ?? [];
                lines.push(`| ${dependency.publisher} / ${dependency.name} | ${dependency.version} | ${getWorkspaceVersionSummary(matches)} | \`${dependency.id}\` |`);
            }
            lines.push('');
        }
    }

    lines.push('## Available dependency packages in workspace', '');
    if (report.dependencyMatches.size === 0) {
        lines.push('No dependencies were declared in any `app.json` file.', '');
    } else {
        const matches = [...report.dependencyMatches.values()].sort((a, b) =>
            `${a.dependency.publisher}/${a.dependency.name}`.localeCompare(`${b.dependency.publisher}/${b.dependency.name}`));

        for (const item of matches) {
            lines.push(`### ${item.dependency.publisher} / ${item.dependency.name}`);
            lines.push('');
            lines.push(`- **Declared version:** ${item.dependency.version}`);
            lines.push(`- **App ID:** \`${item.dependency.id}\``);
            lines.push(`- **Used by app(s):** ${renderUsedByApps(item.usedByApps)}`);
            lines.push('');
            lines.push('| Workspace package version | Path |');
            lines.push('|---|---|');
            lines.push(...renderDependencyTableRows(item.matches));
            lines.push('');
        }
    }

    return lines.join('\n');
}

async function readUtf8File(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
}

async function collectWorkspaceReport(): Promise<WorkspaceReport> {
    const [appJsonUris, appPackageUris] = await Promise.all([
        vscode.workspace.findFiles('**/app.json', EXCLUDE_GLOB),
        vscode.workspace.findFiles('**/*.app', EXCLUDE_GLOB),
    ]);

    const appSummaries = await Promise.all(
        appJsonUris.map(async uri => parseAppManifest(await readUtf8File(uri), uri))
    );

    const packages = appPackageUris
        .map(uri => parsePackageFilename(uri))
        .filter((pkg): pkg is AvailablePackage => pkg !== null);

    const packageMatches = new Map<string, AvailablePackage[]>();
    for (const pkg of packages) {
        const key = packageMatchKey(pkg.publisher, pkg.name);
        const existing = packageMatches.get(key);
        if (existing) {
            existing.push(pkg);
        } else {
            packageMatches.set(key, [pkg]);
        }
    }

    for (const entry of packageMatches.values()) {
        entry.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    }

    const dependencyMatches = new Map<string, DependencyMatch>();
    for (const app of appSummaries) {
        for (const dependency of app.dependencies) {
            const key = dependencyKey(dependency);
            if (dependencyMatches.has(key)) {
                continue;
            }

            const matches = packageMatches.get(packageMatchKey(dependency.publisher, dependency.name)) ?? [];
            const usedByApps = appSummaries.filter(appSummary =>
                appSummary.dependencies.some(appDependency => dependencyKey(appDependency) === key)
            );
            dependencyMatches.set(key, { dependency, matches, usedByApps });
        }
    }

    appSummaries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return {
        appSummaries,
        dependencyMatches,
        packageMatches,
        packageCount: appPackageUris.length,
        generatedAt: new Date().toISOString(),
    };
}

async function confirmOverwriteIfNeeded(reportUri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(reportUri);
    } catch {
        return true;
    }

    const choice = await vscode.window.showWarningMessage(
        `AL Pocket Tools: ${REPORT_FILENAME} already exists. Overwrite it?`,
        { modal: true },
        'Overwrite'
    );

    return choice === 'Overwrite';
}

function getReportRootUri(): vscode.Uri {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('AL Pocket Tools: No workspace folder is open.');
    }

    return workspaceFolder.uri;
}

export async function generateAppDependencyReport(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showErrorMessage('AL Pocket Tools: No workspace folder is open.');
        return;
    }

    const rootUri = getReportRootUri();
    const reportUri = vscode.Uri.joinPath(rootUri, REPORT_FILENAME);

    if (!await confirmOverwriteIfNeeded(reportUri)) {
        return;
    }

    try {
        const report = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'AL Pocket Tools: Building app dependency report…',
                cancellable: false,
            },
            async () => collectWorkspaceReport()
        );

        const markdown = buildMarkdown(report);
        await vscode.workspace.fs.writeFile(reportUri, Buffer.from(markdown, 'utf8'));

        const document = await vscode.workspace.openTextDocument(reportUri);
        await vscode.window.showTextDocument(document, { preview: false });
        void vscode.window.showInformationMessage(`AL Pocket Tools: Wrote ${REPORT_FILENAME}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error while building dependency report.';
        void vscode.window.showErrorMessage(`AL Pocket Tools: ${message}`);
    }
}
