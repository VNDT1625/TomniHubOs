param(
  [Parameter(Mandatory = $true)]
  [string] $SourceRoot,
  [Parameter(Mandatory = $true)]
  [string] $DestinationRoot
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$destination = [IO.Path]::GetFullPath($DestinationRoot)

if ($source.TrimEnd('\') -eq $destination.TrimEnd('\')) {
  throw 'DestinationRoot must be different from SourceRoot.'
}
if ($destination.StartsWith($source.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DestinationRoot must not be inside SourceRoot; that would recursively copy the benchmark.'
}
if (Test-Path -LiteralPath $destination) {
  throw "Destination already exists: $destination. Remove or rename it after verifying it is a benchmark copy."
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$copies = @('Tomny-GOLDEN', 'Tomny-Tomny', 'Tomny-Claude', 'Tomny-ChatGPT', 'Tomny-Kiro')
$excludedDirectories = @(
  'node_modules',
  'out',
  'dist',
  'build',
  'target',
  '.cache',
  '.turbo',
  '.tomni',
  '.tomny-runtime',
  '.mtui',
  '.git',
  '.tmp',
  '.tomny',
  '.tomnyagentic',
  '.omni',
  'benchmarks',
  'coverage',
  'data',
  'resources',
  '${env.ELECTRON_CACHE}',
  'temp',
  'logs'
)

foreach ($name in $copies) {
  $target = Join-Path $destination $name
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  $args = @(
    $source,
    $target,
    '/E',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NP',
    '/XF',
    '.env',
    '.env.*',
    '.tomny-runtime',
    '*.log',
    '*.patch'
  )
  # Bare directory names make robocopy exclude them at every depth, including
  # package-local node_modules/build folders.
  $args += '/XD'
  $args += $excludedDirectories
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Copy failed for $name with robocopy code $LASTEXITCODE." }
}

Write-Host "Created benchmark copies under $destination"
Write-Host 'Next: apply the identical bug fixture only to Tomny-Tomny, Tomny-Claude and Tomny-Kiro.'
