import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlObjectInfo {
    type: string;
    id: number;
    name: string;
    caption: string;
    lineCount: number;
    procedureCount: number;
    triggerCount: number;
    fieldCount: number;
    complexityScore: number;
    complexityLabel: string;
}

interface ProjectInfo {
    appName: string;
    appVersion: string;
    publisher: string;
    rootFolder: string;
    objects: AlObjectInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPES_WITH_ID = [
    'table', 'tableextension',
    'page', 'pageextension',
    'codeunit',
    'report', 'reportextension',
    'xmlport',
    'query',
    'enum', 'enumextension',
    'permissionset', 'permissionsetextension',
];

const TYPES_NO_ID = [
    'interface',
    'profile', 'profileextension',
    'controladdin',
];

const TYPE_ORDER = [...TYPES_WITH_ID, ...TYPES_NO_ID];

// Single-line regexes for matching the object header per line
const OBJ_WITH_ID_RE = new RegExp(
    `^(${TYPES_WITH_ID.join('|')})\\s+(\\d+)\\s+(?:"([^"]+)"|(\\S+))`,
    'i'
);
const OBJ_NO_ID_RE = new RegExp(
    `^(${TYPES_NO_ID.join('|')})\\s+(?:"([^"]+)"|(\\S+))`,
    'i'
);

// Content-wide regexes for metric counting
const CAPTION_RE = /Caption\s*=\s*'([^']+)'/i;
const PROCEDURE_RE = /^\s*(?:(?:local|internal|protected)\s+)*procedure\s+\w+/gim;
const TRIGGER_RE = /^\s*trigger\s+\w+/gim;
const FIELD_TABLE_RE = /^\s*field\s*\(\s*\d+/gim;
const FIELD_PAGE_RE = /^\s*field\s*\(/gim;
const VALUE_ENUM_RE = /^\s*value\s*\(\s*\d+/gim;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function countMatches(content: string, re: RegExp): number {
    const copy = new RegExp(re.source, re.flags);
    let count = 0;
    while (copy.exec(content) !== null) { count++; }
    return count;
}

function complexityLabel(score: number): string {
    if (score <= 3) { return '🟢 Simple'; }
    if (score <= 6) { return '🟡 Moderate'; }
    return '🔴 Complex';
}

function typeRank(type: string): number {
    const i = TYPE_ORDER.indexOf(type);
    return i === -1 ? 999 : i;
}

function typeSort(a: AlObjectInfo, b: AlObjectInfo): number {
    const diff = typeRank(a.type) - typeRank(b.type);
    if (diff !== 0) { return diff; }
    if (a.id !== b.id) { return a.id - b.id; }
    return a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// AL file parsing
// ---------------------------------------------------------------------------

function parseAlFile(content: string): AlObjectInfo | undefined {
    const lines = content.split('\n');

    let type = '';
    let id = 0;
    let name = '';

    // Scan lines (skip comments/blank) to find the object header
    for (const line of lines) {
        const trimmed = line.trimStart();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            continue;
        }

        const withId = OBJ_WITH_ID_RE.exec(trimmed);
        if (withId) {
            type = withId[1].toLowerCase();
            id = parseInt(withId[2], 10);
            name = (withId[3] ?? withId[4] ?? '').trim();
            break;
        }

        const noId = OBJ_NO_ID_RE.exec(trimmed);
        if (noId) {
            type = noId[1].toLowerCase();
            id = 0;
            name = (noId[2] ?? noId[3] ?? '').trim();
            break;
        }

        // First non-comment, non-blank line that didn't match — not an AL object file
        break;
    }

    if (!type) { return undefined; }

    const captionMatch = CAPTION_RE.exec(content);
    const caption = captionMatch ? captionMatch[1] : name;

    const procedureCount = countMatches(content, PROCEDURE_RE);
    const triggerCount = countMatches(content, TRIGGER_RE);

    let fieldCount = 0;
    if (type === 'table' || type === 'tableextension') {
        fieldCount = countMatches(content, FIELD_TABLE_RE);
    } else if (type === 'enum' || type === 'enumextension') {
        fieldCount = countMatches(content, VALUE_ENUM_RE);
    } else if (type === 'page' || type === 'pageextension') {
        fieldCount = countMatches(content, FIELD_PAGE_RE);
    }

    const lineCount = lines.length;

    // Complexity: lines (1-3) + procedures+triggers (1-3) + fields/values (1-3)
    const lineScore = lineCount < 100 ? 1 : lineCount < 300 ? 2 : 3;
    const procScore = (procedureCount + triggerCount) < 5 ? 1 : (procedureCount + triggerCount) < 15 ? 2 : 3;
    const fieldScore = fieldCount < 10 ? 1 : fieldCount < 30 ? 2 : 3;
    const complexityScore = lineScore + procScore + fieldScore;

    return {
        type,
        id,
        name,
        caption,
        lineCount,
        procedureCount,
        triggerCount,
        fieldCount,
        complexityScore,
        complexityLabel: complexityLabel(complexityScore),
    };
}

// ---------------------------------------------------------------------------
// Project scanning
// ---------------------------------------------------------------------------

async function scanProject(appJsonUri: vscode.Uri): Promise<ProjectInfo | undefined> {
    let appName = '';
    let appVersion = '0.0.0.0';
    let publisher = '';

    try {
        const raw = await vscode.workspace.fs.readFile(appJsonUri);
        const appJson = JSON.parse(Buffer.from(raw).toString('utf8')) as {
            name?: string;
            version?: string;
            publisher?: string;
        };
        appName = appJson.name ?? '';
        appVersion = appJson.version ?? '0.0.0.0';
        publisher = appJson.publisher ?? '';
    } catch {
        return undefined;
    }

    const rootFolder = path.dirname(appJsonUri.fsPath);
    if (!appName) { appName = path.basename(rootFolder); }

    const alFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.file(rootFolder), '**/*.al'),
        '**/{.alpackages,.git,node_modules}/**'
    );

    const objects: AlObjectInfo[] = [];
    for (const fileUri of alFiles) {
        try {
            const raw = await vscode.workspace.fs.readFile(fileUri);
            const obj = parseAlFile(Buffer.from(raw).toString('utf8'));
            if (obj) { objects.push(obj); }
        } catch {
            // skip unreadable files
        }
    }

    return { appName, appVersion, publisher, rootFolder, objects };
}

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

function isoDate(): string {
    return new Date().toISOString().split('T')[0];
}

function buildProjectOverview(project: ProjectInfo): string {
    const now = isoDate();

    // Object counts by type
    const typeCounts = new Map<string, number>();
    for (const obj of project.objects) {
        typeCounts.set(obj.type, (typeCounts.get(obj.type) ?? 0) + 1);
    }
    const sortedTypes = [...typeCounts.entries()].sort(
        (a, b) => typeRank(a[0]) - typeRank(b[0])
    );

    // Complexity counts
    let simple = 0, moderate = 0, complex = 0;
    for (const obj of project.objects) {
        if (obj.complexityScore <= 3) { simple++; }
        else if (obj.complexityScore <= 6) { moderate++; }
        else { complex++; }
    }

    // Top 10 most complex (tie-break: more lines = higher rank)
    const top10 = [...project.objects]
        .sort((a, b) => b.complexityScore - a.complexityScore || b.lineCount - a.lineCount)
        .slice(0, 10);

    let md = `# Project Overview: ${project.appName}\n\n`;
    md += `**Publisher:** ${project.publisher}  \n`;
    md += `**Version:** ${project.appVersion}  \n`;
    md += `**Generated:** ${now}\n\n`;
    md += `---\n\n`;

    // --- Object Summary ---
    md += `## Object Summary\n\n`;
    md += `| Object Type | Count |\n`;
    md += `|-------------|------:|\n`;
    for (const [type, count] of sortedTypes) {
        md += `| ${capitalize(type)} | ${count} |\n`;
    }
    md += `| **Total** | **${project.objects.length}** |\n\n`;
    md += `---\n\n`;

    // --- Complexity Overview ---
    md += `## Complexity Overview\n\n`;
    md += `> Complexity score = lines (1-3) + procedures & triggers (1-3) + fields/values (1-3)\n\n`;
    md += `| Complexity | Count |\n`;
    md += `|-----------|------:|\n`;
    md += `| 🟢 Simple (score 3) | ${simple} |\n`;
    md += `| 🟡 Moderate (score 4–6) | ${moderate} |\n`;
    md += `| 🔴 Complex (score 7–9) | ${complex} |\n\n`;
    md += `---\n\n`;

    // --- Top 10 ---
    md += `## Top 10 Most Complex Objects\n\n`;
    if (top10.length === 0) {
        md += `_No AL objects found._\n\n`;
    } else {
        md += `| # | Type | Object ID | Name | Lines | Procedures | Triggers | Fields/Values | Complexity |\n`;
        md += `|--:|------|----------:|------|------:|-----------:|--------:|-------------:|------------|\n`;
        top10.forEach((obj, i) => {
            const idCell = obj.id > 0 ? String(obj.id) : '—';
            md += `| ${i + 1} | ${capitalize(obj.type)} | ${idCell} | ${obj.name} | ${obj.lineCount} | ${obj.procedureCount} | ${obj.triggerCount} | ${obj.fieldCount} | ${obj.complexityLabel} |\n`;
        });
        md += '\n';
    }

    return md;
}

function buildObjectList(project: ProjectInfo): string {
    const now = isoDate();
    const sorted = [...project.objects].sort(typeSort);

    let md = `# AL Object List: ${project.appName}\n\n`;
    md += `**Publisher:** ${project.publisher}  \n`;
    md += `**Version:** ${project.appVersion}  \n`;
    md += `**Generated:** ${now}\n\n`;
    md += `**Total Objects:** ${project.objects.length}\n\n`;
    md += `---\n\n`;

    md += `| Type | Object ID | Name | Caption | Lines | Complexity |\n`;
    md += `|------|----------:|------|---------|------:|------------|\n`;
    for (const obj of sorted) {
        const idCell = obj.id > 0 ? String(obj.id) : '—';
        md += `| ${capitalize(obj.type)} | ${idCell} | ${obj.name} | ${obj.caption} | ${obj.lineCount} | ${obj.complexityLabel} |\n`;
    }
    md += '\n';

    return md;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generateProjectOverview(output: vscode.OutputChannel): Promise<void> {
    const config = vscode.workspace.getConfiguration('al-pocket-tools');
    const outputFolderName = config.get<string>('projectOverview.outputFolder', 'Project');

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'AL Pocket Tools: Generating Project Overview', cancellable: false },
        async (progress) => {
            progress.report({ message: 'Locating app.json files…' });

            const appJsonUris = await vscode.workspace.findFiles(
                '**/app.json',
                '**/{.alpackages,.git,node_modules}/**'
            );

            if (appJsonUris.length === 0) {
                void vscode.window.showWarningMessage('AL Pocket Tools: No app.json found in the workspace.');
                return;
            }

            const projects: ProjectInfo[] = [];
            for (const appJsonUri of appJsonUris) {
                const folderName = path.basename(path.dirname(appJsonUri.fsPath));
                progress.report({ message: `Scanning ${folderName}…` });

                const project = await scanProject(appJsonUri);
                if (project) {
                    output.appendLine(`[Project Overview] ${project.appName}: ${project.objects.length} objects found.`);
                    projects.push(project);
                }
            }

            if (projects.length === 0) {
                void vscode.window.showWarningMessage('AL Pocket Tools: No AL objects found in the workspace.');
                return;
            }

            let firstOverviewUri: vscode.Uri | undefined;

            for (const project of projects) {
                const outputDir = vscode.Uri.joinPath(
                    vscode.Uri.file(project.rootFolder),
                    outputFolderName
                );
                await vscode.workspace.fs.createDirectory(outputDir);

                const overviewUri = vscode.Uri.joinPath(outputDir, 'ProjectOverview.md');
                const listUri = vscode.Uri.joinPath(outputDir, 'ALObjectList.md');

                await vscode.workspace.fs.writeFile(
                    overviewUri,
                    Buffer.from(buildProjectOverview(project), 'utf8')
                );
                await vscode.workspace.fs.writeFile(
                    listUri,
                    Buffer.from(buildObjectList(project), 'utf8')
                );

                output.appendLine(`[Project Overview] Written: ${overviewUri.fsPath}`);
                output.appendLine(`[Project Overview] Written: ${listUri.fsPath}`);

                firstOverviewUri ??= overviewUri;
            }

            const msg = projects.length === 1
                ? `Project overview generated for ${projects[0].appName}.`
                : `Project overviews generated for ${projects.length} projects.`;

            const action = await vscode.window.showInformationMessage(msg, 'Open Overview');
            if (action === 'Open Overview' && firstOverviewUri) {
                const doc = await vscode.workspace.openTextDocument(firstOverviewUri);
                await vscode.window.showTextDocument(doc);
            }
        }
    );
}
