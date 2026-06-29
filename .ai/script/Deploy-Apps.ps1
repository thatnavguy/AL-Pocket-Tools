<#
.SYNOPSIS
    Unified app deployment script for multiple tenants
.DESCRIPTION
    Loads tenant configuration from tenants.json and allows selection of target tenant.
    Publishes .app files to Business Central after a specified wait period.

    Token caching:
        Authentication tokens are cached per tenant in token.json (same folder as this script).
        The 'tokenValidityDays' setting in tenants.json controls how long a cached token is
        trusted before forcing a new device login. For example, set it to 2 to re-authenticate
        if the cached token is more than 2 days old. If omitted, the cached token is used
        until it is rejected by the server (up to ~90 days).

    tenants.json settings:
        appsFolder        - Path to the folder containing .app files. Relative paths are
                            resolved from the script directory.
        tokenValidityDays - (Optional) Maximum age in days before forcing re-authentication.
        environment       - (Optional) Global fallback environment name for tenants that do
                            not define their own environments list.
#>

param(
    [string]$TenantName,
    [int]$WaitMinutes
)

Clear-Host

#region Helper Functions

function Get-CachedRefreshToken {
    param([string]$CachePath, [string]$TenantId, [int]$ValidityDays = 0)

    if (-not (Test-Path $CachePath)) { return $null }
    try {
        $cache = Get-Content $CachePath -Raw | ConvertFrom-Json
        $prop = $cache.PSObject.Properties[$TenantId]
        if ($prop) {
            $entry = $prop.Value
            if ($ValidityDays -gt 0 -and $entry.savedAt) {
                $age = (Get-Date) - [datetime]::Parse($entry.savedAt)
                if ($age.TotalDays -gt $ValidityDays) {
                    Write-Host "Cached token is $([int]$age.TotalDays) day(s) old (limit: $ValidityDays) - will re-authenticate." -ForegroundColor Yellow
                    return $null
                }
            }
            return $entry.refreshToken
        }
    }
    catch { }
    return $null
}

function Save-CachedRefreshToken {
    param([string]$CachePath, [string]$TenantId, [string]$RefreshToken)

    if ([string]::IsNullOrWhiteSpace($RefreshToken)) { return }
    try {
        $cache = if (Test-Path $CachePath) {
            Get-Content $CachePath -Raw | ConvertFrom-Json
        } else {
            [PSCustomObject]@{}
        }
        $cache | Add-Member -NotePropertyName $TenantId -NotePropertyValue ([PSCustomObject]@{
            refreshToken = $RefreshToken
            savedAt      = (Get-Date -Format 'o')
        }) -Force
        $cache | ConvertTo-Json -Depth 5 | Set-Content $CachePath
    }
    catch {
        Write-Host "  Warning: Could not save token cache - $_" -ForegroundColor Yellow
    }
}

#endregion

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tokenCachePath = Join-Path $scriptDir "token.json"

# Load tenant configuration
$tenantsJsonPath = Join-Path $scriptDir "tenants.json"
if (-not (Test-Path $tenantsJsonPath)) {
    Write-Host "Error: tenants.json not found at $tenantsJsonPath" -ForegroundColor Red
    exit 1
}

try {
    $config = Get-Content $tenantsJsonPath | ConvertFrom-Json
}
catch {
    Write-Host "Error: Failed to parse tenants.json - $_" -ForegroundColor Red
    exit 1
}

$tenants = $config.tenants
$globalEnvironment = $config.settings.environment  # fallback for tenants without environments defined

$rawAppsFolder = $config.settings.appsFolder
$appsFolder = if ([System.IO.Path]::IsPathRooted($rawAppsFolder)) {
    $rawAppsFolder
} else {
    Join-Path $scriptDir $rawAppsFolder
}

# Select tenant
if ([string]::IsNullOrWhiteSpace($TenantName)) {
    Write-Host "Available Tenants:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $tenants.Count; $i++) {
        Write-Host "$($i + 1). $($tenants[$i].name)"
    }
    Write-Host ""
    Write-Host "Select tenant (1-$($tenants.Count)): " -ForegroundColor Yellow -NoNewline

    $selection = Read-Host

    if (-not ($selection -as [int]) -or $selection -lt 1 -or $selection -gt $tenants.Count) {
        Write-Host "Invalid selection." -ForegroundColor Red
        exit 1
    }

    $selectedTenant = $tenants[$selection - 1]
}
else {
    $selectedTenant = $tenants | Where-Object { $_.name -eq $TenantName }
    if (-not $selectedTenant) {
        Write-Host "Tenant '$TenantName' not found." -ForegroundColor Red
        exit 1
    }
}

$tenantId = $selectedTenant.id
$tenantDisplayName = $selectedTenant.name

# Select environment(s)
$tenantEnvironments = $selectedTenant.environments

if (-not $tenantEnvironments -or $tenantEnvironments.Count -eq 0) {
    if ([string]::IsNullOrWhiteSpace($globalEnvironment)) {
        Write-Host "Error: No environments defined for '$tenantDisplayName' and no global fallback in settings." -ForegroundColor Red
        exit 1
    }
    $selectedEnvironments = @($globalEnvironment)
    Write-Host ""
    Write-Host "Using global environment: $($selectedEnvironments[0])" -ForegroundColor Gray
}
elseif ($tenantEnvironments.Count -eq 1) {
    $selectedEnvironments = @($tenantEnvironments[0])
    Write-Host ""
    Write-Host "Using environment: $($selectedEnvironments[0])" -ForegroundColor Gray
}
else {
    Write-Host ""
    Write-Host "Available Environments for $tenantDisplayName`:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $tenantEnvironments.Count; $i++) {
        Write-Host "  $($i + 1). $($tenantEnvironments[$i])"
    }
    Write-Host ""
    Write-Host "Select environment(s) - enter number(s) separated by commas (e.g. 1 or 1,3): " -ForegroundColor Yellow -NoNewline
    $envInput = Read-Host

    $selectedEnvironments = @()
    $envIndices = $envInput -split '[,\s]+' | Where-Object { $_ -match '^\d+$' }
    foreach ($idx in $envIndices) {
        $i = [int]$idx
        if ($i -ge 1 -and $i -le $tenantEnvironments.Count) {
            $envName = $tenantEnvironments[$i - 1]
            if ($selectedEnvironments -notcontains $envName) {
                $selectedEnvironments += $envName
            }
        }
        else {
            Write-Host "Warning: '$idx' is out of range and will be skipped." -ForegroundColor Yellow
        }
    }

    if ($selectedEnvironments.Count -eq 0) {
        Write-Host "No valid environment selected." -ForegroundColor Red
        exit 1
    }
}

# Get wait time
if ($WaitMinutes -eq 0) {
    $defaultWait = $selectedTenant.defaultWaitMinutes

    if ($null -eq $defaultWait) {
        Write-Host ""
        Write-Host "Enter the number of minutes to wait before publishing (or press Enter to skip wait): " -ForegroundColor Yellow -NoNewline
        $input = Read-Host

        if ([string]::IsNullOrWhiteSpace($input)) {
            $waitSeconds = 0
        }
        else {
            if (-not ($input -as [int]) -or $input -le 0) {
                Write-Host "Invalid input. Using 0 minute wait." -ForegroundColor Yellow
                $waitSeconds = 0
            }
            else {
                $waitSeconds = [int]$input * 60
            }
        }
    }
    else {
        Write-Host ""
        Write-Host "Using default wait time of $defaultWait minute(s) for $tenantDisplayName" -ForegroundColor Gray
        $waitSeconds = $defaultWait * 60
    }
}
else {
    $waitSeconds = $WaitMinutes * 60
}

# Set location to apps folder
if (-not (Test-Path $appsFolder)) {
    Write-Host "Error: Apps folder not found at $appsFolder" -ForegroundColor Red
    Write-Host "Please create the folder or update appsFolder in tenants.json" -ForegroundColor Yellow
    exit 1
}

Set-Location $appsFolder

# Get all .app files
$appFiles = Get-ChildItem -Recurse -Filter *.app -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }

if (-not $appFiles) {
    Write-Host "Error: No .app files found in $appsFolder" -ForegroundColor Red
    exit 1
}

if ($appFiles -is [string]) {
    $appFiles = @($appFiles)
}

# Sort app files by dependencies
try {
    $sortedAppFiles = Sort-AppFilesByDependencies -appFiles $appFiles
}
catch {
    Write-Host "Warning: Could not sort by dependencies ($_), using default order" -ForegroundColor Yellow
    $sortedAppFiles = $appFiles
}

# Calculate runtime
$runTime = if ($waitSeconds -gt 0) { (Get-Date).AddSeconds($waitSeconds) } else { Get-Date }

# Display confirmation
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Apps to deploy:" -ForegroundColor Yellow
$sortedAppFiles | ForEach-Object { Write-Host "  - $(Split-Path -Leaf $_)" }
Write-Host ""
Write-Host "Tenant: " -NoNewline -ForegroundColor Yellow
Write-Host $tenantDisplayName -ForegroundColor Cyan
Write-Host "Tenant ID: " -NoNewline -ForegroundColor Yellow
Write-Host $tenantId -ForegroundColor Cyan
Write-Host "Environment(s): " -NoNewline -ForegroundColor Yellow
Write-Host ($selectedEnvironments -join ", ") -ForegroundColor Cyan
Write-Host ""

if ($waitSeconds -gt 0) {
    Write-Host "Wait time: " -NoNewline -ForegroundColor Yellow
    Write-Host "$([int]($waitSeconds / 60)) minute(s)" -ForegroundColor Cyan
    Write-Host "Deployment will start at: " -NoNewline -ForegroundColor Yellow
    Write-Host $runTime -ForegroundColor Cyan
}
else {
    Write-Host "Wait time: " -NoNewline -ForegroundColor Yellow
    Write-Host "None" -ForegroundColor Cyan
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press 'y' to confirm, or any other key to cancel: " -ForegroundColor Yellow -NoNewline

$confirmation = Read-Host
if ($confirmation -ne 'y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

# Get authentication - reuse cached refresh token if available
Write-Host ""
$authContext = $null
$tokenValidityDays = if ($config.settings.tokenValidityDays) { [int]$config.settings.tokenValidityDays } else { 0 }
$cachedToken = Get-CachedRefreshToken -CachePath $tokenCachePath -TenantId $tenantId -ValidityDays $tokenValidityDays
if ($cachedToken) {
    Write-Host "Using cached token for $tenantDisplayName..." -ForegroundColor Yellow -NoNewline
    try {
        $authContext = New-BcAuthContext -tenantID $tenantId -refreshToken $cachedToken
        Write-Host " OK" -ForegroundColor Green
        Save-CachedRefreshToken -CachePath $tokenCachePath -TenantId $tenantId -RefreshToken $authContext.RefreshToken
    }
    catch {
        Write-Host " Expired or invalid, falling back to device login..." -ForegroundColor Yellow
        $authContext = $null
    }
}

if (-not $authContext) {
    Write-Host "Retrieving authentication token..." -ForegroundColor Yellow
    try {
        $authContext = New-BcAuthContext -tenantID $tenantId -includeDeviceLogin
        Save-CachedRefreshToken -CachePath $tokenCachePath -TenantId $tenantId -RefreshToken $authContext.RefreshToken
    }
    catch {
        Write-Host "Error: Failed to authenticate - $_" -ForegroundColor Red
        exit 1
    }
}

# Wait if needed
if ($waitSeconds -gt 0) {
    Write-Host ""
    $remainingSeconds = $waitSeconds
    while ($remainingSeconds -gt 0) {
        $minutes = [int]($remainingSeconds / 60)
        $seconds = $remainingSeconds % 60
        Write-Host "`rWaiting: $($minutes)m $($seconds)s remaining... " -NoNewline -ForegroundColor Yellow
        Start-Sleep -Seconds 1
        $remainingSeconds--
    }
    Write-Host "`nWait complete!`n" -ForegroundColor Green
}

# Refresh auth context
Write-Host "Refreshing authentication token..." -ForegroundColor Yellow
try {
    $newAuthContext = New-BcAuthContext -tenantID $tenantId -refreshToken $authContext.RefreshToken
    Save-CachedRefreshToken -CachePath $tokenCachePath -TenantId $tenantId -RefreshToken $newAuthContext.RefreshToken
}
catch {
    Write-Host "Error: Failed to refresh token - $_" -ForegroundColor Red
    exit 1
}

# Publish
Write-Host ""
Write-Host "Publishing apps..." -ForegroundColor Yellow

$totalSuccess = 0
$totalFailure = 0

foreach ($env in $selectedEnvironments) {
    Write-Host ""
    Write-Host "--- Environment: $env ---" -ForegroundColor Magenta

    $successCount = 0
    $failureCount = 0

    foreach ($appFile in $sortedAppFiles) {
        $appName = Split-Path -Leaf $appFile
        Write-Host "  Publishing: $appName" -ForegroundColor Cyan -NoNewline

        try {
            Publish-PerTenantExtensionApps `
                -bcAuthContext $newAuthContext `
                -environment $env `
                -appFiles $appFile
            Write-Host " [OK]" -ForegroundColor Green
            $successCount++
        }
        catch {
            Write-Host " [FAILED]" -ForegroundColor Red
            Write-Host "    Error: $_" -ForegroundColor Red
            $failureCount++
        }
    }

    Write-Host ""
    $envResultColor = if ($failureCount -gt 0) { "Yellow" } else { "Green" }
    Write-Host "  Result for $env`: $successCount succeeded, $failureCount failed" -ForegroundColor $envResultColor

    $totalSuccess += $successCount
    $totalFailure += $failureCount
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Successful: $totalSuccess" -ForegroundColor Green
Write-Host "Total Failed: $totalFailure" -ForegroundColor $(if ($totalFailure -gt 0) { "Red" } else { "Green" })
Write-Host "========================================" -ForegroundColor Cyan

# Ask to delete apps if all deployments were successful
if ($totalFailure -eq 0 -and $totalSuccess -gt 0) {
    Write-Host ""
    Write-Host "All apps deployed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Delete the deployed apps from $appsFolder ? (y/n): " -ForegroundColor Yellow -NoNewline

    $deleteConfirmation = Read-Host

    if ($deleteConfirmation -eq 'y') {
        Write-Host ""
        Write-Host "Deleting apps..." -ForegroundColor Yellow

        $deletedCount = 0
        foreach ($appFile in $sortedAppFiles) {
            try {
                $appName = Split-Path -Leaf $appFile
                Remove-Item -Path $appFile -Force -ErrorAction Stop
                Write-Host "  Deleted: $appName" -ForegroundColor Green
                $deletedCount++
            }
            catch {
                Write-Host "  Failed to delete: $appName - $_" -ForegroundColor Red
            }
        }

        Write-Host ""
        Write-Host "Deleted $deletedCount app(s)." -ForegroundColor Green
    }
    else {
        Write-Host "Apps retained for manual cleanup." -ForegroundColor Gray
    }
}
