import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SurfaceAiOperationDispatchRequest, SurfaceAiOperationDispatcher } from '../surfaceAiAccessBroker';
import type { ActiveRunExecutionContext } from '@/process/foundation/runKernel';

export const PACKAGE_SURFACE_OPERATION_SERVER_NAME = 'tomny-package-surface-operation';
export const PACKAGE_SURFACE_OPERATION_TOOL_NAME = 'package_surface_execute';

const MAX_INSTRUCTION_BYTES = 12 * 1024;

type BoundSurfaceOperation = Omit<
  SurfaceAiOperationDispatchRequest,
  'invocationId' | 'childRunId' | 'childTaskId' | 'input'
>;

export type SurfaceAiOperationMcpSession = Readonly<{
  /**
   * Main-owned authority captured after a Surface is reviewed, live and
   * separately consented. A model cannot change any field in this envelope.
   */
  operation: BoundSurfaceOperation;
  createInvocationId?: () => string;
  createChildRunId?: (invocationId: string) => string;
  createChildTaskId?: (invocationId: string) => string;
  /** Returns false when the parent governed run has already been cancelled. */
  isActive?: () => boolean;
  /** Resolves only the opaque RunKernel scope for this still-active parent Run. */
  getActiveRun?: () => ActiveRunExecutionContext | undefined;
  /** Main-only receipt observation used to enforce the exactly-one C4 operation invariant. */
  onVerifiedChildReceipt?: (receiptId: string) => void;
}>;

export type SurfaceAiOperationMcpServerDeps = Readonly<{
  dispatcher: SurfaceAiOperationDispatcher;
  session: SurfaceAiOperationMcpSession;
}>;

const textResult = (value: Record<string, unknown>, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

const opaqueFailure = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'SURFACE_AI_OPERATION_FAILED';
};

const requireBoundSession = (session: SurfaceAiOperationMcpSession): void => {
  const operation = session.operation;
  const capability = `surface.ai:${operation.surface.packageId}:${operation.operationId}`;
  if (
    operation.placement !== 'local' ||
    operation.secretUse ||
    !operation.parentIntent.capabilityGrant?.includes(capability) ||
    !operation.consentId.trim() ||
    !operation.accountId.trim() ||
    !operation.runtime.ownerId.trim() ||
    !operation.runtime.runtimeId.trim()
  ) {
    throw new Error('SURFACE_AI_OPERATION_SESSION_INVALID');
  }
};

/**
 * Builds a per-run MCP server for exactly one already-authorized local Surface
 * operation. The model can supply only a bounded instruction; Main pins the
 * package identity, runtime, consent, capability, destinations, budget and
 * parent Run lineage before this server exists. Secret-backed operations are
 * deliberately rejected until the opaque per-operation secret-lease host is
 * composed at the same Main-owned seam.
 */
export const createSurfaceAiOperationMcpServer = (deps: SurfaceAiOperationMcpServerDeps): McpServer => {
  requireBoundSession(deps.session);
  const createInvocationId = deps.session.createInvocationId ?? randomUUID;
  const createChildRunId = deps.session.createChildRunId ?? ((invocationId) => `surface-ai:${invocationId}`);
  const createChildTaskId = deps.session.createChildTaskId ?? ((invocationId) => `surface-ai-task:${invocationId}`);
  const server = new McpServer({ name: PACKAGE_SURFACE_OPERATION_SERVER_NAME, version: '1.0.0' });
  let invoked = false;

  server.tool(
    PACKAGE_SURFACE_OPERATION_TOOL_NAME,
    'Execute the one reviewed, consented Package Surface operation bound to this governed run. Only provide the operation instruction.',
    { instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_BYTES) },
    async ({ instruction }) => {
      const activeRun = deps.session.getActiveRun?.();
      if (
        invoked ||
        Buffer.byteLength(instruction, 'utf8') > MAX_INSTRUCTION_BYTES ||
        deps.session.isActive?.() === false ||
        activeRun === undefined ||
        !activeRun.isActive()
      ) {
        return textResult({ code: 'SURFACE_AI_OPERATION_UNAVAILABLE' }, true);
      }
      invoked = true;
      const invocationId = createInvocationId().trim();
      const childRunId = createChildRunId(invocationId).trim();
      const childTaskId = createChildTaskId(invocationId).trim();
      if (!invocationId || !childRunId || !childTaskId) {
        return textResult({ code: 'SURFACE_AI_OPERATION_UNAVAILABLE' }, true);
      }
      try {
        const result = await deps.dispatcher.dispatch({
          ...deps.session.operation,
          invocationId,
          childRunId,
          childTaskId,
          input: { schemaVersion: 1, instruction },
          activeRun,
        });
        deps.session.onVerifiedChildReceipt?.(result.childReceipt.receiptId);
        return textResult({
          status: 'verified',
          childReceiptId: result.childReceipt.receiptId,
        });
      } catch (error) {
        return textResult({ code: opaqueFailure(error) }, true);
      }
    }
  );
  return server;
};
