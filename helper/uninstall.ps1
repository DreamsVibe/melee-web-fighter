# Removes the GameCube adapter helper installed by install.ps1.
$ErrorActionPreference = 'Stop'
$name = 'com.melee_web_fighter.adapter'
foreach ($b in 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium') {
  $key = "HKCU:\Software\$b\NativeMessagingHosts\$name"
  if (Test-Path $key) { Remove-Item $key -Force }
}
$dest = Join-Path $env:LOCALAPPDATA 'melee-web-fighter\helper'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Write-Host "Removed $name"
