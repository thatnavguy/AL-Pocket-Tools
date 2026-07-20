import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Object types that carry a numeric ID in AL. (controladdin/profile/interface are name-only.)
const OBJECT_TYPES = [
    'table', 'page', 'report', 'codeunit', 'query', 'xmlport', 'enum',
    'permissionset', 'entitlement',
    'pageextension', 'tableextension', 'reportextension', 'enumextension', 'permissionsetextension',
];

const OBJECT_DECL_RE = new RegExp(
    `^\\s*(${OBJECT_TYPES.join('|')})\\s+(\\d+)\\s+("(?:[^"]|"")*"|\\w+)`,
    'gimd'
);

export interface ParsedAlObject {
    type: string;
    id: number;
    name: string;
    idStart: number;
    idEnd: number;
}

// Pure, testable: parses object declarations out of raw AL source text.
export function parseAlObjects(text: string): ParsedAlObject[] {
    const results: ParsedAlObject[] = [];
    OBJECT_DECL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OBJECT_DECL_RE.exec(text)) !== null) {
        const [, type, idStr, rawName] = match;
        const indices = (match as RegExpExecArray & { indices: Array<[number, number]> }).indices;
        const [idStart, idEnd] = indices[2];
        results.push({
            type: type.toLowerCase(),
            id: parseInt(idStr, 10),
            name: rawName.startsWith('"') ? rawName.slice(1, -1) : rawName,
            idStart,
            idEnd,
        });
    }
    return results;
}

export interface AlObjectDeclaration extends ParsedAlObject {
    uri: vscode.Uri;
    range: vscode.Range;
}

export interface IdRange {
    from: number;
    to: number;
}

interface AppJsonInfo {
    uri: vscode.Uri;
    idRanges: IdRange[];
}

export interface RenumberPlan {
    object: AlObjectDeclaration;
    oldId: number;
    newId: number;
}

async function findNearestAppJson(fileUri: vscode.Uri, cache: Map<string, vscode.Uri | null>): Promise<vscode.Uri | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return undefined; }

    const roots = new Set(folders.map(f => f.uri.toString()));
    let dir = vscode.Uri.joinPath(fileUri, '..');

    const visited: string[] = [];
    while (true) {
        const key = dir.toString();
        if (cache.has(key)) {
            const cached = cache.get(key) ?? undefined;
            for (const v of visited) { cache.set(v, cached ?? null); }
            return cached;
        }
        visited.push(key);

        const candidate = vscode.Uri.joinPath(dir, 'app.json');
        try {
            await vscode.workspace.fs.stat(candidate);
            for (const v of visited) { cache.set(v, candidate); }
            return candidate;
        } catch {
            // not at this level, walk up
        }

        if (roots.has(key)) { break; }
        const parent = vscode.Uri.joinPath(dir, '..');
        if (parent.toString() === key) { break; }
        dir = parent;
    }

    for (const v of visited) { cache.set(v, null); }
    return undefined;
}

async function readIdRanges(uri: vscode.Uri): Promise<IdRange[]> {
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const json = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        const idRanges = json['idRanges'];
        if (!Array.isArray(idRanges)) { return []; }
        return idRanges
            .filter((r): r is { from: number; to: number } =>
                typeof r === 'object' && r !== null &&
                typeof (r as { from?: unknown }).from === 'number' &&
                typeof (r as { to?: unknown }).to === 'number')
            .map(r => ({ from: r.from, to: r.to }))
            .sort((a, b) => a.from - b.from);
    } catch {
        return [];
    }
}

export async function scanWorkspaceObjects(): Promise<AlObjectDeclaration[]> {
    const files = await vscode.workspace.findFiles('**/*.al', '**/{node_modules,.alpackages,.git}/**');
    const results: AlObjectDeclaration[] = [];

    for (const uri of files) {
        let text: string;
        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            text = Buffer.from(raw).toString('utf8');
        } catch {
            continue;
        }

        const doc = { positionAt: (offset: number) => offsetToPosition(text, offset) };
        for (const parsed of parseAlObjects(text)) {
            results.push({
                ...parsed,
                uri,
                range: new vscode.Range(doc.positionAt(parsed.idStart), doc.positionAt(parsed.idEnd)),
            });
        }
    }

    return results;
}

function offsetToPosition(text: string, offset: number): vscode.Position {
    let line = 0;
    let lastNewline = -1;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            lastNewline = i;
        }
    }
    return new vscode.Position(line, offset - lastNewline - 1);
}

// Any git-tracked commit timestamp (ms since epoch) will be far below this for centuries to come,
// so adding it to an untracked file's mtime guarantees untracked files always sort as newer than
// tracked ones, while still ordering multiple untracked files against each other by mtime.
const UNTRACKED_OFFSET = 1e15;

async function mtimeOrNewest(uri: vscode.Uri): Promise<number> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return UNTRACKED_OFFSET + stat.mtime;
    } catch {
        return Infinity;
    }
}

// Returns a millisecond timestamp; untracked files sort as newest, tie-broken by mtime.
async function getFileTimestamp(uri: vscode.Uri, output: vscode.OutputChannel): Promise<number> {
    const dir = path.dirname(uri.fsPath);
    const base = path.basename(uri.fsPath);

    try {
        const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%ct', '--', base], { cwd: dir });
        const trimmed = stdout.trim();
        if (trimmed.length === 0) {
            return mtimeOrNewest(uri); // untracked — treat as newest, tie-break by mtime
        }
        return parseInt(trimmed, 10) * 1000;
    } catch {
        output.appendLine(`AL Pocket Tools: git unavailable for ${vscode.workspace.asRelativePath(uri)} — falling back to file modified time.`);
        return mtimeOrNewest(uri);
    }
}

export async function resolveConflicts(
    objects: AlObjectDeclaration[],
    output: vscode.OutputChannel
): Promise<{ renumbers: RenumberPlan[]; unresolved: AlObjectDeclaration[] }> {
    const appJsonDirCache = new Map<string, vscode.Uri | null>();
    const appJsonInfoCache = new Map<string, AppJsonInfo>();
    const timestampCache = new Map<string, number>();

    async function getAppInfo(uri: vscode.Uri): Promise<AppJsonInfo | undefined> {
        const appJsonUri = await findNearestAppJson(uri, appJsonDirCache);
        if (!appJsonUri) { return undefined; }
        const key = appJsonUri.toString();
        if (!appJsonInfoCache.has(key)) {
            appJsonInfoCache.set(key, { uri: appJsonUri, idRanges: await readIdRanges(appJsonUri) });
        }
        return appJsonInfoCache.get(key);
    }

    async function getTimestamp(uri: vscode.Uri): Promise<number> {
        const key = uri.toString();
        if (!timestampCache.has(key)) {
            timestampCache.set(key, await getFileTimestamp(uri, output));
        }
        return timestampCache.get(key)!;
    }

    // Group by appJson + type + id
    const groups = new Map<string, AlObjectDeclaration[]>();
    const objectAppInfo = new Map<AlObjectDeclaration, AppJsonInfo | undefined>();

    for (const obj of objects) {
        const appInfo = await getAppInfo(obj.uri);
        objectAppInfo.set(obj, appInfo);
        const key = `${appInfo?.uri.toString() ?? ''}::${obj.type}::${obj.id}`;
        const arr = groups.get(key) ?? [];
        arr.push(obj);
        groups.set(key, arr);
    }

    const toRenumber: AlObjectDeclaration[] = [];
    const winners = new Set<AlObjectDeclaration>();

    for (const arr of groups.values()) {
        if (arr.length <= 1) {
            if (arr.length === 1) { winners.add(arr[0]); }
            continue;
        }

        const withTimestamps = await Promise.all(arr.map(async o => ({ o, ts: await getTimestamp(o.uri) })));
        withTimestamps.sort((a, b) => a.ts - b.ts); // oldest first
        winners.add(withTimestamps[0].o);
        for (let i = 1; i < withTimestamps.length; i++) {
            toRenumber.push(withTimestamps[i].o);
        }
    }

    // used-id set per (appJson, type), seeded from everything that is NOT being renumbered
    const usedIds = new Map<string, Set<number>>();
    const usedKey = (appInfo: AppJsonInfo | undefined, type: string) => `${appInfo?.uri.toString() ?? ''}::${type}`;

    const toRenumberSet = new Set(toRenumber);
    for (const obj of objects) {
        if (toRenumberSet.has(obj)) { continue; }
        const key = usedKey(objectAppInfo.get(obj), obj.type);
        const set = usedIds.get(key) ?? new Set<number>();
        set.add(obj.id);
        usedIds.set(key, set);
    }

    // Sort renumber candidates deterministically for stable output
    toRenumber.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()) || a.idStart - b.idStart);

    const renumbers: RenumberPlan[] = [];
    const unresolved: AlObjectDeclaration[] = [];

    for (const obj of toRenumber) {
        const appInfo = objectAppInfo.get(obj);
        const key = usedKey(appInfo, obj.type);
        const set = usedIds.get(key) ?? new Set<number>();
        usedIds.set(key, set);

        const ranges = appInfo?.idRanges ?? [];
        let newId: number | undefined;
        for (const range of ranges) {
            for (let candidate = range.from; candidate <= range.to; candidate++) {
                if (!set.has(candidate)) {
                    newId = candidate;
                    break;
                }
            }
            if (newId !== undefined) { break; }
        }

        if (newId === undefined) {
            unresolved.push(obj);
            continue;
        }

        set.add(newId);
        renumbers.push({ object: obj, oldId: obj.id, newId });
    }

    return { renumbers, unresolved };
}

export async function renumberObjectIds(output: vscode.OutputChannel): Promise<void> {
    output.appendLine('AL Pocket Tools: Scanning workspace for AL object ID conflicts...');
    const objects = await scanWorkspaceObjects();
    const { renumbers, unresolved } = await resolveConflicts(objects, output);

    if (renumbers.length === 0 && unresolved.length === 0) {
        vscode.window.showInformationMessage('AL Pocket Tools: No object ID conflicts found.');
        return;
    }

    interface PickItem extends vscode.QuickPickItem {
        plan: RenumberPlan;
    }

    const items: PickItem[] = renumbers.map(plan => ({
        label: `${plan.object.type} ${plan.oldId} → ${plan.newId}`,
        description: plan.object.name,
        detail: vscode.workspace.asRelativePath(plan.object.uri),
        picked: true,
        plan,
    }));

    if (items.length > 0) {
        const picked = await vscode.window.showQuickPick(items, {
            title: 'Renumber Object IDs — conflicts found',
            placeHolder: 'Select which renumbers to apply',
            canPickMany: true,
        });

        if (!picked || picked.length === 0) {
            if (unresolved.length > 0) {
                reportUnresolved(unresolved, output);
            }
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        for (const item of picked) {
            edit.replace(item.plan.object.uri, item.plan.object.range, String(item.plan.newId));
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
            for (const item of picked) {
                output.appendLine(
                    `AL Pocket Tools: Renumbered ${item.plan.object.type} ${item.plan.oldId} → ${item.plan.newId} in ${vscode.workspace.asRelativePath(item.plan.object.uri)}`
                );
            }
            vscode.window.showInformationMessage(`AL Pocket Tools: Renumbered ${picked.length} object(s).`);
        } else {
            vscode.window.showErrorMessage('AL Pocket Tools: Failed to apply renumbering edits.');
        }
    }

    if (unresolved.length > 0) {
        reportUnresolved(unresolved, output);
    }
}

function reportUnresolved(unresolved: AlObjectDeclaration[], output: vscode.OutputChannel): void {
    output.appendLine(`AL Pocket Tools: ${unresolved.length} object(s) could not be renumbered — no free ID available in idRanges:`);
    for (const obj of unresolved) {
        output.appendLine(`  - ${obj.type} ${obj.id} "${obj.name}" in ${vscode.workspace.asRelativePath(obj.uri)}`);
    }
    output.show(true);
    vscode.window.showWarningMessage(
        `AL Pocket Tools: ${unresolved.length} object(s) could not be renumbered — no free ID available. See output for details.`
    );
}
