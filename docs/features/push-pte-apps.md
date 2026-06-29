# Push PTE Apps to Business Central

Uploads one or more `.app` files directly to a Business Central SaaS environment without bccontainerhelper. Authentication uses the same device code flow as bccontainerhelper — a browser opens to `microsoft.com/devicelogin`, you enter a short code, and the session is cached for future runs.

## How to trigger

**Command palette:** `AL Pocket Tools: Push to Business Central...`

**Explorer context menu:** Right-click any `.app` file (or multi-select `.app` files) → `AL Pocket Tools` → `Push to Business Central...`

## UX flow

1. **File selection** — if launched from the command palette, a file picker opens so you can select one or more `.app` files. If launched by right-clicking a file in the Explorer, those files are used directly (multi-select supported).

2. **Environment selection** — the command reads your saved launch configurations from `al-pocket-tools.launch.configurations` (saved via *Save Launch Configuration*) and filters for cloud configurations (those with a `tenant` and `environmentName` field). If only one cloud environment is found it is used automatically; if multiple are found, a quick pick lets you choose.

3. **Authentication** — on first run (or after the cached session expires), a modal dialog shows the device code and opens `microsoft.com/devicelogin` in your browser. Enter the code, approve the request, then click **Done** in VS Code. The refresh token is stored in VS Code's encrypted `SecretStorage` so subsequent runs are silent — no browser prompt needed until the token expires (~90 days).

4. **Dependency sort** — before uploading, the command reads `NavxManifest.xml` from inside each `.app` file (ZIP format) to extract app IDs and dependency references. Files are reordered so that each app's dependencies are deployed first. Files whose manifest cannot be read are appended at the end in original order — the same fallback behaviour as bccontainerhelper.

5. **Upload** — each `.app` file is uploaded in sorted order to the BC Automation API. If the server returns an asynchronous operation URL, the command polls it (up to 2 minutes) before moving on to the next file.

6. **Result** — a notification reports how many apps were deployed successfully. Any failures are listed inline.

## Prerequisites

- At least one BC SaaS launch configuration saved in `al-pocket-tools.launch.configurations`. Save one by right-clicking inside a configuration in `launch.json` and choosing *Save Launch Configuration*. The configuration must have both a `tenant` (AAD tenant ID or domain) and an `environmentName` field.
- Your account must have the **D365 AUTOMATION** permission set (or equivalent) in the target BC environment to use the Automation API.

## Settings

| Setting | Default | Description |
|---|---|---|
| `al-pocket-tools.deploy.clientId` | `1950a258-227b-4e31-a9cf-717495945fc2` | Azure AD client ID for the device code sign-in. See *Authentication notes* below. |

## Authentication notes

### Why device code flow, not VS Code's built-in Microsoft sign-in

VS Code's built-in `microsoft` authentication provider works well for Microsoft Graph and Azure management scopes, but enterprise BC tenants often have strict app consent policies that reject tokens issued for arbitrary scopes from VS Code's own app registration. Device code flow targets the Azure AD tenant directly, matching exactly what bccontainerhelper does.

### Why `1950a258-227b-4e31-a9cf-717495945fc2` (Azure PowerShell)

This is the same client ID navcontainerhelper uses as its default for device code authentication (source: [`/Auth/New-BcAuthContext.ps1`](https://github.com/microsoft/navcontainerhelper)). It is a Microsoft first-party app registered in Azure AD tenants that use the Azure PowerShell module — which covers most BC customer tenants. Using the same client ID means no additional admin consent is required if the tenant already works with bccontainerhelper.

### What to do if sign-in still fails (AADSTS700016)

`AADSTS700016` means the client app has no service principal in the tenant. Options:

1. **Ask your tenant admin** to run the following once from PowerShell. This registers the Azure PowerShell service principal:
   ```powershell
   Connect-AzAccount -TenantId <your-tenant-id>
   ```

2. **Use your own registered app** — register a multi-tenant Azure AD app with `https://api.businesscentral.dynamics.com/user_impersonation` as a delegated permission, then set `al-pocket-tools.deploy.clientId` to your app's client ID. Enable "Allow public client flows" in the app's Authentication settings so device code flow works.

### Scope used

`https://api.businesscentral.dynamics.com/.default offline_access` — matches navcontainerhelper's scope. The `offline_access` part is what enables the refresh token so re-authentication is not required on every run.

## Notes

- Apps are automatically reordered by dependency before upload — you do not need to select them in any particular order.
- The upload uses the first company found in the target environment. This is the standard approach for PTE deployment via the Automation API.
- Files are uploaded sequentially, not in parallel, to avoid race conditions in the BC deployment pipeline.
