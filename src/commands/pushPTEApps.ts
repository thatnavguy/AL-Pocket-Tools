import * as vscode from 'vscode';
import * as path from 'path';
import AdmZip from 'adm-zip';

type LaunchConfig = Record<string, unknown>;

interface CloudTarget {
    label: string;
    tenantId: string;
    environmentName: string;
}

interface BcCompany {
    id: string;
    name: string;
}

interface AppManifest {
    id: string;
    dependencies: string[];
}

const BC_BASE = 'https://api.businesscentral.dynamics.com';
// Same client ID navcontainerhelper uses for device code flow (Azure PowerShell)
const DEFAULT_CLIENT_ID = '1950a258-227b-4e31-a9cf-717495945fc2';
const BC_SCOPE = `${BC_BASE}/.default offline_access`;

// ---------- Auth ----------

function getClientId(): string {
    return vscode.workspace.getConfiguration('al-pocket-tools')
        .get<string>('deploy.clientId', DEFAULT_CLIENT_ID);
}

async function loadRefreshToken(secrets: vscode.SecretStorage, tenantId: string): Promise<string | undefined> {
    return secrets.get(`al-pocket-tools.bcToken.${tenantId}`);
}

async function saveRefreshToken(secrets: vscode.SecretStorage, tenantId: string, token: string): Promise<void> {
    await secrets.store(`al-pocket-tools.bcToken.${tenantId}`, token);
}

async function tryRefreshToken(
    secrets: vscode.SecretStorage,
    tenantId: string,
): Promise<string | null> {
    const cached = await loadRefreshToken(secrets, tenantId);
    if (!cached) { return null; }

    const response = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: getClientId(),
                grant_type: 'refresh_token',
                refresh_token: cached,
                scope: BC_SCOPE,
            }).toString(),
        }
    );
    const data = await response.json() as { access_token?: string; refresh_token?: string };
    if (!data.access_token) { return null; }
    if (data.refresh_token) { await saveRefreshToken(secrets, tenantId, data.refresh_token); }
    return data.access_token;
}

async function authenticateViaDeviceCode(
    secrets: vscode.SecretStorage,
    tenantId: string,
): Promise<string> {
    const dcRes = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: getClientId(), scope: BC_SCOPE }).toString(),
        }
    );
    if (!dcRes.ok) {
        const body = await dcRes.text();
        throw new Error(`Could not start sign-in (${dcRes.status}): ${body}`);
    }
    const dc = await dcRes.json() as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
        message: string;
    };

    // Open browser and show code — same UX as bccontainerhelper
    void vscode.env.openExternal(vscode.Uri.parse(dc.verification_uri));
    const action = await vscode.window.showInformationMessage(
        dc.message,
        { modal: true },
        'Done'
    );
    if (!action) { throw new Error('Authentication cancelled.'); }

    const deadline = Date.now() + dc.expires_in * 1000;
    let interval = dc.interval * 1000;
    while (Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, interval));
        const tokenRes = await fetch(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: getClientId(),
                    device_code: dc.device_code,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }).toString(),
            }
        );
        const token = await tokenRes.json() as {
            access_token?: string;
            refresh_token?: string;
            error?: string;
            error_description?: string;
        };
        if (token.access_token) {
            if (token.refresh_token) { await saveRefreshToken(secrets, tenantId, token.refresh_token); }
            return token.access_token;
        }
        if (token.error === 'slow_down') { interval += 5000; }
        if (token.error && token.error !== 'authorization_pending' && token.error !== 'slow_down') {
            throw new Error(token.error_description ?? token.error);
        }
    }
    throw new Error('Authentication timed out — please try again.');
}

async function getAccessToken(secrets: vscode.SecretStorage, tenantId: string): Promise<string> {
    const fromCache = await tryRefreshToken(secrets, tenantId);
    if (fromCache) { return fromCache; }
    return authenticateViaDeviceCode(secrets, tenantId);
}

// ---------- Dependency sort ----------

function readManifest(fileBytes: Uint8Array): AppManifest | null {
    try {
        const zip = new AdmZip(Buffer.from(fileBytes));
        const entry = zip.getEntry('NavxManifest.xml');
        if (!entry) { return null; }
        const xml = entry.getData().toString('utf8');

        const idMatch = /<App[^>]+Id="([^"]+)"/i.exec(xml);
        if (!idMatch) { return null; }

        const depIds: string[] = [];
        const depRegex = /<Dependency[^>]+Id="([^"]+)"/gi;
        let m: RegExpExecArray | null;
        while ((m = depRegex.exec(xml)) !== null) {
            depIds.push(m[1].toLowerCase());
        }

        return { id: idMatch[1].toLowerCase(), dependencies: depIds };
    } catch {
        return null;
    }
}

function sortByDependencies(uris: readonly vscode.Uri[], manifests: Map<string, AppManifest>): vscode.Uri[] {
    const idToUri = new Map<string, vscode.Uri>();
    const uriPathToId = new Map<string, string>();

    for (const uri of uris) {
        const manifest = manifests.get(uri.fsPath);
        if (manifest) {
            idToUri.set(manifest.id, uri);
            uriPathToId.set(uri.fsPath, manifest.id);
        }
    }

    // Kahn's topological sort: edge A→B means A must deploy before B (B depends on A)
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const [, manifest] of manifests) {
        if (!inDegree.has(manifest.id)) { inDegree.set(manifest.id, 0); }
        for (const depId of manifest.dependencies) {
            if (idToUri.has(depId)) {
                inDegree.set(manifest.id, (inDegree.get(manifest.id) ?? 0) + 1);
                const list = dependents.get(depId) ?? [];
                list.push(manifest.id);
                dependents.set(depId, list);
            }
        }
    }

    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const sorted: vscode.Uri[] = [];

    while (queue.length > 0) {
        const id = queue.shift()!;
        const uri = idToUri.get(id);
        if (uri) { sorted.push(uri); }
        for (const nextId of dependents.get(id) ?? []) {
            const newDegree = (inDegree.get(nextId) ?? 1) - 1;
            inDegree.set(nextId, newDegree);
            if (newDegree === 0) { queue.push(nextId); }
        }
    }

    // Append files whose manifest couldn't be read, preserving original order
    for (const uri of uris) {
        if (!uriPathToId.has(uri.fsPath)) { sorted.push(uri); }
    }

    return sorted;
}

// ---------- Delay ----------

function getDelayOptions(): number[] {
    const raw = vscode.workspace.getConfiguration('al-pocket-tools')
        .get<number[]>('deploy.delayMinutes', [0]);
    return raw.filter(n => typeof n === 'number' && n >= 0);
}

async function promptDelay(targetLabel: string): Promise<number | null> {
    const options = getDelayOptions();
    if (options.length <= 1 && (options[0] ?? 0) === 0) { return 0; }

    const items: vscode.QuickPickItem[] = options.map(m => ({
        label: m === 0 ? 'Now' : `In ${m} min`,
        description: m === 0 ? 'Deploy immediately' : undefined,
    }));
    items.push({ label: 'Custom...', description: 'Enter a number of minutes' });

    const picked = await vscode.window.showQuickPick(items, {
        title: `Push PTE Apps — Deploy to ${targetLabel}`,
        placeHolder: 'When do you want to deploy?',
    });
    if (!picked) { return null; }

    if (picked.label === 'Custom...') {
        const input = await vscode.window.showInputBox({
            prompt: 'Delay in minutes',
            validateInput: v => {
                const n = Number(v);
                return isNaN(n) || n < 0 ? 'Enter a non-negative number' : null;
            },
        });
        if (input === undefined) { return null; }
        return Number(input);
    }

    const match = options[items.indexOf(picked)];
    return match ?? 0;
}

async function waitWithCountdown(targetLabel: string, delayMs: number): Promise<boolean> {
    let cancelled = false;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `AL Pocket Tools: Deploy to ${targetLabel}`,
        cancellable: true,
    }, async (progress, token) => {
        token.onCancellationRequested(() => { cancelled = true; });
        const deadline = Date.now() + delayMs;
        while (!cancelled && Date.now() < deadline) {
            const remaining = Math.ceil((deadline - Date.now()) / 1000);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timeStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
            progress.report({ message: `scheduled in ${timeStr}` });
            await new Promise<void>(r => setTimeout(r, 1000));
        }
    });
    return !cancelled;
}

// ---------- BC API ----------

async function getFirstCompany(token: string, tenantId: string, environmentName: string): Promise<BcCompany> {
    const url = `${BC_BASE}/v2.0/${tenantId}/${environmentName}/api/microsoft/automation/v2.0/companies`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Could not retrieve companies (${response.status}): ${text}`);
    }
    const data = await response.json() as { value: BcCompany[] };
    if (!data.value?.length) {
        throw new Error(`No companies found in environment "${environmentName}".`);
    }
    return data.value[0];
}

interface ExtensionUploadRecord {
    systemId: string;
    'extensionContent@odata.mediaEditLink'?: string;
}

async function uploadApp(
    token: string,
    tenantId: string,
    environmentName: string,
    companyId: string,
    fileBytes: Uint8Array,
    _fileName: string,
): Promise<string | null> {
    // navcontainerhelper three-step process:
    //   1. GET/POST/PATCH extensionUpload to create or retrieve the upload slot (JSON)
    //   2. PATCH extensionContent media link with raw binary
    //   3. POST Microsoft.NAV.upload to trigger deployment
    const baseUrl = `${BC_BASE}/v2.0/${tenantId}/${environmentName}/api/microsoft/automation/v2.0/companies(${companyId})/extensionUpload`;
    const authHeader = { 'Authorization': `Bearer ${token}` };

    // Step 1: get or create the upload slot
    const getRes = await fetch(baseUrl, { headers: { ...authHeader, 'Accept': 'application/json' } });
    if (!getRes.ok) {
        throw new Error(`Could not check upload slot (${getRes.status}): ${await getRes.text()}`);
    }
    const getData = await getRes.json() as { value: ExtensionUploadRecord[] };

    let systemId: string;
    let mediaEditLink: string;

    if (getData.value.length === 0) {
        const postRes = await fetch(baseUrl, {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ schedule: 'Current Version', schemaSyncMode: 'Add' }),
        });
        if (!postRes.ok) {
            throw new Error(`Could not create upload slot (${postRes.status}): ${await postRes.text()}`);
        }
        const postData = await postRes.json() as ExtensionUploadRecord;
        systemId = postData.systemId;
        mediaEditLink = postData['extensionContent@odata.mediaEditLink'] ?? `${baseUrl}(${systemId})/extensionContent`;
    } else {
        const existing = getData.value[0];
        systemId = existing.systemId;
        const patchRes = await fetch(`${baseUrl}(${systemId})`, {
            method: 'PATCH',
            headers: { ...authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json', 'If-Match': '*' },
            body: JSON.stringify({ schedule: 'Current Version', schemaSyncMode: 'Add' }),
        });
        if (!patchRes.ok) {
            throw new Error(`Could not update upload slot (${patchRes.status}): ${await patchRes.text()}`);
        }
        const patchData = await patchRes.json() as ExtensionUploadRecord;
        mediaEditLink = patchData['extensionContent@odata.mediaEditLink'] ?? `${baseUrl}(${systemId})/extensionContent`;
    }

    // Step 2: upload the .app binary to the media link
    const contentRes = await fetch(mediaEditLink, {
        method: 'PATCH',
        headers: { ...authHeader, 'Content-Type': 'application/octet-stream', 'If-Match': '*' },
        body: Buffer.from(fileBytes) as unknown as Uint8Array,
    });
    if (!contentRes.ok) {
        throw new Error(`Could not upload app content (${contentRes.status}): ${await contentRes.text()}`);
    }

    // Step 3: trigger deployment
    const triggerRes = await fetch(`${baseUrl}(${systemId})/Microsoft.NAV.upload`, {
        method: 'POST',
        headers: { ...authHeader, 'Accept': 'application/json' },
    });

    if (triggerRes.status === 204 || triggerRes.status === 200) { return null; }
    if (triggerRes.status === 202) { return triggerRes.headers.get('Location'); }

    throw new Error(`${triggerRes.status} ${triggerRes.statusText}: ${await triggerRes.text()}`);
}

async function pollOperationStatus(token: string, statusUrl: string): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 3000));
        const response = await fetch(statusUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!response.ok) { break; }
        const data = await response.json() as { status?: string; message?: string };
        const status = (data.status ?? '').toLowerCase();
        if (status === 'succeeded' || status === 'completed') { return; }
        if (status === 'failed' || status === 'error') {
            throw new Error(data.message ?? 'Deployment failed on the server.');
        }
    }
}

// ---------- Command ----------

function getCloudTarget(config: LaunchConfig): CloudTarget | null {
    const tenant = config['tenant'];
    const envName = config['environmentName'];
    if (typeof tenant !== 'string' || !tenant.trim()) { return null; }
    if (typeof envName !== 'string' || !envName.trim()) { return null; }
    return {
        label: typeof config['name'] === 'string' ? config['name'] : envName.trim(),
        tenantId: tenant.trim(),
        environmentName: envName.trim(),
    };
}

export async function pushPTEApps(
    secrets: vscode.SecretStorage,
    output: vscode.OutputChannel,
    contextUri?: vscode.Uri,
    allContextUris?: vscode.Uri[],
): Promise<void> {
    let appUris: readonly vscode.Uri[];

    if (allContextUris?.length) {
        appUris = allContextUris;
    } else if (contextUri) {
        appUris = [contextUri];
    } else {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { 'AL App Files': ['app'] },
            title: 'Select .app files to deploy to Business Central',
        });
        if (!picked?.length) { return; }
        appUris = picked;
    }

    const savedConfigs = vscode.workspace.getConfiguration('al-pocket-tools')
        .get<LaunchConfig[]>('launch.configurations', []);
    const targets = savedConfigs.map(getCloudTarget).filter((t): t is CloudTarget => t !== null);

    if (targets.length === 0) {
        const action = await vscode.window.showErrorMessage(
            'AL Pocket Tools: No BC cloud environments found. Save a launch configuration with a tenant and environment name first.',
            'Open Settings',
        );
        if (action === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'al-pocket-tools.launch.configurations');
        }
        return;
    }

    let target: CloudTarget;
    if (targets.length === 1) {
        target = targets[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            targets.map(t => ({
                label: t.label,
                description: `${t.tenantId} · ${t.environmentName}`,
                target: t,
            })),
            { title: 'Push PTE Apps — Select Target Environment', placeHolder: 'Choose a BC environment' },
        );
        if (!picked) { return; }
        target = picked.target;
    }

    // Delay (optional — driven by al-pocket-tools.deploy.delayMinutes setting)
    const delayMinutes = await promptDelay(target.label);
    if (delayMinutes === null) { return; }
    if (delayMinutes > 0) {
        const proceeded = await waitWithCountdown(target.label, delayMinutes * 60_000);
        if (!proceeded) { return; }
    }

    // Auth before progress — device code flow needs interactive UI
    let token: string;
    try {
        token = await getAccessToken(secrets, target.tenantId);
    } catch (err) {
        vscode.window.showErrorMessage(
            `AL Pocket Tools: Authentication failed — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
    }

    const errors: string[] = [];
    const timestamp = new Date().toLocaleString();

    output.appendLine(`\n[${timestamp}] Deploying to ${target.label} (${target.environmentName})`);
    output.appendLine(`  Tenant:  ${target.tenantId}`);
    output.show(true);

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deploying to ${target.label}`,
            cancellable: false,
        }, async progress => {
            progress.report({ message: 'Retrieving company...' });
            const company = await getFirstCompany(token, target.tenantId, target.environmentName);
            output.appendLine(`  Company: ${company.name}`);

            progress.report({ message: 'Sorting by dependencies...' });
            const manifests = new Map<string, AppManifest>();
            for (const uri of appUris) {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const manifest = readManifest(bytes);
                if (manifest) { manifests.set(uri.fsPath, manifest); }
            }
            const sortedUris = manifests.size > 0
                ? sortByDependencies(appUris, manifests)
                : [...appUris];

            output.appendLine('');
            const total = sortedUris.length;
            for (let i = 0; i < total; i++) {
                const uri = sortedUris[i];
                const fileName = path.basename(uri.fsPath);
                progress.report({ message: `(${i + 1}/${total}) ${fileName}`, increment: (1 / (total + 1)) * 100 });
                output.append(`  [${i + 1}/${total}] ${fileName} ... `);

                try {
                    const fileBytes = await vscode.workspace.fs.readFile(uri);
                    const operationUrl = await uploadApp(
                        token, target.tenantId, target.environmentName, company.id, fileBytes, fileName
                    );
                    if (operationUrl) {
                        progress.report({ message: `Waiting for ${fileName}...` });
                        output.append('deploying... ');
                        await pollOperationStatus(token, operationUrl);
                    }
                    output.appendLine('OK');
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    output.appendLine(`FAILED — ${msg}`);
                    errors.push(`${fileName}: ${msg}`);
                }
            }
        });
    } catch (err) {
        vscode.window.showErrorMessage(
            `AL Pocket Tools: Deployment failed — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
    }

    if (errors.length === 0) {
        output.appendLine(`\n  Result: ${appUris.length} app${appUris.length === 1 ? '' : 's'} deployed successfully.`);
        vscode.window.showInformationMessage(
            `AL Pocket Tools: ${appUris.length} app${appUris.length === 1 ? '' : 's'} deployed to ${target.label} successfully.`
        );
    } else {
        const failed = errors.length;
        const succeeded = appUris.length - failed;
        output.appendLine(`\n  Result: ${succeeded} succeeded, ${failed} failed.`);
        vscode.window.showErrorMessage(
            `AL Pocket Tools: ${succeeded} succeeded, ${failed} failed — ${errors.join('; ')}`
        );
    }
}
