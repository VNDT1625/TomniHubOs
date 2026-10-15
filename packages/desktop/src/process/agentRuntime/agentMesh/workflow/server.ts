import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { protectedMcpTextContent } from '@process/agentRuntime/agentMesh/security';
import { executeToolWorkflow, createWorkflowCoordinatorAdmission, type WorkflowToolStep } from '../workflowEngine';
import type { IResourceCoordinator } from '@process/resource/resourceCoordinator';
import type { LeaseOwner } from '@process/resource/leaseTypes';
import { createWorkflowResultStore, deliverWorkflowResult, type WorkflowResultStore } from './resultDelivery';
import { createWorkflowMailbox, type WorkflowMailbox } from './mailbox';

export const BUILTIN_WORKFLOW_NAME = 'tomny-workflow';
const MAX_WORKFLOW_MS = 180_000;
const MAX_STEP_MS = 60_000;
const MAX_INPUT_BYTES = 16_384;

const name = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_:-]*$/u);
const condition = z
  .object({
    stepId: name,
    status: z.enum(['succeeded', 'failed', 'skipped']).optional(),
    path: z.array(z.string().min(1).max(128)).max(12).optional(),
    equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    fileCount: z.number().int().min(0).max(100).optional(),
  })
  .strict();
const stepSchema = z
  .object({
    id: name,
    tool: name,
    input: z.record(z.unknown()),
    inputFrom: z
      .record(
        z
          .object({
            stepId: name,
            path: z.array(z.string().min(1).max(128)).max(12).optional(),
            select: z.literal('singleFile').optional(),
            decode: z.enum(['mcpText', 'mcpJson']).optional(),
          })
          .strict()
      )
      .optional(),
    dependsOn: z.array(name).max(64).optional(),
    when: z.array(condition).max(16).optional(),
    whenExpr: z.unknown().optional(),
    whenScript: z
      .object({ language: z.literal('javascript'), source: z.string().min(1).max(4_096) })
      .strict()
      .optional(),
  })
  .strict();

export type WorkflowMcpServerDeps = Readonly<{
  coordinator: Pick<IResourceCoordinator, 'requestLease' | 'releaseLease'>;
  owner: LeaseOwner;
  /** Same run-scoped store shared by SSE connections to this host. */
  resultStore?: WorkflowResultStore;
  mailbox?: WorkflowMailbox;
  /** Query the already-scoped tool registry; this never grants or invokes a child tool. */
  describe?: (tool: string) => Promise<Record<string, unknown>>;
  /** Already scoped to the parent Surface by Main. No capability discovery here. */
  invoke: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  /** Executes the existing Main-owned permission and approval protocol PER child call. */
  authorize: (tool: string, input: Record<string, unknown>) => Promise<boolean>;
  onStep?: (event: {
    tool: string;
    id: string;
    workflowId: string;
    workflowStage: number;
    phase: 'running' | 'success' | 'error';
    input: Record<string, unknown>;
    output?: unknown;
  }) => void | Promise<void>;
  signal: AbortSignal;
}>;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

/**
 * One MCP entry point, many parallel tool calls, one final receipt to the model.
 * Only Main-owned invoke/authorize functions may access other MCP servers.
 */
export const createWorkflowMcpServer = (deps: WorkflowMcpServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_WORKFLOW_NAME, version: '1.0.0' });
  const resultStore = deps.resultStore ?? createWorkflowResultStore();
  const mailbox = deps.mailbox ?? createWorkflowMailbox(resultStore);
  const observeStep = async (event: Parameters<NonNullable<WorkflowMcpServerDeps['onStep']>>[0]): Promise<void> => {
    try {
      await deps.onStep?.(event);
    } catch {
      // UI/audit observers must not change the result of an authorized tool call.
    }
  };
  server.tool(
    'workflow_mailbox_poll',
    'Poll session-scoped Workflow Mailbox for progress/errors/completed siblings. Never starts a model turn or re-runs tools.',
    {
      workflowId: z.string().uuid(),
      after: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(80).default(40),
    },
    async ({ workflowId, after, limit }) => {
      try {
        if (deps.signal.aborted) throw new Error('WORKFLOW_RUN_NOT_ACTIVE');
        return { content: protectedMcpTextContent(JSON.stringify(mailbox.read(workflowId, after, limit))) };
      } catch (error) {
        return { content: protectedMcpTextContent(errorText(error)), isError: true };
      }
    }
  );
  server.tool(
    'workflow_adapter_get',
    'Get an authorized tool input/output adapter before composing an Agent-authored whenExpr. Does not discover, authorize or call a child tool.',
    { tool: name },
    async ({ tool }) => {
      try {
        if (deps.signal.aborted) throw new Error('WORKFLOW_RUN_NOT_ACTIVE');
        if (!deps.describe) throw new Error('WORKFLOW_ADAPTER_UNAVAILABLE');
        return { content: protectedMcpTextContent(JSON.stringify(await deps.describe(tool))) };
      } catch (error) {
        return { content: protectedMcpTextContent(errorText(error)), isError: true };
      }
    }
  );
  server.tool(
    'workflow_result_get',
    'Retrieve a bounded JSON chunk of an earlier workflow step by opaque resultRef from this run. Only use for additional details omitted by smart delivery.',
    {
      resultRef: z.string().uuid(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(16_000).default(4_000),
    },
    async ({ resultRef, offset, limit }) => {
      try {
        if (deps.signal.aborted) throw new Error('WORKFLOW_RUN_NOT_ACTIVE');
        return { content: protectedMcpTextContent(JSON.stringify(resultStore.get(resultRef, offset, limit))) };
      } catch (error) {
        return { content: protectedMcpTextContent(errorText(error)), isError: true };
      }
    }
  );
  server.tool(
    'workflow_run',
    'Prefer this preloaded tool whenever a task needs two or more authorized MCP calls of ANY type, not only file reads. A custom whenScript (language=javascript, source=a function of prior step results) runs in a bounded, disposable worker and returns allow and optional scalar values. Prefer whenExpr for simple conditions. Agent may author reusable whenExpr: {op:"compare",comparison:"eq",left:{kind:"count",of:{kind:"step",stepId:"find",decode:"mcpJson",path:["items"]}},right:{kind:"literal",value:1}}, or compose with all/any/not, exists/isEmpty and gt/gte/lt/lte/contains. Use inputFrom with decode:"mcpJson" and a path for safe scalar bindings. Run up to 64 tool steps with resource-aware queueing, dependencies, conditions and inputFrom bindings. For a known filename, use tomny_glob then conditionally tomny_read when fileCount is exactly 1; use inputFrom {filePath:{stepId:"find",select:"singleFile"}}. If 0 or multiple files match, skip Read and return the glob result. Set checkpointOnError:true if an unrecoverable failed branch must reach the Agent early while independent siblings continue; subsequent turns may append repair steps using resumeWorkflowId, and workflow_mailbox_poll drains completion events without an extra model wakeup. Return one aggregate result to the agent. For one simple call, use its direct tool. Never use this tool to expand permissions or discover tools. Do not include secrets.',
    {
      steps: z.array(stepSchema).min(1).max(64),
      checkpointOnError: z.boolean().default(false),
      /** Append repair steps to an existing session-owned workflow after a checkpoint. */
      resumeWorkflowId: z.string().uuid().optional(),
      delivery: z
        .object({
          mode: z.enum(['smart', 'full', 'selected', 'errorsOnly']).default('smart'),
          maxChars: z.number().int().min(8_000).max(64_000).optional(),
          select: z
            .array(
              z
                .object({
                  stepId: name,
                  path: z.array(z.string().min(1).max(128)).max(12),
                })
                .strict()
            )
            .max(32)
            .optional(),
        })
        .strict()
        .optional(),
    },
    async ({ steps, delivery, checkpointOnError, resumeWorkflowId }) => {
      const workflowId = resumeWorkflowId ?? randomUUID();
      const controller = new AbortController();
      const stop = (): void => controller.abort();
      if (deps.signal.aborted) stop();
      else deps.signal.addEventListener('abort', stop, { once: true });
      const timeout = setTimeout(stop, MAX_WORKFLOW_MS);
      timeout.unref?.();
      try {
        const definitions = steps as WorkflowToolStep[];
        if (JSON.stringify(definitions).length > MAX_INPUT_BYTES) throw new Error('WORKFLOW_INPUT_TOO_LARGE');
        // Display-only DAG rank. Agent-specified dependencies, not completion order,
        // determine which arrows can share one parallel lane in Overview.
        const stageById = new Map<string, number>();
        for (let pass = 0; pass < definitions.length; pass += 1) {
          for (const definition of definitions) {
            if (stageById.has(definition.id)) continue;
            const dependsOn = definition.dependsOn ?? [];
            if (dependsOn.some((id) => !stageById.has(id))) continue;
            stageById.set(definition.id, Math.max(0, ...dependsOn.map((id) => (stageById.get(id) ?? 0) + 1)));
          }
        }
        const admission = createWorkflowCoordinatorAdmission(
          deps.coordinator,
          // Dedicated queue avoids self-deadlock against the parent Agent lease.
          () => ({ kind: 'workflowTool', costMB: 16 }),
          deps.owner
        );
        const conditionAdmission = createWorkflowCoordinatorAdmission(
          deps.coordinator,
          () => ({ kind: 'workflowTool', costMB: 32 }),
          deps.owner
        );
        const job = resumeWorkflowId
          ? mailbox.resume(
              resumeWorkflowId,
              definitions.map((step) => step.id),
              deps.owner.taskId
            )
          : checkpointOnError
            ? mailbox.create(workflowId, deps.owner.taskId)
            : undefined;
        if (!resumeWorkflowId) job?.reserveSteps(definitions.map((step) => step.id));
        const execution = executeToolWorkflow(definitions, {
          signal: controller.signal,
          admitCondition: conditionAdmission,
          ...(job ? { onStepSettled: job.onStepSettled } : {}),
          admit: async (step, signal) => {
            if (signal.aborted) throw new Error('WORKFLOW_CANCELLED');
            // A pending user approval never occupies a machine resource lease.
            if (!(await deps.authorize(step.tool, { ...step.input })))
              throw new Error('WORKFLOW_CHILD_PERMISSION_DENIED');
            if (signal.aborted) throw new Error('WORKFLOW_CANCELLED');
            return admission(step, signal);
          },
          invoke: async (step, { signal }) => {
            if (signal.aborted) throw new Error('WORKFLOW_CANCELLED');
            await observeStep({
              workflowId,
              workflowStage: stageById.get(step.id) ?? 0,
              tool: step.tool,
              id: step.id,
              phase: 'running',
              input: { ...step.input },
            });
            // Each child tool still verifies its own input, workspace and permissions.
            const child = new AbortController();
            const parentAbort = (): void => child.abort();
            signal.addEventListener('abort', parentAbort, { once: true });
            const deadline = setTimeout(() => child.abort(), MAX_STEP_MS);
            deadline.unref?.();
            try {
              const output = await deps.invoke(step.tool, { ...step.input }, child.signal);
              await observeStep({
                workflowId,
                workflowStage: stageById.get(step.id) ?? 0,
                tool: step.tool,
                id: step.id,
                phase: 'success',
                input: { ...step.input },
                output,
              });
              return output;
            } catch (error) {
              await observeStep({
                tool: step.tool,
                id: step.id,
                workflowId,
                workflowStage: stageById.get(step.id) ?? 0,
                phase: 'error',
                input: { ...step.input },
                output: errorText(error),
              });
              throw error;
            } finally {
              clearTimeout(deadline);
              signal.removeEventListener('abort', parentAbort);
            }
          },
        });
        const finished = execution.then(
          (result) => {
            job?.complete(result, Boolean(resumeWorkflowId));
            return result;
          },
          (error) => {
            job?.cancel();
            throw error;
          }
        );
        if (job) {
          const terminal = finished
            .then(
              (): void => undefined,
              (): void => undefined
            )
            .finally(() => {
              clearTimeout(timeout);
              deps.signal.removeEventListener('abort', stop);
            });
          job.setTerminal(terminal);
          if (checkpointOnError) {
            const checkpoint = await Promise.race([job.checkpoint(), terminal.then(() => mailbox.peek(workflowId))]);
            if (checkpoint.status === 'needs_agent') {
              return {
                content: protectedMcpTextContent(
                  JSON.stringify({
                    status: 'needs_agent',
                    workflowId,
                    mailbox: checkpoint,
                    note: 'Sibling steps continue. Poll workflow_mailbox_poll later; their completion does not wake a model.',
                  })
                ),
              };
            }
          }
        }
        const result = await finished;
        const selection = (delivery?.select ?? []).flatMap(({ stepId, path }) =>
          typeof stepId === 'string' && Array.isArray(path) ? [{ stepId, path }] : []
        );
        const response = deliverWorkflowResult(result, resultStore, {
          mode: delivery?.mode,
          maxChars: delivery?.maxChars,
          select: selection,
        });
        return { content: protectedMcpTextContent(JSON.stringify({ ...response, ...(job ? { workflowId } : {}) })) };
      } catch (error) {
        return { content: protectedMcpTextContent(errorText(error)), isError: true };
      } finally {
        if (!checkpointOnError || mailbox.activeCount() === 0) {
          clearTimeout(timeout);
          deps.signal.removeEventListener('abort', stop);
        }
      }
    }
  );
  return server;
};
