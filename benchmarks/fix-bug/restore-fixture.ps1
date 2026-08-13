param(
  [Parameter(Mandatory = $true)]
  [string] $TargetRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $TargetRoot).Path
if ([IO.Path]::GetFileName($root).ToUpperInvariant() -eq 'TOMNY-GOLDEN') {
  throw 'Refusing to modify Tomny-GOLDEN.'
}

$file = Join-Path $root 'packages\desktop\src\process\ide\traceContextBuilder.ts'
$text = Get-Content -LiteralPath $file -Raw
$needle = 'ev.status >= 500'
$count = ([regex]::Matches($text, [regex]::Escape($needle))).Count
if ($count -eq 0) {
  Write-Host "No benchmark predicate remains in $root"
  exit 0
}
if ($count -ne 2) { throw "Found $count benchmark predicates; refusing to modify an unknown revision." }
Set-Content -LiteralPath $file -Value $text.Replace($needle, 'ev.status >= 400') -NoNewline
Write-Host "Restored the fixed 4xx routing in $root"
