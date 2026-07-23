param(
  [Parameter(Mandatory = $true)]
  [string] $TargetRoot,
  [switch] $SkipTypecheck
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $TargetRoot).Path
$module = (Join-Path $root 'packages\desktop\src\process\ide\traceContextBuilder.ts').Replace('\', '/')
$probe = @"
import { buildTraceContext } from '$module';
const node = { id: 'src/auth/authApi.ts', label: 'authApi.ts', group: 'src', layer: 'api', summary: 'Auth API', summarySource: 'llm', tags: [], symbols: [{ name: 'authApi', kind: 'function', line: 1 }], language: 'typescript', importedBy: 1, fingerprint: 'fp' };
const graph = { rootPath: '/repo', version: 2, builtAt: 1, nodes: [node], edges: [], tours: [], truncated: false, fileCount: 1 };
const event = { kind: 'network', method: 'GET', url: 'http://localhost/api/auth/login', status: 404, at: 2 };
const trace = { platform: 'web', rootPath: '/repo', events: [event], firstError: event, startedAt: 1, stoppedAt: 3 };
const pack = buildTraceContext(trace, graph);
console.log(JSON.stringify({ mapped: pack.slices.some((slice) => slice.path === node.id), has404: pack.renderedContext.includes('404') }));
"@

$probeOutput = (& bun -e $probe 2>&1 | Out-String).Trim()
$probeExit = $LASTEXITCODE
$probeResult = if ($probeExit -eq 0) { $probeOutput | ConvertFrom-Json } else { $null }

Push-Location $root
try {
  & bunx vitest run tests/unit/ide/traceContextBuilder.test.ts tests/unit/ide/quickTestBuffer.test.ts | Out-Host
  $testExit = $LASTEXITCODE
  $typeExit = 0
  if (-not $SkipTypecheck) {
    & bunx tsc --noEmit | Out-Host
    $typeExit = $LASTEXITCODE
  }
  $changedFiles = @(git status --porcelain).Count
} finally {
  Pop-Location
}

$result = [ordered]@{
  target = $root
  maps404ToApiService = [bool]($probeResult -and $probeResult.mapped)
  renders404Evidence = [bool]($probeResult -and $probeResult.has404)
  probeExit = $probeExit
  testsPass = $testExit -eq 0
  typecheckPass = $typeExit -eq 0
  changedFiles = $changedFiles
}
$result | ConvertTo-Json
if (-not $result.maps404ToApiService -or -not $result.testsPass -or -not $result.typecheckPass) { exit 1 }
