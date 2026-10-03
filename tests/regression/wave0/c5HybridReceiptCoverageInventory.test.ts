import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

const readSource = (relativePath: string): string => readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8');

describe('C5 hybrid parent/child receipt coverage inventory', () => {
  it('distinguishes the deterministic durable-replay fixture from the still-unreachable hybrid product journey', () => {
    const receiptFixture = readSource('tests/integration/c5HybridReceiptJourney.test.ts');
    const actionExecution = readSource(
      'packages/desktop/src/process/resources/packageCapability/goalCapability/surfaceAiActionExecution.ts'
    );
    const hubWorkspace = readSource('packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx');

    // The fixture proves parent/child receipt lineage and deterministic replay with
    // a temporary journal plus an inline test executor. It does not open a remote
    // session, transfer a product artifact, or invoke a remote Surface runtime.
    expect(receiptFixture).toContain(
      "const directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-c5-hybrid-receipt-'));"
    );
    expect(receiptFixture).toContain('new JsonlDurableEventStore(journalPath)');
    expect(receiptFixture).toContain('const restartedKernel = new RunKernel({');
    expect(receiptFixture).toContain('remoteExecutions += 1;');
    expect(receiptFixture).toContain("return { evidenceRefs: ['remote-output:c5-hybrid'] };");
    expect(receiptFixture).not.toContain('remoteSession');
    expect(receiptFixture).not.toContain('artifactTransfer');

    // The sole action composition remains local-only. The Hub can present a
    // remote planning result, but does not expose a remote execution action.
    expect(actionExecution).toContain(
      "if (step.kind !== 'execute-local') throw new SurfaceAiActionExecutionError('SURFACE_AI_ACTION_STEP_INVALID');"
    );
    expect(actionExecution).toContain("constraints: ['offline_only', 'private_only', `target:${input.targetId}`],");
    expect(actionExecution).toContain('or enables a cloud Surface placement.');
    expect(hubWorkspace).toContain("step.kind === 'execute-remote'");
    expect(hubWorkspace).toContain("step.kind === 'execute-local' &&");
    expect(hubWorkspace).not.toContain(
      "step.kind === 'execute-remote' &&\n                Boolean(window.electronAPI?.hubGoalSurfaceAction)"
    );
  });
});
