# Started by Chrome (through mwf-adapter.cmd) as the extension's native messaging host. Compiles the
# WinUSB reader with the C# compiler that ships with Windows and runs it. Only the reader may write
# to stdout: everything else goes to stderr, which Chrome logs.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'mwf-adapter.cs') -WarningAction SilentlyContinue | Out-Null
  [MwfAdapter]::Run()
} catch {
  [Console]::Error.WriteLine("mwf-adapter: $_")
  exit 1
}
