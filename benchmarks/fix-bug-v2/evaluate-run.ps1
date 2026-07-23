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
const makeNode = (id, layer, label) => ({
  id, label, group: 'src', layer, summary: label, summarySource: 'llm', tags: [],
  symbols: [{ name: label.replace(/\\.ts$/, ''), kind: 'function', line: 1 }],
  language: 'typescript', importedBy: 1, fingerprint: id,
});
const unrelated = ['account', 'admin', 'analytics', 'audit', 'catalog', 'customer', 'inventory', 'orders']
  .map((name) => makeNode('src/aaa-' + name + '/' + name + 'Api.ts', 'api', name + 'Api.ts'));
const billingApi = makeNode('src/billing/billingApi.ts', 'api', 'billingApi.ts');
const billingService = makeNode('src/billing/billingService.ts', 'service', 'billingService.ts');
const graph = {
  rootPath: '$($root.Replace('\', '/'))', version: 2, builtAt: 1,
  nodes: [...unrelated, billingApi, billingService], edges: [], tours: [], truncated: false, fileCount: 10,
};
const event = {
  kind: 'network', method: 'GET', url: 'http://localhost/api/v1/billing/invoices/42', status: 404, at: 2,
};
const trace = {
  platform: 'web', rootPath: graph.rootPath, events: [event], firstError: event, startedAt: 1, stoppedAt: 3,
};
const pack = buildTraceContext(trace, graph);
const paths = pack.slices.map((slice) => slice.path);
console.log(JSON.stringify({
  correctBillingMapped: paths.includes(billingApi.id) || paths.includes(billingService.id),
  unrelatedApiCount: paths.filter((path) => path.includes('/aaa-')).length,
  has404Evidence: pack.renderedContext.includes('404'),
  sliceCount: pack.sliceCount,
  paths,
}));
"@

$probeOutput = (& bun -e $probe 2>&1 | Out-String).Trim()
$probeExit = $LASTEXITCODE
$probeResult = if ($probeExit -eq 0) { $probeOutput | ConvertFrom-Json } else { $null }

Push-Location $root
try {
  & bunx vitest run tests/unit/ide/traceContextBuilder.test.ts tests/unit/ide/quickTestService.test.ts | Out-Host
  $testExit = $LASTEXITCODE
  $typeExit = 0
  if (-not $SkipTypecheck) {
    & bunx tsc --noEmit | Out-Host
    $typeExit = $LASTEXITCODE
  }
  $changedFiles = @(git status --porcelain 2>$null).Count
} finally {
  Pop-Location
}

$result = [ordered]@{
  target = $root
  correctBillingMapped = [bool]($probeResult -and $probeResult.correctBillingMapped)
  unrelatedApiCount = if ($probeResult) { [int]$probeResult.unrelatedApiCount } else { -1 }
  has404Evidence = [bool]($probeResult -and $probeResult.has404Evidence)
  sliceCount = if ($probeResult) { [int]$probeResult.sliceCount } else { -1 }
  paths = if ($probeResult) { @($probeResult.paths) } else { @() }
  probeExit = $probeExit
  focusedTestsPass = $testExit -eq 0
  typecheckPass = $typeExit -eq 0
  changedFiles = $changedFiles
}
$result | ConvertTo-Json -Depth 4

if (
  -not $result.correctBillingMapped -or
  $result.unrelatedApiCount -ne 0 -or
  -not $result.has404Evidence -or
  -not $result.focusedTestsPass -or
  -not $result.typecheckPass
) { exit 1 }

