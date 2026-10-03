/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Automation IPC bridge — exposes workflow CRUD + run/cancel to the renderer
 * Automation page, built with the same `@office-ai/platform` `bridge` helper as
 * the sibling `studioChatBridge` / `workspaceBridge`.
 *
 * Channels:
 *  - `automation.list`   — list all workflows.
 *  - `automation.get`    — fetch one workflow by id.
 *  - `automation.save`   — upsert a workflow.
 *  - `automation.remove` — delete a workflow by id.
 *  - `automation.run`    — start a run; events stream over `automation.event`;
 *    resolves with the assigned `runId`.
 *  - `automation.cancel` — abort an in-flight run by `runId`.
 *  - `automation.event`  — main → renderer push of the run log. The
 *    {@link RunEvent} union is boxed in a single-prop envelope so the platform
 *    `buildEmitter<Params>` conditional stays non-distributive (the same trick
 *    `workspaceBridge`/`browserBridge` use to avoid collapsing the union to
 *    `never`).
 *
 * Result-bearing channels resolve a {@link AutomationResult} envelope that
 * **always resolves** (never rejects) so the renderer can branch on `ok` instead
 * of hanging (the platform bridge swallows rejected promises).
 *
 * The bridge owns a singleton store + engine. The global bootstrap calls
 * {@link registerAutomationBridge} once; this module does not wire itself in.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import { randomUUID } from 'node:crypto';
import {
  executeFoundationHubRun,
  getConfiguredFoundationTrustRuntime,
  getFoundationKernel,
  type FoundationCoreRuntime,
} from '@process/bridge/foundationBridge';
import type { FoundationTrustRuntime, RunKernel } from '@process/foundation/runKernel';
import { createAutomationStore, type IAutomationStore } from './automationStore';
import { createNodeExecutors, createProviderChat, type NodeExecutorMap } from './nodeExecutors';
import {
  AUTOMATION_EGRESS_AUTHORITY_REQUIRED,
  createWorkflowEngine,
  type AutomationEgressAuthority,
  type IWorkflowEngine,
} from './workflowEngine';
import { createAutomationScheduler, type IAutomationScheduler } from './automationScheduler';
import { startWebhookServer, stopWebhookServer, type WebhookServer } from './webhookServer';
import { stopAutomationMcpHost } from './automationMcpHost';
import { resolveCredentialFields } from './credentialBridge';
import { runImage, runScript } from '@process/makevideo/makeVideoBridge';
import { createMakeVideoStore } from '@process/makevideo/makeVideoStore';
import { createVideoRenderer } from './connectors/videoRender';
import { getCompanyServices } from '@process/company/companyBridge';
import { createFromDescription, toStructureSpec, type CompanyConfig } from '@process/company/companyConfig';
import { createCompanyGenerator } from '@process/company/companyGenerator';
import { showNotification } from '@process/bridge/notificationBridge';
import { createManagerStore } from '@process/manager/managerStore';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { RunEvent, Workflow } from './automationTypes';

// ---------------------------------------------------------------------------
// Channel names (renderer-safe contract)
// ---------------------------------------------------------------------------

/** IPC channel names for the Automation surface. Safe to import from the renderer. */
export const AUTOMATION_CHANNELS = {
  list: 'automation.list',
  get: 'automation.get',
  save: 'automation.save',
  remove: 'automation.remove',
  run: 'automation.run',
  cancel: 'automation.cancel',
  event: 'automation.event',
} as const;

// ---------------------------------------------------------------------------
// Renderer-safe request / result types
// ---------------------------------------------------------------------------

/**
 * Result envelope — always resolves (never rejects), so the renderer can branch
 * on `ok` rather than hang on a swallowed rejection.
 */
export type AutomationResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Request addressing a workflow by id (get / remove). */
export type AutomationIdRequest = {
  /** Id of the target workflow. */
  id: string;
};

/** Request for {@link AUTOMATION_CHANNELS.save} — a full or partial workflow. */
export type SaveWorkflowRequest = {
  /** The workflow to upsert. A blank/absent `id` inserts a new workflow. */
  workflow: Partial<Workflow> & { name: string };
};

/** Request for {@link AUTOMATION_CHANNELS.run}. */
export type RunWorkflowRequest = {
  /** Id of the workflow to run. */
  id: string;
};

/** Result payload of a successful {@link AUTOMATION_CHANNELS.run}. */
export type RunWorkflowResult = {
  /** Id assigned to the started run (matches the `runId` on streamed events). */
  runId: string;
};

/** Request for {@link AUTOMATION_CHANNELS.cancel}. */
export type CancelRunRequest = {
  /** Id of the run to abort. */
  runId: string;
};

/**
 * Envelope wrapping a streamed {@link RunEvent}. Boxing the union keeps the
 * platform `buildEmitter<Params>` conditional non-distributive (otherwise the
 * union would collapse to `never`).
 */
export type RunEventEnvelope = {
  /** The streamed run-log event. */
  event: RunEvent;
};

/** Typed Automation channels. Exported for bootstrap registration wiring. */
export const automationChannels = {
  list: bridge.buildProvider<AutomationResult<Workflow[]>, void>(AUTOMATION_CHANNELS.list),
  get: bridge.buildProvider<AutomationResult<Workflow | null>, AutomationIdRequest>(AUTOMATION_CHANNELS.get),
  save: bridge.buildProvider<AutomationResult<Workflow>, SaveWorkflowRequest>(AUTOMATION_CHANNELS.save),
  remove: bridge.buildProvider<AutomationResult<Workflow[]>, AutomationIdRequest>(AUTOMATION_CHANNELS.remove),
  run: bridge.buildProvider<AutomationResult<RunWorkflowResult>, RunWorkflowRequest>(AUTOMATION_CHANNELS.run),
  cancel: bridge.buildProvider<AutomationResult<void>, CancelRunRequest>(AUTOMATION_CHANNELS.cancel),
  event: bridge.buildEmitter<RunEventEnvelope>(AUTOMATION_CHANNELS.event),
};

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** The Main-process services the Automation bridge operates on. */
export type AutomationServices = {
  /** Persistence + CRUD for workflows. */
  store: IAutomationStore;
  /** Engine factory bound to the shared event emitter (one engine per process). */
  engine: IWorkflowEngine;
  /** Cron scheduler that fires `trigger.schedule` workflows on time. */
  scheduler: IAutomationScheduler;
};

/** Options for {@link registerAutomationBridge}. */
export type RegisterAutomationBridgeOptions = {
  /** Override the services entirely (tests / advanced bootstrap). */
  services?: AutomationServices;
  /**
   * Main-owned, run-bound egress admission. It is intentionally optional only
   * so bootstrap stays fail-closed while TrustBroker migration is incomplete.
   */
  egressAuthority?: AutomationEgressAuthority;
  /** Main-owned shared RunKernel authority; omitting it fails workflow starts closed. */
  trustRuntime?: FoundationTrustRuntime;
  /** Test-only isolated kernel; production uses the durable Foundation kernel. */
  kernel?: RunKernel;
};

/** Main-only authorization assertion supplied by the account session boundary. */
export type RequireAuthenticatedAccount = () => void;

/**
 * Main-only gate shared by every Automation execution entry point. The account
 * lifecycle owns activation and revocation; callers cannot turn it on from IPC
 * or an MCP tool.
 */
export type AutomationExecutionController = Readonly<{
  start(): void;
  stop(): Promise<void>;
  requireExecution(): void;
}>;

export type CreateAutomationExecutionControllerOptions = Readonly<{
  requireAuthenticatedAccount: RequireAuthenticatedAccount;
  closeMcpHost?: () => Promise<void>;
}>;

export type CreateAutomationBackgroundControllerOptions = Readonly<{
  services?: AutomationServices;
  requireAuthenticatedAccount?: RequireAuthenticatedAccount;
  startWebhook?: (services: AutomationServices) => Promise<WebhookServer>;
  stopWebhook?: () => Promise<void>;
  startMcp?: () => Promise<void>;
  executionController?: AutomationExecutionController;
}>;

/**
 * The only lifecycle that may arm scheduled work or bind the webhook listener.
 * Registration remains available while signed out; execution does not.
 */
export type AutomationBackgroundController = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

/** Lazily-built default services, shared across repeated registrations. */
let defaultServices: AutomationServices | undefined;

/** In-flight runs (module-level): runId → controller, so both the IPC bridge and
 * the MCP server can start/cancel runs against the same shared engine. */
const activeRuns = new Map<string, AbortController>();

let executionController: AutomationExecutionController | undefined;
let mainEgressAuthority: AutomationEgressAuthority | undefined;
let mainTrustRuntime: FoundationTrustRuntime | undefined;
let mainKernel: RunKernel | undefined;

/** Stable Main-owned origin for all workflow execution entry points. */
const AUTOMATION_FOUNDATION_ORIGIN = 'tomny://automation';
const AUTOMATION_WORKFLOW_TARGET_ID = 'automation-workflow';
const AUTOMATION_WORKSPACE_SCOPE = 'automation://local';

/**
 * Do not capture a bootstrap-time authority in the engine: a session lifecycle
 * can attach or revoke its run-bound authority after services are constructed.
 */
const requireAutomationEgressAuthority: AutomationEgressAuthority = {
  authorizeExternalEgress: async (request) => {
    if (!mainEgressAuthority) throw new Error(AUTOMATION_EGRESS_AUTHORITY_REQUIRED);
    await mainEgressAuthority.authorizeExternalEgress(request);
  },
};

const abortActiveRuns = (): void => {
  for (const controller of activeRuns.values()) controller.abort();
  activeRuns.clear();
};

/** Build the account-lifecycle-owned gate for Automation execution. */
export const createAutomationExecutionController = (
  options: CreateAutomationExecutionControllerOptions
): AutomationExecutionController => {
  let active = false;
  const closeMcpHost = options.closeMcpHost ?? stopAutomationMcpHost;

  return {
    start: () => {
      options.requireAuthenticatedAccount();
      active = true;
    },
    stop: async () => {
      active = false;
      abortActiveRuns();
      await closeMcpHost();
    },
    requireExecution: () => {
      if (!active) throw new Error('AUTOMATION_ACCOUNT_EXECUTION_INACTIVE');
      options.requireAuthenticatedAccount();
    },
  };
};

/** Assert that a Main-owned, currently active account lifecycle permits execution. */
export const requireAutomationExecution = (): void => {
  if (!executionController) throw new Error('AUTOMATION_ACCOUNT_EXECUTION_UNCONFIGURED');
  executionController.requireExecution();
};

/**
 * Start a workflow run against the shared engine, streaming events over the
 * emitter. Returns the assigned runId immediately (does not await completion).
 * Shared by the IPC `automation.run` handler and the Automation MCP server.
 *
 * @param id Workflow id to run.
 * @param input Optional seed value for the first node (e.g. a webhook payload).
 */
export const startWorkflowRun = async (id: string, input?: unknown): Promise<{ runId: string }> => {
  requireAutomationExecution();
  const { store, engine } = getAutomationServices();
  const workflow = await store.get(id);
  if (!workflow) throw new Error(`Workflow not found: ${id}`);
  const trustRuntime = mainTrustRuntime ?? getConfiguredFoundationTrustRuntime();
  if (trustRuntime === undefined) throw new Error('AUTOMATION_TRUST_RUNTIME_REQUIRED');
  const actorId = trustRuntime.actorId;
  const runId = randomUUID();
  const controller = new AbortController();
  const runtime: FoundationCoreRuntime = {
    listTargets: async () => [
      {
        id: AUTOMATION_WORKFLOW_TARGET_ID,
        kind: 'local',
        available: true,
      },
    ],
    executeToCompletion: async ({ signal }) => {
      const result = await engine.run(workflow, { signal, runId, input });
      if (!result.ok) throw new Error('AUTOMATION_WORKFLOW_FAILED');
      return {
        text: 'Automation workflow completed.',
        evidenceRefs: [`automation-workflow:${runId}`],
      };
    },
  };
  const kernel = mainKernel ?? getFoundationKernel(trustRuntime);
  const intent = {
    runId,
    rootTaskId: `automation-workflow:${runId}`,
    surface: 'automation',
    goal: `Run automation workflow ${workflow.id}.`,
    constraints: [`target:${AUTOMATION_WORKFLOW_TARGET_ID}`, 'private_only'],
    successCriteria: ['automation workflow completed'],
    workspaceScope: AUTOMATION_WORKSPACE_SCOPE,
    userId: actorId,
    createdAt: Date.now(),
    correlationId: runId,
    policyVersion: trustRuntime.policyVersion,
    capabilityGrant: ['target.execute'],
  } as const;
  await trustRuntime.assertRunStart(kernel, intent, AUTOMATION_FOUNDATION_ORIGIN);
  activeRuns.set(runId, controller);
  void executeFoundationHubRun(kernel, runtime, intent, AUTOMATION_FOUNDATION_ORIGIN, controller.signal, {
    allowedTargetIds: [AUTOMATION_WORKFLOW_TARGET_ID],
    permissionMode: 'read-only',
    contextIdentity: { surface: 'automation', personalId: actorId },
    trustRuntime,
  })
    .catch((error) => console.error('[AutomationBridge] Foundation workflow run failed:', error))
    .finally(() => activeRuns.delete(runId));
  return { runId };
};

/** Cancel an in-flight run by id (cooperative abort). */
export const cancelWorkflowRun = (runId: string): void => {
  const controller = activeRuns.get(runId);
  if (controller) {
    controller.abort();
    activeRuns.delete(runId);
  }
};

/** Public accessor for the shared Automation services (store + engine + scheduler). */
export const getSharedAutomationServices = (): AutomationServices => getAutomationServices();

/**
 * Start the webhook HTTP listener. Callers that have an account authority must
 * supply it so a direct Main-process invocation has the same protection as the
 * account execution lease.
 */
export const startAutomationWebhookServer = (
  options: Pick<CreateAutomationBackgroundControllerOptions, 'services' | 'requireAuthenticatedAccount'> = {}
): Promise<WebhookServer> => {
  requireAutomationExecution();
  options.requireAuthenticatedAccount?.();
  const { store } = options.services ?? getAutomationServices();
  return startWebhookServer({ store, runWorkflow: (workflowId, input) => startWorkflowRun(workflowId, input) });
};

/** Create the Main-only lifecycle that owns Automation's background resources. */
export const createAutomationBackgroundController = (
  options: CreateAutomationBackgroundControllerOptions = {}
): AutomationBackgroundController => {
  const services = options.services ?? getAutomationServices();
  const requireAuthenticatedAccount = options.requireAuthenticatedAccount;
  const execution =
    options.executionController ??
    createAutomationExecutionController({
      requireAuthenticatedAccount: () => {
        if (!requireAuthenticatedAccount) throw new Error('AUTOMATION_ACCOUNT_EXECUTION_UNCONFIGURED');
        requireAuthenticatedAccount();
      },
    });
  executionController = execution;
  const startWebhook =
    options.startWebhook ??
    ((current) => startAutomationWebhookServer({ services: current, requireAuthenticatedAccount }));
  const stopWebhook = options.stopWebhook ?? stopWebhookServer;
  const startMcp =
    options.startMcp ??
    (async () => {
      const { ensureAutomationMcpRegistered } = await import('./registerAutomationMcp');
      if (!(await ensureAutomationMcpRegistered())) throw new Error('AUTOMATION_MCP_HOST_START_FAILED');
    });
  let active = false;

  const start = async (): Promise<void> => {
    if (active) return;
    requireAuthenticatedAccount?.();
    execution.start();
    try {
      await services.scheduler.start();
      // A sign-out can race an asynchronous scheduler start. Check again before
      // binding the loopback listener and before marking the lease active.
      requireAuthenticatedAccount?.();
      await startWebhook(services);
      requireAuthenticatedAccount?.();
      await startMcp();
      requireAuthenticatedAccount?.();
      active = true;
    } catch (error) {
      await execution.stop().catch((): void => {});
      services.scheduler.stop();
      await stopWebhook().catch((): void => {});
      throw error;
    }
  };

  const stop = async (): Promise<void> => {
    active = false;
    await execution.stop();
    services.scheduler.stop();
    await stopWebhook();
  };

  return { start, stop };
};

/**
 * Resolve the shared {@link AutomationServices}, constructing the production
 * implementation on first use: a userData-backed store, provider-backed AI
 * executors, and an engine that streams events through the emitter.
 */
const getAutomationServices = (): AutomationServices => {
  if (defaultServices) return defaultServices;
  const store = createAutomationStore();
  // Share one Make Video store so projects produced by the `action.app.makeVideo`
  // node appear in the Make Video Studio view.
  const makeVideoStore = createMakeVideoStore();
  const videoRenderer = createVideoRenderer();
  // Reuse the shared Agent Company services so the `action.company` node drives
  // the same companies the user designed in the Company page. `create` mode
  // needs the role-chart generator (the same one wired by the company bridge).
  const companyServices = getCompanyServices();
  const companyGenerator = createCompanyGenerator();
  // Forward-reference holder so `action.subworkflow` can call the engine that is
  // created just below (avoids a chicken-and-egg between executors and engine).
  const runSubworkflowRef: { run: (workflowId: string, input: unknown) => Promise<unknown> } = {
    run: () => Promise.reject(new Error('Sub-workflow runner not ready.')),
  };
  const executors: NodeExecutorMap = createNodeExecutors({
    chat: createProviderChat(),
    resolveCredential: (id) => resolveCredentialFields(id),
    makeVideo: {
      runScript: (req) => runScript(req),
      runImage: (req) => runImage(req),
      saveProject: (project) => makeVideoStore.save(project),
      renderVideo: (scenes, outputPath) => videoRenderer.render({ scenes, outputPath }),
    },
    company: {
      createCompany: async (description, companyId) => {
        const spec = await createFromDescription(description, { generate: companyGenerator, companyId });
        const existing = await companyServices.configStore.load(spec.companyId).catch((): CompanyConfig | null => null);
        const mergedRules = Array.from(new Set([...(spec.rules ?? []), ...(existing?.rules ?? [])]));
        const config: CompanyConfig = {
          companyId: spec.companyId,
          description,
          presidentName: spec.presidentName,
          divisions: spec.divisions,
          directWorkerCount: spec.directWorkerCount,
          directDivisionId: spec.directDivisionId,
          presidentAssignment: spec.presidentAssignment,
          rules: mergedRules,
        };
        await companyServices.configStore.save(spec.companyId, config);
        return spec.companyId;
      },
      loadCompany: (companyId) => companyServices.configStore.load(companyId),
      buildStructure: (config) => companyServices.buildStructure(toStructureSpec(config as CompanyConfig)),
      getRules: (companyId) => companyServices.configStore.getRules(companyId),
      conversation: companyServices.conversation,
    },
    // App-reuse capabilities — drive existing Tomny features. A workflow id box
    // lets `action.subworkflow` run another saved workflow (set after the engine
    // exists, below, to avoid a chicken-and-egg with the engine reference).
    appReuse: {
      notify: (title, body) => showNotification({ title, body }),
      createManagerEntity: async (entity, payload) => {
        const managerStore = createManagerStore();
        if (entity === 'note') {
          const note = await managerStore.addNote({ title: payload.title, body: payload.detail ?? '' });
          return note.id;
        }
        if (entity === 'event') {
          const startMs = payload.at ? Date.parse(payload.at) : Date.now();
          const at = Number.isFinite(startMs) ? startMs : Date.now();
          const event = await managerStore.addEvent({
            title: payload.title,
            startAt: at,
            endAt: at,
            lockKind: 'flexible',
            source: 'manual',
          });
          return event.id;
        }
        const dueMs = payload.at ? Date.parse(payload.at) : NaN;
        const task = await managerStore.addTask({
          title: payload.title,
          description: payload.detail,
          dueAt: Number.isFinite(dueMs) ? dueMs : null,
        });
        return task.id;
      },
      createCronJob: async ({ cron, prompt, name }) => {
        const created = await httpRequest<{ id?: string }>('POST', '/api/cron/jobs', {
          schedule: cron,
          prompt,
          name: name ?? 'Automation job',
          enabled: true,
          execution_mode: 'new_conversation',
        }).catch((): { id?: string } => ({}));
        return created.id ?? '';
      },
      // `action.conversation` reuses the same provider-backed chat the AI node
      // uses — a single non-streaming completion against the user's model.
      sendConversation: (message, options) => createProviderChat()(options.model ?? '', message),
      // `runBrowserTask` stays unset: it needs a live browser tab + the
      // web-agent runner, which require the Browser surface to be open. The node
      // reports a clear "not wired" message until that wiring lands.
      runSubworkflow: (workflowId, input) => runSubworkflowRef.run(workflowId, input),
    },
  });
  const engine = createWorkflowEngine({
    executors,
    emit: (event: RunEvent) => {
      automationChannels.event.emit({ event });
    },
    // Interim containment: every external leaf stays denied until a Main-owned,
    // run-bound authority is installed by the lifecycle bootstrap.
    egressAuthority: requireAutomationEgressAuthority,
  });

  // Now that the engine exists, let `action.subworkflow` run another saved
  // workflow by id (recursion depth is guarded by the engine's maxDepth/maxSteps).
  runSubworkflowRef.run = async (workflowId: string, input: unknown): Promise<unknown> => {
    const target = await store.get(workflowId);
    if (!target) throw new Error(`Sub-workflow not found: ${workflowId}`);
    const result = await engine.run(target, { input });
    return result.output;
  };

  // Build the scheduler but do NOT start it yet — the bridge's run handler must
  // be registered first (the account execution lease starts it after sign-in).
  const scheduler = createAutomationScheduler({
    store,
    runWorkflow: async (workflowId) => {
      await startWorkflowRun(workflowId);
    },
  });

  defaultServices = { store, engine, scheduler };
  return defaultServices;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the Automation IPC handlers. Idempotent (re-registration replaces the
 * bound handlers). Intended to be invoked once during Main-process bootstrap.
 *
 * @param options Injected services (defaults to the shared production services).
 */
export function registerAutomationBridge(options: RegisterAutomationBridgeOptions = {}): void {
  mainEgressAuthority = options.egressAuthority;
  mainTrustRuntime = options.trustRuntime;
  mainKernel = options.kernel;
  const { store } = options.services ?? getAutomationServices();
  if (options.services) defaultServices = options.services;

  // IPC registration intentionally does not activate background execution.
  // The account-scoped lifecycle owns scheduler and webhook start/stop.

  automationChannels.list.provider(async (): Promise<AutomationResult<Workflow[]>> => {
    try {
      return { ok: true, data: await store.list() };
    } catch (error) {
      console.error('[AutomationBridge] list failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  automationChannels.get.provider(async (req): Promise<AutomationResult<Workflow | null>> => {
    try {
      const found = await store.get(req.id);
      return { ok: true, data: found ?? null };
    } catch (error) {
      console.error('[AutomationBridge] get failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  automationChannels.save.provider(async (req): Promise<AutomationResult<Workflow>> => {
    try {
      return { ok: true, data: await store.save(req.workflow) };
    } catch (error) {
      console.error('[AutomationBridge] save failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  automationChannels.remove.provider(async (req): Promise<AutomationResult<Workflow[]>> => {
    try {
      return { ok: true, data: await store.remove(req.id) };
    } catch (error) {
      console.error('[AutomationBridge] remove failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  automationChannels.run.provider(async (req): Promise<AutomationResult<RunWorkflowResult>> => {
    try {
      return { ok: true, data: await startWorkflowRun(req.id) };
    } catch (error) {
      console.error('[AutomationBridge] run failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  automationChannels.cancel.provider((req): Promise<AutomationResult<void>> => {
    cancelWorkflowRun(req.runId);
    return Promise.resolve({ ok: true, data: undefined });
  });
}

/** Reset the lazily-built default services (deterministic teardown for tests). */
export function disposeAutomationBridge(): void {
  defaultServices?.scheduler.stop();
  void stopWebhookServer();
  void executionController?.stop();
  executionController = undefined;
  mainEgressAuthority = undefined;
  mainTrustRuntime = undefined;
  mainKernel = undefined;
  defaultServices = undefined;
}
