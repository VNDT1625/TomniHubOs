param(
  [Parameter(Mandatory = $true)]
  [string] $TargetRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $TargetRoot).Path
if ([IO.Path]::GetFileName($root).ToUpperInvariant() -eq 'AIONUI-GOLDEN') {
  throw 'Refusing to inject the benchmark bug into AionUi-GOLDEN.'
}

$file = Join-Path $root 'packages\desktop\src\process\ide\traceContextBuilder.ts'
$text = Get-Content -LiteralPath $file -Raw
$needle = 'ev.status >= 400'
$count = ([regex]::Matches($text, [regex]::Escape($needle))).Count
if ($count -ne 2) {
  throw "Expected exactly two fixed 4xx predicates in $file, found $count. Refusing to modify an unknown revision."
}

$updated = $text.Replace($needle, 'ev.status >= 500')
Set-Content -LiteralPath $file -Value $updated -NoNewline
Write-Host "Applied the identical 404-routing bug to $root"
