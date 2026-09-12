$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$archiveName = 'arc-radar-terminal-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip'
$archivePath = Join-Path (Split-Path -Parent $projectRoot) $archiveName
$files = @(
 'package.json', 'package-lock.json', '.gitignore', '.env.example', 'BASLAT.cmd',
 'README.md', 'VERIFIED-DATA-FLOW.md', 'THIRD-PARTY.md',
 'public/index.html', 'public/terminal.css', 'public/terminal.js', 'public/ui-utils.js', 'public/sources.js',
 'src/server.js', 'src/db.js', 'src/direct.js', 'src/providers.js', 'src/market-service.js', 'src/config.js', 'src/chart-engine.js', 'src/rpc-history.js', 'src/dex-markets.js',
 'src/snapshots.js', 'src/worker.js', 'test/snapshots.test.mjs',
 'scripts/browser-check.mjs', 'scripts/package.ps1', 'scripts/audit-charts.mjs',
 'test/correctness.test.mjs', 'test/direct.test.mjs', 'test/frontend.test.mjs', 'test/chart-engine.test.mjs', 'test/dex.test.mjs',
 'test/markets.test.mjs', 'test/provider-errors.test.mjs', 'test/persistence.test.mjs'
)
$staging = Join-Path ([IO.Path]::GetTempPath()) ('arc-radar-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
 foreach ($relative in $files) {
  $absolute = (Resolve-Path -LiteralPath (Join-Path $projectRoot $relative)).Path
  if (-not $absolute.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'File outside project' }
  $destination = Join-Path $staging $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $absolute -Destination $destination
 }
 Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archivePath -CompressionLevel Optimal -Force
} finally {
 Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
