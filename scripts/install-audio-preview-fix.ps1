$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$candidateRoot = Join-Path $projectRoot 'release\screen-layout\win-unpacked'
$installedRoot = Join-Path $env:LOCALAPPDATA 'Programs\recordly'
$installedExe = Join-Path $installedRoot 'Recordly.exe'
$running = Get-CimInstance Win32_Process -Filter "name='Recordly.exe'" | Where-Object { $_.ExecutablePath -eq $installedExe }
if ($running) { throw 'Recordly is still running. Save your project and exit before updating.' }
$files = @('Recordly.exe', 'resources\app.asar')
$backupRoot = Join-Path $projectRoot ('.tmp\audio-fix-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($relative in $files) {
    $source = Join-Path $candidateRoot $relative
    $destination = Join-Path $installedRoot $relative
    if (!(Test-Path -LiteralPath $source -PathType Leaf) -or !(Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Missing candidate or installed file: $relative" }
    $backupFile = Join-Path $backupRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $destination -Destination $backupFile
    if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $backupFile).Hash) { throw "Backup verification failed: $relative" }
}
try {
    foreach ($relative in $files) {
        $source = Join-Path $candidateRoot $relative
        $destination = Join-Path $installedRoot $relative
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $source).Hash) { throw "Installed hash mismatch: $relative" }
    }
} catch {
    foreach ($relative in $files) { Copy-Item -LiteralPath (Join-Path $backupRoot $relative) -Destination (Join-Path $installedRoot $relative) -Force }
    throw
}
$result = [ordered]@{ backup = $backupRoot; installed = $installedRoot; files = @($files | ForEach-Object { @{ path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $installedRoot $_)).Hash } }) }
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot '.tmp\audio-fix-install-result.json') -Encoding utf8
$result | ConvertTo-Json -Depth 4
