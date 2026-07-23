import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DetectedCoreTarget } from '@process/experimentalCore/adapters';
import type { AgentJobOrchestrator, AgentJobRequest } from '../orchestrator';
import { protectedMcpTextContent } from '../security';

import { createDeepResearchPlan, type DeepResearchRequest } from '../research';

export const BUILTIN_AGENT_ORCHESTRATOR_NAME = 'aionui-agent-orchestrator';
export const BUILTIN_AGENT_ORCHESTRATOR_ID = 'builtin-agent-orchestrator';

export type AgentOrchestratorExecutionClaims = Readonly<{
  /** Exact workspace already granted to the parent execution, or omit for an isolated managed workspace. */
  workspace?: string;
  /** Exact surface already granted to the parent execution. */
  surface: string;
  /** Child execution can never exceed this parent-granted permission. */
  permissionMode: 'read-only' | 'workspace-write' | 'full-access';
  /** Opaque host-owned channel for child permission requests. */
  executionScopeId?: string;
}>;

export type AgentOrchestratorServerDeps = {
  orchestrator: AgentJobOrchestrator;
  listTargets: () => Promise<DetectedCoreTarget[]>;
  /** Trusted host-side claims. Public process-wide hosts omit this and receive the locked-down defaults. */
  executionClaims?: AgentOrchestratorExecutionClaims;
};

type AgentOrchestratorAccessScope = {
  id: string;
  sessionIds: Set<string>;
};

const STRONG_SESSION_CAPABILITY = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PUBLIC_EXECUTION_CLAIMS: AgentOrchestratorExecutionClaims = Object.freeze({
  surface: 'chat',
  permissionMode: 'read-only',
});
const MAX_ID_CHARS = 256;
const MAX_OBJECTIVE_CHARS = 32_000;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_ID_LIST = 16;
const MAX_ERROR_CHARS = 8_000;

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const idSchema = boundedText(MAX_ID_CHARS);
const optionalIdSchema = idSchema.optional();

const jobShape = {
  jobId: optionalIdSchema.describe('Optional caller-stable job id.'),
  agentId: idSchema.describe('Logical worker id. Reuse it with agent_resume to continue that worker.'),
  targetId: optionalIdSchema.describe('Detected Tomny Core target id. Omit to use the first available target.'),
  modelId: optionalIdSchema.describe('Optional model id supported by the selected target.'),
  objective: boundedText(MAX_OBJECTIVE_CHARS).describe('Bounded objective for this worker.'),
  kind: z.enum(['agent', 'quick', 'test']).optional().describe('Scheduling and result classification.'),
  dependsOn: z
    .array(idSchema)
    .max(MAX_ID_LIST)
    .optional()
    .describe('Job ids that must complete before this job starts.'),
  estimatedTokens: z.number().int().nonnegative().optional(),
  priority: z.number().finite().optional(),
};

const jobSchema = z.object(jobShape);

const researchSectionSchema = z.object({
  id: idSchema,
  title: boundedText(500),
  question: boundedText(4_000),
  domains: z.array(boundedText(256)).max(20).optional(),
  minimumSources: z.number().int().min(1).max(50).optional(),
  minimumPrimarySourceRatio: z.number().min(0).max(1).optional(),
  requireIndependentVerification: z.boolean().optional(),
});

const researchRequestShape = {
  topic: boundedText(2_000),
  sections: z.array(researchSectionSchema).min(1).max(30),
  outputs: z
    .array(z.enum(['report', 'presentation']))
    .min(1)
    .max(2),
  maxConcurrent: z.number().int().min(1).max(8).optional(),
  sourceBudgetPerSection: z.number().int().min(3).max(50).optional(),
  allowAuthorizedBrowser: z.boolean().optional(),
};

const textResult = (text: string, isError = false) => ({
  content: protectedMcpTextContent(text),
  ...(isError ? { isError: true } : {}),
});

const jsonResult = (value: unknown) => textResult(JSON.stringify(value, null, 2));
const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_ERROR_CHARS ? message : `${message.slice(0, MAX_ERROR_CHARS - 1)}…`;
};

const immutableExecutionClaims = (
  claims: AgentOrchestratorExecutionClaims | undefined
): AgentOrchestratorExecutionClaims => {
  const supplied = claims ?? SAFE_PUBLIC_EXECUTION_CLAIMS;
  const surface = supplied.surface.trim();
  if (!surface) throw new Error('Agent orchestrator execution surface claim is required.');
  if (
    supplied.permissionMode !== 'read-only' &&
    supplied.permissionMode !== 'workspace-write' &&
    supplied.permissionMode !== 'full-access'
  ) {
    throw new Error('Agent orchestrator execution permission claim is invalid.');
  }
  return Object.freeze({
    workspace: supplied.workspace?.trim() || undefined,
    surface,
    permissionMode: supplied.permissionMode,
    executionScopeId: supplied.executionScopeId?.trim() || undefined,
  });
};

const bindExecutionClaims = (job: AgentJobRequest, claims: AgentOrchestratorExecutionClaims): AgentJobRequest => ({
  ...job,
  workspace: claims.workspace,
  surface: claims.surface,
  permissionMode: claims.permissionMode,
  executionScopeId: claims.executionScopeId,
});

const requireScopedSession = (
  deps: AgentOrchestratorServerDeps,
  scope: AgentOrchestratorAccessScope,
  sessionId: string
): string => {
  const normalized = sessionId.trim();
  if (scope.sessionIds.has(normalized)) return normalized;
  if (!STRONG_SESSION_CAPABILITY.test(normalized) || !deps.orchestrator.hasSession(normalized)) {
    throw new Error('Unknown or unauthorized agent session capability.');
  }
  scope.sessionIds.add(normalized);
  return normalized;
};

const scopedIdempotencyKey = (
  scope: AgentOrchestratorAccessScope,
  key?: string,
  sessionId?: string
): string | undefined => {
  const normalized = key?.trim();
  return normalized ? `${sessionId ?? scope.id}:${normalized}` : undefined;
};

const invoke = async (operation: () => unknown | Promise<unknown>) => {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return textResult(describeError(error), true);
  }
};

const waitForSession = async (orchestrator: AgentJobOrchestrator, sessionId: string, waitMs: number): Promise<void> => {
  if (waitMs <= 0) return;
  await Promise.race([
    orchestrator.waitForIdle(sessionId),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      timer.unref?.();
    }),
  ]);
};

/** MCP contract for bounded parallel workers, durable tracking and multi-turn resume. */
export const createAgentOrchestratorServer = (deps: AgentOrchestratorServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_AGENT_ORCHESTRATOR_NAME, version: '1.0.0' });
  const scope: AgentOrchestratorAccessScope = { id: randomUUID(), sessionIds: new Set() };
  const executionClaims = immutableExecutionClaims(deps.executionClaims);

  server.tool('agent_targets', 'List available direct Tomny Core targets for child-agent execution.', {}, async () =>
    invoke(async () =>
      (await deps.listTargets()).map(({ id, name, protocol, available, detail }) => ({
        id,
        name,
        protocol,
        available,
        detail,
      }))
    )
  );

  server.tool(
    'agent_research_plan',
    'Plan section-specialist research, original-source verification, synthesis and Office deliverables from one prompt without starting workers.',
    researchRequestShape,
    async (input) =>
      invoke(() =>
        createDeepResearchPlan({
          ...(input as DeepResearchRequest),
          workspace: executionClaims.workspace,
        })
      )
  );

  server.tool(
    'agent_research_spawn',
    'Start an end-to-end deep-research mesh: one researcher and verifier per section, evidence synthesis, Office authors and final QA.',
    {
      ...researchRequestShape,
      sessionId: optionalIdSchema,
      idempotencyKey: optionalIdSchema,
    },
    async ({ sessionId, idempotencyKey, ...input }) =>
      invoke(async () => {
        const authorizedSessionId = sessionId ? requireScopedSession(deps, scope, sessionId) : undefined;
        const plan = createDeepResearchPlan({
          ...(input as DeepResearchRequest),
          workspace: executionClaims.workspace,
        });
        const spawned = deps.orchestrator.spawnJobs({
          sessionId: authorizedSessionId ?? plan.sessionId,
          jobs: plan.jobs.map((job) => bindExecutionClaims(job, executionClaims)),
          maxConcurrent: Math.min(plan.maxConcurrent, 8),
          idempotencyKey: scopedIdempotencyKey(scope, idempotencyKey, authorizedSessionId),
        });
        scope.sessionIds.add(spawned.sessionId);
        await deps.orchestrator.flush(spawned.sessionId);
        return {
          ...spawned,
          jobCount: plan.jobs.length,
          evidenceContract: plan.evidenceContract,
        };
      })
  );
  server.tool(
    'agent_spawn',
    'Spawn 1-16 bounded jobs in parallel using host-bound workspace, surface and permission claims. Returns durable ids for tracking.',
    {
      sessionId: optionalIdSchema.describe(
        'Existing cryptographic session capability, or omit to create an isolated session.'
      ),
      jobs: z.array(jobSchema).min(1).max(16),
      maxConcurrent: z.number().int().min(1).max(8).optional(),
      idempotencyKey: optionalIdSchema.describe('Retry-safe request key.'),
    },
    async ({ sessionId, jobs, maxConcurrent, idempotencyKey }) =>
      invoke(async () => {
        const authorizedSessionId = sessionId ? requireScopedSession(deps, scope, sessionId) : undefined;
        const spawned = deps.orchestrator.spawnJobs({
          sessionId: authorizedSessionId,
          jobs: (jobs as AgentJobRequest[]).map((job) => bindExecutionClaims(job, executionClaims)),
          maxConcurrent,
          idempotencyKey: scopedIdempotencyKey(scope, idempotencyKey, authorizedSessionId),
        });
        scope.sessionIds.add(spawned.sessionId);
        await deps.orchestrator.flush(spawned.sessionId);
        return spawned;
      })
  );

  server.tool(
    'agent_execute',
    'Run one bounded child job with immutable host-bound execution claims. waitMs may wait briefly while preserving an async session id.',
    {
      ...jobShape,
      sessionId: optionalIdSchema,
      waitMs: z.number().int().min(0).max(30_000).optional(),
      idempotencyKey: optionalIdSchema,
    },
    async ({ sessionId, waitMs = 0, idempotencyKey, ...job }) =>
      invoke(async () => {
        const authorizedSessionId = sessionId ? requireScopedSession(deps, scope, sessionId) : undefined;
        const spawned = deps.orchestrator.spawnJobs({
          sessionId: authorizedSessionId,
          jobs: [bindExecutionClaims(job as AgentJobRequest, executionClaims)],
          idempotencyKey: scopedIdempotencyKey(scope, idempotencyKey, authorizedSessionId),
        });
        scope.sessionIds.add(spawned.sessionId);
        await waitForSession(deps.orchestrator, spawned.sessionId, waitMs);
        await deps.orchestrator.flush(spawned.sessionId);
        return {
          ...spawned,
          job: deps.orchestrator.getResult(spawned.sessionId, spawned.jobIds[0]),
        };
      })
  );

  server.tool(
    'agent_track',
    'Read compact job state plus cursor events. Pass the returned cursor as afterCursor to fetch only new events.',
    {
      sessionId: idSchema,
      jobIds: z.array(idSchema).max(MAX_ID_LIST).optional(),
      afterCursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async ({ sessionId, ...input }) =>
      invoke(() => deps.orchestrator.trackJobs({ ...input, sessionId: requireScopedSession(deps, scope, sessionId) }))
  );

  server.tool(
    'agent_result',
    'Read the durable output and current status of one child job.',
    { sessionId: idSchema, jobId: idSchema },
    async ({ sessionId, jobId }) =>
      invoke(() => deps.orchestrator.getResult(requireScopedSession(deps, scope, sessionId), jobId))
  );

  server.tool(
    'agent_resume',
    'Continue the same logical agent in an existing session. Target and model inherit; execution stays bound to the parent workspace, surface and permission claims.',
    {
      sessionId: idSchema,
      agentId: idSchema,
      objective: boundedText(MAX_OBJECTIVE_CHARS),
      jobId: optionalIdSchema,
      kind: z.enum(['agent', 'quick', 'test']).optional(),
      targetId: optionalIdSchema,
      modelId: optionalIdSchema,
      estimatedTokens: z.number().int().nonnegative().optional(),
      idempotencyKey: optionalIdSchema,
      waitMs: z.number().int().min(0).max(30_000).optional(),
    },
    async ({ waitMs = 0, ...input }) =>
      invoke(async () => {
        const sessionId = requireScopedSession(deps, scope, input.sessionId);
        const spawned = deps.orchestrator.resumeAgent(
          {
            ...input,
            sessionId,
            idempotencyKey: scopedIdempotencyKey(scope, input.idempotencyKey, sessionId),
          },
          executionClaims
        );
        await waitForSession(deps.orchestrator, spawned.sessionId, waitMs);
        await deps.orchestrator.flush(spawned.sessionId);
        return {
          ...spawned,
          job: deps.orchestrator.getResult(spawned.sessionId, spawned.jobIds[0]),
        };
      })
  );

  server.tool(
    'agent_message',
    'Queue a progress, question, control or handoff message for a logical agent. A resumed/new job consumes queued messages.',
    {
      sessionId: idSchema,
      agentId: idSchema,
      content: boundedText(MAX_MESSAGE_CHARS),
      jobId: optionalIdSchema,
      kind: z.enum(['task', 'question', 'progress', 'result', 'handoff', 'control']).optional(),
      delivery: z
        .enum([
          'send-now',
          'enqueue-after-task',
          'graceful-interrupt-and-send',
          'interrupt-and-send',
          'cancel-and-replace',
        ])
        .optional(),
    },
    async ({ sessionId, ...input }) =>
      invoke(() =>
        deps.orchestrator.messageAgent({ ...input, sessionId: requireScopedSession(deps, scope, sessionId) })
      )
  );

  server.tool(
    'agent_cancel',
    'Cancel queued or running jobs while retaining their durable session metadata.',
    { sessionId: idSchema, jobIds: z.array(idSchema).min(1).max(MAX_ID_LIST) },
    async ({ sessionId, jobIds }) =>
      invoke(async () => {
        const authorizedSessionId = requireScopedSession(deps, scope, sessionId);
        const cancelledJobIds = deps.orchestrator.cancelJobs(authorizedSessionId, jobIds);
        await deps.orchestrator.flush(authorizedSessionId);
        return { cancelledJobIds };
      })
  );

  server.tool(
    'agent_sessions',
    "List only this MCP connection's active, idle, or hibernated sessions. Hibernation releases the worker controller but preserves durable results and resumable session capability. After reconnecting, pass exact session capabilities returned by spawn/execute to reclaim them.",
    { sessionIds: z.array(idSchema).max(MAX_ID_LIST).optional() },
    async ({ sessionIds = [] }) =>
      invoke(() => {
        for (const sessionId of sessionIds) requireScopedSession(deps, scope, sessionId);
        return deps.orchestrator.listSessionViews().filter((view) => scope.sessionIds.has(view.sessionId));
      })
  );

  server.tool(
    'agent_close',
    'Permanently close one session, cancel active jobs, release workers and delete its durable result metadata.',
    { sessionId: idSchema },
    async ({ sessionId }) =>
      invoke(async () => {
        const authorizedSessionId = requireScopedSession(deps, scope, sessionId);
        await deps.orchestrator.closeSession(authorizedSessionId);
        scope.sessionIds.delete(authorizedSessionId);
        return { sessionId: authorizedSessionId, closed: true };
      })
  );

  return server;
};
