import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoundationTrustRuntime } from '@process/foundation/runKernel';
import {
  createGovernedWorkspaceMutationExecutor,
  type GovernedWorkspaceMutationDriver,
  GOVERNED_WORKSPACE_MUTATION_ORIGIN,
} from '@process/resources/nativeFile/governedWorkspaceMutation';

const roots: string[] = [];

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-governed-workspace-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createRuntime = (requireApprovalForMutation = false): FoundationTrustRuntime =>
  new FoundationTrustRuntime({
    actorId: () => 'account-1',
    policy: {
      allowedCapabilities: ['target.execute', 'workspace.write'],
      allowedNetworkHosts: [],
      trustedPackageIds: [],
      allowedOrigins: [GOVERNED_WORKSPACE_MUTATION_ORIGIN],
      requireApprovalForMutation,
      capabilityGrantTtlMs: 60_000,
      policyVersion: 'governed-workspace-mutation-test-v1',
    },
  });

const digestText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const createCommittedDriver = (transactionId: string): { writeText: GovernedWorkspaceMutationDriver['writeText'] } => ({
  writeText: vi.fn(async ({ relativePath, content }) => ({
    committed: true,
    transactionId,
    targetDigest: digestText(relativePath),
    contentDigest: digestText(content),
  })),
});

describe('governed workspace mutation executor', () => {
  it('writes only through an injected Main driver after one governed run and records a verified receipt', async () => {
    const workspaceRoot = await tempRoot();
    const trustRuntime = createRuntime();
    const kernel = trustRuntime.createRunKernel();
    const driver = createCommittedDriver('native-transaction-1');
    const executor = createGovernedWorkspaceMutationExecutor({
      trustRuntime,
      kernel,
      workspaceRoot,
      driver,
    });

    const result = await executor.writeText({
      runId: 'workspace-write-run-1',
      taskId: 'workspace-write-task-1',
      idempotencyKey: 'workspace-write-key-1',
      relativePath: 'src/app.ts',
      content: 'export const ready = true;\n',
    });

    expect(driver.writeText).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: path.resolve(workspaceRoot),
        relativePath: 'src/app.ts',
        grantId: expect.stringMatching(/^grant_workspace-write-run-1_/),
        content: 'export const ready = true;\n',
        expectedTargetDigest: digestText('src/app.ts'),
        expectedContentDigest: digestText('export const ready = true;\n'),
      })
    );
    expect(result.evidenceRef).toMatch(/^workspace-write:[a-f0-9]{64}:[a-f0-9]{64}$/);
    await expect(kernel.getEventsForAccount('account-1', 'workspace-write-run-1')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'outcome.verified' })])
    );
  });

  it("keeps a long valid run identifier's path-hashed evidence in the durable receipt", async () => {
    const workspaceRoot = await tempRoot();
    const trustRuntime = createRuntime();
    const kernel = trustRuntime.createRunKernel();
    const driver = createCommittedDriver('native-transaction-long-run');
    const executor = createGovernedWorkspaceMutationExecutor({ trustRuntime, kernel, workspaceRoot, driver });
    const runId = `r${'a'.repeat(159)}`;

    const result = await executor.writeText({
      runId,
      taskId: 'workspace-write-task-long-run',
      idempotencyKey: 'workspace-write-key-long-run',
      relativePath: 'src/app.ts',
      content: 'export const ready = true;\n',
    });

    await expect(kernel.getReceiptForAccount('account-1', runId)).resolves.toMatchObject({
      status: 'verified',
      evidenceRefs: expect.arrayContaining([result.evidenceRef, 'workspace-commit:native-transaction-long-run']),
    });
  });

  it('rejects an escaping path before it creates a run or calls the driver', async () => {
    const workspaceRoot = await tempRoot();
    const driver = createCommittedDriver('native-transaction-path-escape');
    const executor = createGovernedWorkspaceMutationExecutor({
      trustRuntime: createRuntime(),
      workspaceRoot,
      driver,
    });

    await expect(
      executor.writeText({
        runId: 'workspace-write-run-2',
        taskId: 'workspace-write-task-2',
        idempotencyKey: 'workspace-write-key-2',
        relativePath: '../outside.txt',
        content: 'blocked',
      })
    ).rejects.toMatchObject({ code: 'GOVERNED_WORKSPACE_MUTATION_PATH_DENIED' });
    expect(driver.writeText).not.toHaveBeenCalled();
  });

  it('rejects control-character paths before it creates a run or calls the driver', async () => {
    const workspaceRoot = await tempRoot();
    const driver = createCommittedDriver('native-transaction-control-character');
    const executor = createGovernedWorkspaceMutationExecutor({
      trustRuntime: createRuntime(),
      workspaceRoot,
      driver,
    });

    await expect(
      executor.writeText({
        runId: 'workspace-write-run-control-character',
        taskId: 'workspace-write-task-control-character',
        idempotencyKey: 'workspace-write-key-control-character',
        relativePath: 'src/unsafe\u0000name.ts',
        content: 'blocked',
      })
    ).rejects.toMatchObject({ code: 'GOVERNED_WORKSPACE_MUTATION_PATH_DENIED' });
    expect(driver.writeText).not.toHaveBeenCalled();
  });

  it('fails closed before the injected driver when the composed Trust policy still requires mutation approval', async () => {
    const workspaceRoot = await tempRoot();
    const driver = createCommittedDriver('native-transaction-approval-required');
    const trustRuntime = createRuntime(true);
    const executor = createGovernedWorkspaceMutationExecutor({
      trustRuntime,
      kernel: trustRuntime.createRunKernel(),
      workspaceRoot,
      driver,
    });

    await expect(
      executor.writeText({
        runId: 'workspace-write-run-3',
        taskId: 'workspace-write-task-3',
        idempotencyKey: 'workspace-write-key-3',
        relativePath: 'blocked.txt',
        content: 'blocked',
      })
    ).rejects.toMatchObject({ code: 'GOVERNED_WORKSPACE_MUTATION_RUN_FAILED' });
    expect(driver.writeText).not.toHaveBeenCalled();
  });

  it('revokes the native effect grant once the completed mutation has recorded its receipt', async () => {
    const workspaceRoot = await tempRoot();
    const trustRuntime = createRuntime();
    const driver = createCommittedDriver('native-transaction-revoke-grant');
    const executor = createGovernedWorkspaceMutationExecutor({
      trustRuntime,
      kernel: trustRuntime.createRunKernel(),
      workspaceRoot,
      driver,
    });

    await executor.writeText({
      runId: 'workspace-write-run-revoke-grant',
      taskId: 'workspace-write-task-revoke-grant',
      idempotencyKey: 'workspace-write-key-revoke-grant',
      relativePath: 'src/app.ts',
      content: 'export const ready = true;\n',
    });
    const [{ grantId }] = vi.mocked(driver.writeText).mock.calls.map(([input]) => input);

    await expect(
      trustRuntime.trustBroker.inspectFinalFilesystemEffect({
        runId: 'workspace-write-run-revoke-grant',
        taskId: 'workspace-write-task-revoke-grant',
        actorId: 'account-1',
        operation: 'filesystem',
        targetId: 'governed-workspace-mutation',
        requestedCapabilities: ['workspace.write'],
        workspaceScope: path.resolve(workspaceRoot),
        policyVersion: trustRuntime.policyVersion,
        idempotencyKey: 'workspace-write-key-revoke-grant',
        reason: 'Write a consent-approved workspace file through the governed native driver.',
        filePath: path.resolve(workspaceRoot, 'src/app.ts'),
        origin: GOVERNED_WORKSPACE_MUTATION_ORIGIN,
        grantId,
      })
    ).resolves.toMatchObject({ decision: 'deny', reasonCode: 'FILESYSTEM_GRANT_INVALID' });
  });
});
