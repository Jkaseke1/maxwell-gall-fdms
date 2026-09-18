[CmdletBinding()]
param(
  [string]$OutputDirectory = (Join-Path (Get-Location) 'deployment\MaxwellGlass-Production')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -eq $false) {
  throw 'Output directory must be inside the Maxwell Glass workspace.'
}
if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null

Push-Location $root
try {
  if (-not (Test-Path 'dashboard-production\node_modules')) { npm ci --prefix dashboard-production }
  npm run build --prefix dashboard-production
} finally { Pop-Location }

$files = @(
  'package.json', 'package-lock.json', '.env.maxwell-production.example',
  'MAXWELL_PRODUCTION_DEPLOYMENT.md', 'DEPLOYMENT_CHECKLIST.md',
  'scripts\maxwellProductionTransport.js', 'scripts\startMaxwellProduction.js',
  'scripts\installMaxwellProductionService.js',
  'server\production', 'src\signatures', 'dashboard-production\dist'
)
foreach ($relative in $files) {
  $source = Join-Path $root $relative
  if (-not (Test-Path $source)) { throw "Required deployment path is missing: $relative" }
  $destination = Join-Path $output $relative
  $parent = Split-Path -Parent $destination
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$readme = @'
MAXWELL GLASS PRODUCTION DEPLOYMENT PACKAGE

This package is for MAXWELL GLASS only: TIN 2000945150, production device 46158,
serial ZIMRAVD-1737. It contains no activation key, certificate, private key,
production state, or customer data.

On the customer PC:
1. Install Node.js 20 or later.
2. Copy this package to C:\MaxwellFDMS\app.
3. Run npm ci --omit=dev.
4. Copy .env.maxwell-production.example to .env.maxwell-production and fill in
   the production activation key, SMTP app password, and ZIMRA certificate paths.
5. Copy the production certificate and private key into the isolated directory
   named in the environment file. Never put them in source control.
6. Run npm run build --prefix dashboard-production only if rebuilding the UI.
7. Verify the device and fiscal day before opening it:
   node scripts/zimraProduction.js status
8. Install the service from an elevated PowerShell window:
   node scripts/installMaxwellProductionService.js

The service automatically closes the fiscal day before the ZIMRA time limit and
opens the next day only after ZIMRA confirms closure. Any GetConfig/GetStatus,
counter mismatch, pending receipt, validation error, certificate, network, or
ZIMRA acknowledgement error blocks fiscalization and is logged/alerted.

Do not copy sandbox files, Rapid Roots files, or any other .env file into this
installation. Keep C:\MaxwellFDMS\data, backups, and logs backed up daily.
'@
Set-Content -LiteralPath (Join-Path $output 'DEPLOYMENT_README.txt') -Value $readme -Encoding UTF8
$zip = "$output.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Package: $zip"
