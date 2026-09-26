# Installs the GameCube adapter helper for Melee Web Fighter (Windows, current user, no admin).
#   powershell -ExecutionPolicy Bypass -File helper\install.ps1 [-ExtensionId <id>] [-ExtensionPath <dist folder>]
# Copies the helper to %LOCALAPPDATA%\melee-web-fighter\helper, writes the native messaging manifest,
# and registers it for Chrome (and Edge/Brave/Chromium if present). Undo with helper\uninstall.ps1.
param([string[]]$ExtensionId, [string]$ExtensionPath)
$ErrorActionPreference = 'Stop'
$name = 'com.melee_web_fighter.adapter'

# An unpacked extension's id is derived from its folder: sha256 of the UTF-16 path (drive letter
# upper-cased), first 32 hex digits mapped 0-f -> a-p.
function Get-UnpackedId([string]$path) {
  $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
  if ($full -match '^[a-z]:') { $full = $full.Substring(0, 1).ToUpper() + $full.Substring(1) }
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($full))
  -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}

if (-not $ExtensionId) {
  if (-not $ExtensionPath) { $ExtensionPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist' }
  $ExtensionId = @(Get-UnpackedId $ExtensionPath)
  Write-Host "Extension loaded unpacked from $ExtensionPath -> id $($ExtensionId[0])"
}

$dest = Join-Path $env:LOCALAPPDATA 'melee-web-fighter\helper'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'mwf-adapter.cs', 'mwf-adapter.ps1', 'mwf-adapter.cmd') { Copy-Item (Join-Path $PSScriptRoot $f) $dest -Force }

$manifestPath = Join-Path $dest "$name.json"
$manifest = [ordered]@{
  name = $name
  description = 'Melee Web Fighter GameCube adapter helper'
  path = (Join-Path $dest 'mwf-adapter.cmd')
  type = 'stdio'
  allowed_origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

$browsers = 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium'
foreach ($b in $browsers) {
  $key = "HKCU:\Software\$b\NativeMessagingHosts\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}
Write-Host "Installed $name to $dest"
Write-Host "Allowed extension(s): $($ExtensionId -join ', ')"
Write-Host 'Reload the extension in chrome://extensions, then turn Fox on (the settings page shows the adapter status).'
