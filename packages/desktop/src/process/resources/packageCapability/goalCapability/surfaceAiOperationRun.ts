import type { ActiveRunExecutionContext, FoundationTrustRuntime, RunKernel } from '@/process/foundation/runKernel';
import { executeFoundationHubRun, type FoundationCoreRuntime } from '@/process/bridge/foundationBridge';
import type { SurfaceAiOperationDispatcher } from '../surfaceAiAccessBroker';
import { startSurfaceAiOperationMcpHost } from './surfaceAiOperationMcpHost';
import type { SurfaceAiOperationMcpSession } from './surfaceAiOperationMcpServer';

export type SurfaceAiOperationRunRequest = Readonly<{
  /** Main-selected Hub target. This type has no renderer/IPC representation. */
  targetId: string;
  modelKey?: string;
  session: SurfaceAiOperationMcpSession;
  signal?: AbortSignal;
}>;

export type SurfaceAiOperationRunDeps = Readonly<{
  kernel: RunKernel;
  runtime: FoundationCoreRuntime;
  dispatcher: SurfaceAiOperationDispatcher;
  /** Shared Main-owned authority for C4 preflight, target execution, and child dispatch. */
  trustRuntime?: FoundationTrustRuntime;
}>;

const requireText = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

/**
 * Composes the C4 tool host into a single Main-owned Foundation run. It is not
 * an IPC endpoint: a future Orchestrator action planner must first prove the
 * target/model selection, active local runtime, review and exact user consent.
 */
export const executeSurfaceAiOperationRun = async (
  deps: SurfaceAiOperationRunDeps,
  request: SurfaceAiOperationRunRequest
) => {
  const targetId = requireText(request.targetId, 'SURFACE_AI_OPERATION_TARGET_INVALID');
  const bound = request.session.operation;
  const capability = `surface.ai:${bound.surface.packageId}:${bound.operationId}`;
  if (
    bound.placement !== 'local' ||
    bound.secretUse ||
    !bound.parentIntent.capabilityGrant?.includes('target.execute') ||
    !bound.parentIntent.capabilityGrant?.includes(capability) ||
    request.signal?.aborted
  ) {
    throw new Error('SURFACE_AI_OPERATION_RUN_INVALID');
  }
  let activeRun: ActiveRunExecutionContext | undefined;
  let verifiedChildReceiptId: string | undefined;
  const host = await startSurfaceAiOperationMcpHost({
    dispatcher: deps.dispatcher,
    session: {
      ...request.session,
      isActive: () => request.session.isActive?.() !== false && activeRun?.isActive() === true,
      getActiveRun: () => activeRun,
      onVerifiedChildReceipt: (receiptId) => {
        if (verifiedChildReceiptId !== undefined) throw new Error('SURFACE_AI_OPERATION_MULTIPLE_CHILDREN');
        verifiedChildReceiptId = receiptId;
      },
    },
  });
  try {
    return await executeFoundationHubRun(
      deps.kernel,
      deps.runtime,
      bound.parentIntent,
      'tomny://surface-ai-operation',
      request.signal,
      {
        allowedTargetIds: [targetId],
        ...(request.modelKey === undefined ? {} : { modelKey: request.modelKey }),
        // The model only emits bounded instructions to the authenticated
        // Surface port; it never receives workspace-write authority itself.
        permissionMode: 'read-only',
        sessionId: `surface-ai:${bound.parentIntent.runId}`,
        contextIdentity: {
          surface: bound.surface.packageId,
          agentId: 'tomny',
          capabilityGrants: [capability],
          suppressPersonalContext: true,
        },
        mcpServers: [host.server],
        onActiveRun: (next) => {
          if (activeRun !== undefined) throw new Error('SURFACE_AI_OPERATION_ACTIVE_SCOPE_DUPLICATE');
          activeRun = next;
        },
        validateCoreExecution: () => {
          if (activeRun === undefined || !activeRun.isActive() || verifiedChildReceiptId === undefined) {
            throw new Error('SURFACE_AI_OPERATION_CHILD_REQUIRED');
          }
        },
        ...(deps.trustRuntime === undefined ? {} : { trustRuntime: deps.trustRuntime }),
      }
    );
  } finally {
    await host.close();
  }
};
