import { afterEach, describe, expect, it } from 'vitest';
import { FoundationTrustRuntime } from '@process/foundation/runKernel';
import {
  createAutomationBackgroundController,
  createAutomationExecutionController,
  disposeAutomationBridge,
  registerAutomationBridge,
  startAutomationWebhookServer,
  startWorkflowRun,
  type AutomationServices,
} from '@process/automation/automationBridge';
import { startAutomation } from '@process/automation/automationMcpWiring';

afterEach(() => {
  disposeAutomationBridge();
});

const createAutomationTrustRuntime = (): FoundationTrustRuntime =>
  new FoundationTrustRuntime({
    actorId: () => 'account-1',
    policy: {
      allowedCapabilities: ['target.execute'],
      allowedNetworkHosts: [],
      trustedPackageIds: [],
      allowedOrigins: ['tomny://automation'],
      requireApprovalForMutation: true,
      capabilityGrantTtlMs: 60_000,
      policyVersion: 'automation-test-v1',
    },
  });

describe('Automation account execution guard', () => {
  it('fails closed for renderer, MCP, and webhook execution before its account lifecycle starts', async () => {
    const controller = createAutomationExecutionController({
      requireAuthenticatedAccount: () => undefined,
      closeMcpHost: async () => undefined,
    });
    const services = {
      store: { get: async () => undefined },
      scheduler: { start: async () => undefined, stop: () => undefined },
    } as unknown as AutomationServices;
    createAutomationBackgroundController({
      services,
      executionController: controller,
      startMcp: async () => undefined,
    });
    registerAutomationBridge({ services });

    await expect(startWorkflowRun('workflow-1')).rejects.toThrow('AUTOMATION_ACCOUNT_EXECUTION_INACTIVE');
    expect(() => startAutomationWebhookServer({ services })).toThrow('AUTOMATION_ACCOUNT_EXECUTION_INACTIVE');
    expect(() => startAutomation()).toThrow('AUTOMATION_ACCOUNT_EXECUTION_INACTIVE');
  });

  it('fails closed before an enabled workflow reaches its engine without a Foundation trust runtime', async () => {
    let executed = false;
    const services = {
      store: {
        get: async () => ({ id: 'workflow-1', name: 'Workflow', nodes: [], enabled: true }),
      },
      engine: {
        run: async () => {
          executed = true;
          return { runId: 'unexpected', ok: true };
        },
      },
      scheduler: { start: async () => undefined, stop: () => undefined },
    } as unknown as AutomationServices;
    const controller = createAutomationExecutionController({
      requireAuthenticatedAccount: () => undefined,
      closeMcpHost: async () => undefined,
    });
    const background = createAutomationBackgroundController({
      services,
      executionController: controller,
      startWebhook: async () => ({}) as never,
      startMcp: async () => undefined,
    });
    registerAutomationBridge({ services });

    await background.start();
    await expect(startWorkflowRun('workflow-1')).rejects.toThrow('AUTOMATION_TRUST_RUNTIME_REQUIRED');
    expect(executed).toBe(false);
    await background.stop();
  });

  it('records a verified Foundation receipt for a completed workflow', async () => {
    const trustRuntime = createAutomationTrustRuntime();
    const kernel = trustRuntime.createRunKernel();
    const services = {
      store: {
        get: async () => ({ id: 'workflow-1', name: 'Workflow', nodes: [], enabled: true }),
      },
      engine: {
        run: async () => ({ runId: 'engine-owned-id', ok: true }),
      },
      scheduler: { start: async () => undefined, stop: () => undefined },
    } as unknown as AutomationServices;
    const controller = createAutomationExecutionController({
      requireAuthenticatedAccount: () => undefined,
      closeMcpHost: async () => undefined,
    });
    const background = createAutomationBackgroundController({
      services,
      executionController: controller,
      startWebhook: async () => ({}) as never,
      startMcp: async () => undefined,
    });
    registerAutomationBridge({ services, trustRuntime, kernel });

    await background.start();
    const { runId } = await startWorkflowRun('workflow-1');
    await expect
      .poll(async () => (await kernel.getEventsForAccount('account-1', runId))?.at(-1)?.eventType)
      .toBe('outcome.verified');
    await background.stop();
  });

  it('aborts active runs and closes the MCP host when the account lifecycle stops', async () => {
    let schedulerStops = 0;
    let webhookStops = 0;
    let mcpStarts = 0;
    let mcpCloses = 0;
    let aborted = false;
    let engineStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      engineStarted = resolve;
    });
    const services = {
      store: {
        get: async () => ({ id: 'workflow-1', name: 'Workflow', nodes: [], enabled: true }),
      },
      engine: {
        run: async (_workflow: unknown, options: { signal?: AbortSignal }) =>
          new Promise<void>((_resolve, reject) => {
            engineStarted?.();
            options.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      },
      scheduler: {
        start: async () => undefined,
        stop: () => {
          schedulerStops++;
        },
      },
    } as unknown as AutomationServices;
    const controller = createAutomationExecutionController({
      requireAuthenticatedAccount: () => undefined,
      closeMcpHost: async () => {
        mcpCloses++;
      },
    });
    const background = createAutomationBackgroundController({
      services,
      executionController: controller,
      startWebhook: async () => ({}) as never,
      stopWebhook: async () => {
        webhookStops++;
      },
      startMcp: async () => {
        mcpStarts++;
      },
    });
    const trustRuntime = createAutomationTrustRuntime();
    registerAutomationBridge({ services, trustRuntime, kernel: trustRuntime.createRunKernel() });

    await background.start();
    await startWorkflowRun('workflow-1');
    await started;
    await background.stop();
    await Promise.resolve();

    expect(aborted).toBe(true);
    expect(schedulerStops).toBe(1);
    expect(webhookStops).toBe(1);
    expect(mcpStarts).toBe(1);
    expect(mcpCloses).toBe(1);
  });
});
