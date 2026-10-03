import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  executeFoundationHubRun,
  getFoundationKernel,
  type FoundationCoreRuntime,
} from '@process/bridge/foundationBridge';
import type { FoundationTrustRuntime, RunKernel } from '@process/foundation/runKernel';

/** Exact Main-only origin for a capability-bound local workspace mutation. */
export const GOVERNED_WORKSPACE_MUTATION_ORIGIN = 'tomny://governed-workspace-mutation';
export const GOVERNED_WORKSPACE_MUTATION_TARGET_ID = 'governed-workspace-mutation';

const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_RELATIVE_PATH_LENGTH = 512;
const MAX_TRANSACTION_ID_LENGTH = 120;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f]/u;

export type GovernedWorkspaceMutationErrorCode =
  | 'GOVERNED_WORKSPACE_MUTATION_INPUT_INVALID'
  | 'GOVERNED_WORKSPACE_MUTATION_PATH_DENIED'
  | 'GOVERNED_WORKSPACE_MUTATION_TRUST_DENIED'
  | 'GOVERNED_WORKSPACE_MUTATION_CANCELLED'
  | 'GOVERNED_WORKSPACE_MUTATION_CANCELLED_AFTER_COMMIT'
  | 'GOVERNED_WORKSPACE_MUTATION_RUN_FAILED';

export class GovernedWorkspaceMutationError extends Error {
  public constructor(readonly code: GovernedWorkspaceMutationErrorCode) {
    super(code);
    this.name = 'GovernedWorkspaceMutationError';
  }
}

export type GovernedWorkspaceMutationDriver = Readonly<{
  /**
   * The only effect seam. Production composition must supply a native writer
   * that rejects reparse points and commits atomically inside `workspaceRoot`.
   * This module deliberately has no Node `writeFile` fallback.
   */
  writeText: (
    input: Readonly<{
      workspaceRoot: string;
      relativePath: string;
      content: string;
      /** Opaque, short-lived grant bound to this exact mutation run. */
      grantId: string;
      /** Digests the native writer must independently recompute before commit. */
      expectedTargetDigest: string;
      expectedContentDigest: string;
      signal?: AbortSignal;
    }>
  ) => Promise<
    Readonly<{
      committed: true;
      transactionId: string;
      targetDigest: string;
      contentDigest: string;
    }>
  >;
}>;

export type GovernedWorkspaceMutationInput = Readonly<{
  runId: string;
  taskId: string;
  idempotencyKey: string;
  relativePath: string;
  content: string;
}>;

export type GovernedWorkspaceMutationResult = Readonly<{
  receiptId: string;
  runId: string;
  evidenceRef: string;
}>;

export type GovernedWorkspaceMutationExecutor = Readonly<{
  writeText: (input: unknown, signal?: AbortSignal) => Promise<GovernedWorkspaceMutationResult>;
}>;

export type GovernedWorkspaceMutationExecutorDeps = Readonly<{
  /** Main-owned authority, composed only after the required user approval. */
  trustRuntime: FoundationTrustRuntime;
  /** Existing canonical workspace root selected by Main, never by IPC input. */
  workspaceRoot: string;
  /** Required native, reparse-safe, atomic filesystem effect implementation. */
  driver: GovernedWorkspaceMutationDriver;
  /** Test-only kernel injection; production uses the runtime-owned kernel. */
  kernel?: RunKernel;
}>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_IDENTIFIER_LENGTH && SAFE_IDENTIFIER.test(value);

const isBoundedTransactionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TRANSACTION_ID_LENGTH && SAFE_IDENTIFIER.test(value);

const parseInput = (value: unknown): GovernedWorkspaceMutationInput => {
  if (!isPlainObject(value)) throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_INPUT_INVALID');
  const keys = Object.keys(value);
  const expectedKeys = ['content', 'idempotencyKey', 'relativePath', 'runId', 'taskId'];
  if (keys.length !== expectedKeys.length || !keys.every((key) => expectedKeys.includes(key))) {
    throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_INPUT_INVALID');
  }
  if (
    !isBoundedIdentifier(value.runId) ||
    !isBoundedIdentifier(value.taskId) ||
    !isBoundedIdentifier(value.idempotencyKey) ||
    typeof value.relativePath !== 'string' ||
    !value.relativePath ||
    value.relativePath.length > MAX_RELATIVE_PATH_LENGTH ||
    typeof value.content !== 'string' ||
    Buffer.byteLength(value.content, 'utf8') > MAX_CONTENT_BYTES
  ) {
    throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_INPUT_INVALID');
  }
  if (CONTROL_CHARACTER.test(value.relativePath)) {
    throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_PATH_DENIED');
  }
  return Object.freeze({
    runId: value.runId,
    taskId: value.taskId,
    idempotencyKey: value.idempotencyKey,
    relativePath: value.relativePath,
    content: value.content,
  });
};

const resolveWorkspaceTarget = (workspaceRoot: string, relativePath: string): { root: string; target: string } => {
  if (!path.isAbsolute(workspaceRoot) || path.isAbsolute(relativePath)) {
    throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_PATH_DENIED');
  }
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_PATH_DENIED');
  }
  return { root, target };
};

const digestText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const evidenceRefFor = (runId: string, relativePath: string): string =>
  `workspace-write:${digestText(runId)}:${digestText(relativePath)}`;

/**
 * Creates a Main-only mutation executor. Its injected driver is intentionally
 * mandatory: a JavaScript fallback cannot make Windows reparse-point writes
 * race-safe. The existing renderer bridge stays fail-closed until production
 * bootstrap composes an approved native driver and a consent-bound TrustRuntime.
 */
export const createGovernedWorkspaceMutationExecutor = (
  deps: GovernedWorkspaceMutationExecutorDeps
): GovernedWorkspaceMutationExecutor => ({
  writeText: async (rawInput, signal) => {
    const input = parseInput(rawInput);
    const { root, target } = resolveWorkspaceTarget(deps.workspaceRoot, input.relativePath);
    const trustRuntime = deps.trustRuntime;
    const kernel = deps.kernel ?? getFoundationKernel(trustRuntime);
    const actorId = trustRuntime.actorId;
    const evidenceRef = evidenceRefFor(input.runId, input.relativePath);
    let wrote = false;
    const runtime: FoundationCoreRuntime = {
      listTargets: async () => [{ id: GOVERNED_WORKSPACE_MUTATION_TARGET_ID, kind: 'local', available: true }],
      executeToCompletion: async ({ signal: executionSignal }) => {
        if (executionSignal?.aborted) {
          throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_CANCELLED');
        }
        const request = {
          runId: input.runId,
          taskId: input.taskId,
          actorId,
          operation: 'filesystem' as const,
          targetId: GOVERNED_WORKSPACE_MUTATION_TARGET_ID,
          requestedCapabilities: ['workspace.write'],
          workspaceScope: root,
          policyVersion: trustRuntime.policyVersion,
          idempotencyKey: input.idempotencyKey,
          reason: 'Write a consent-approved workspace file through the governed native driver.',
          filePath: target,
        };
        const decision = await trustRuntime.trustBroker.requestCapability(request, GOVERNED_WORKSPACE_MUTATION_ORIGIN);
        if (decision.decision !== 'allow' || decision.grantId === undefined) {
          throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_TRUST_DENIED');
        }
        try {
          if (executionSignal?.aborted) {
            throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_CANCELLED');
          }
          const finalDecision = await trustRuntime.trustBroker.inspectFinalFilesystemEffect({
            ...request,
            origin: GOVERNED_WORKSPACE_MUTATION_ORIGIN,
            grantId: decision.grantId,
          });
          if (finalDecision.decision !== 'allow') {
            throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_TRUST_DENIED');
          }
          if (executionSignal?.aborted) {
            throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_CANCELLED');
          }
          const expectedTargetDigest = digestText(input.relativePath);
          const expectedContentDigest = digestText(input.content);
          const outcome = await deps.driver.writeText({
            workspaceRoot: root,
            relativePath: input.relativePath,
            content: input.content,
            grantId: decision.grantId,
            expectedTargetDigest,
            expectedContentDigest,
            signal: executionSignal,
          });
          if (
            outcome.committed !== true ||
            !isBoundedTransactionId(outcome.transactionId) ||
            outcome.targetDigest !== expectedTargetDigest ||
            outcome.contentDigest !== expectedContentDigest
          ) {
            throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_RUN_FAILED');
          }
          wrote = true;
          return {
            text: 'Governed workspace mutation completed.',
            evidenceRefs: [evidenceRef, `workspace-commit:${outcome.transactionId}`],
            effect: { state: 'committed', idempotencyKey: input.idempotencyKey },
          };
        } finally {
          await trustRuntime.trustBroker.revoke(
            decision.grantId,
            'Workspace mutation effect completed or was interrupted.'
          );
        }
      },
    };
    const intent = {
      runId: input.runId,
      rootTaskId: input.taskId,
      surface: 'governed-workspace-mutation',
      goal: 'Write a user-approved file in the selected workspace.',
      constraints: [`target:${GOVERNED_WORKSPACE_MUTATION_TARGET_ID}`, 'private_only'],
      successCriteria: ['workspace mutation completed'],
      workspaceScope: root,
      userId: actorId,
      createdAt: Date.now(),
      correlationId: input.idempotencyKey,
      policyVersion: trustRuntime.policyVersion,
      capabilityGrant: ['target.execute', 'workspace.write'],
    } as const;
    try {
      await trustRuntime.assertRunStart(kernel, intent, GOVERNED_WORKSPACE_MUTATION_ORIGIN);
      const execution = await executeFoundationHubRun(
        kernel,
        runtime,
        intent,
        GOVERNED_WORKSPACE_MUTATION_ORIGIN,
        signal,
        {
          allowedTargetIds: [GOVERNED_WORKSPACE_MUTATION_TARGET_ID],
          permissionMode: 'workspace-write',
          contextIdentity: { surface: 'governed-workspace-mutation', personalId: actorId },
          trustRuntime,
        }
      );
      if (execution.receipt.status === 'cancelled') {
        throw new GovernedWorkspaceMutationError(
          wrote ? 'GOVERNED_WORKSPACE_MUTATION_CANCELLED_AFTER_COMMIT' : 'GOVERNED_WORKSPACE_MUTATION_CANCELLED'
        );
      }
      if (execution.receipt.status !== 'verified' || !wrote || !execution.receipt.evidenceRefs.includes(evidenceRef)) {
        throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_RUN_FAILED');
      }
      return Object.freeze({ receiptId: execution.receipt.receiptId, runId: input.runId, evidenceRef });
    } catch (error) {
      if (error instanceof GovernedWorkspaceMutationError) throw error;
      throw new GovernedWorkspaceMutationError('GOVERNED_WORKSPACE_MUTATION_RUN_FAILED');
    }
  },
});
