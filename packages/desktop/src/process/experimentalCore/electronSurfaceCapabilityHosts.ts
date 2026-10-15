/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILTIN_CORE_WORKSPACE_NAME } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { BUILTIN_AGENT_ORCHESTRATOR_NAME } from '@process/agentRuntime/agentMesh/mcp/server';
import { BUILTIN_SECRET_CONTEXT_NAME } from '@process/agentRuntime/agentMesh/mcp/secret-context/server';
import { configureSecretContextVault } from '@process/agentRuntime/agentMesh/mcp/secret-context/wiring';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { BUILTIN_TOOL_SELECTOR_NAME } from '@process/resources/builtinMcp/toolSelectorServer';
import { BUILTIN_BROWSER_CONTROL_NAME } from '@process/browser/browserControlServer';
import { BUILTIN_OFFICE_EDITOR_NAME } from '@process/resources/builtinMcp/officeEditorServer';
import { BUILTIN_NOTIFICATION_HUB_NAME } from '@process/system/hubActivity/notificationInsights/notificationMcpServer';

import type { CoreCapabilityHostContext, CoreMcpServer } from './adapters';

export type SurfaceCapabilityHostFactory = (context?: CoreCapabilityHostContext) => Promise<CoreMcpServer>;

type SurfaceCapabilityHostRegistration = {
  factory: SurfaceCapabilityHostFactory;
  cache: boolean;
};

/** Dynamic host registry: adding a future surface does not require adapter changes. */
export class ElectronSurfaceCapabilityHosts {
  private readonly factories = new Map<string, SurfaceCapabilityHostRegistration>();
  private readonly active = new Map<string, Promise<CoreMcpServer>>();

  public register(serverName: string, factory: SurfaceCapabilityHostFactory, replace = false, cache = true): void {
    const name = serverName.trim();
    if (!name) throw new Error('Capability server name cannot be empty.');
    if (!replace && this.factories.has(name)) throw new Error(`Capability host ${name} is already registered.`);
    this.factories.set(name, { factory, cache });
    if (replace) this.active.delete(name);
  }

  /** Names that can be started in this process, detached from internal state. */
  public names(): string[] {
    return [...this.factories.keys()];
  }

  public async resolve(
    serverNames: string[],
    sessionServers: CoreMcpServer[] = [],
    context?: CoreCapabilityHostContext
  ): Promise<CoreMcpServer[]> {
    const requestedNames = serverNames.map((name) => name.trim()).filter(Boolean);
    const allowedManagedNames = new Set(requestedNames.map((name) => name.toLowerCase()));
    const attachedManagedNames = sessionServers
      .map((server) => server.name.trim())
      .filter((name) => this.factories.has(name) && allowedManagedNames.has(name.toLowerCase()));
    const unique = [...new Set([...requestedNames, ...attachedManagedNames])];
    const liveServers = await Promise.all(
      unique.map(async (name) => {
        const registration = this.factories.get(name);
        if (!registration) throw new Error(`The selected surface requires unavailable capability host ${name}.`);
        if (!registration.cache) return registration.factory(context);
        let started = this.active.get(name);
        if (!started) {
          started = registration.factory(context).catch((error) => {
            this.active.delete(name);
            throw error;
          });
          this.active.set(name, started);
        }
        return started;
      })
    );
    const names = new Set(liveServers.map((server) => server.name.toLowerCase()));
    const selected = sessionServers.filter((server) => {
      const name = server.name.trim();
      const key = name.toLowerCase();
      if (!key || names.has(key)) return false;
      if (this.factories.has(name) && !allowedManagedNames.has(key)) return false;
      names.add(key);
      return true;
    });
    return [...liveServers, ...selected];
  }
}

/** Built-in Main-process capability providers; plugins may register additional names later. */
export const createElectronSurfaceCapabilityHosts = (
  vault?: SecretVault,
  options: {
    /** The Package App behind a surface, resolved by Main; selects that package's secret sets for the run. */
    packageIdOfSurface?: (surfaceId: string) => string | undefined;
    publishLiveImageOutput?: (update: unknown) => void;
  } = {}
): ElectronSurfaceCapabilityHosts => {
  if (vault) {
    configureSecretContextVault(vault);
  }
    const registry = new ElectronSurfaceCapabilityHosts();
    // Workflow is assembled by the runtime ONLY after it has resolved the already-granted
  // child hosts. A standalone registry resolve must not create an unscoped workflow.
  registry.register('tomny-workflow', async () => {
    throw new Error('WORKFLOW_REQUIRES_SCOPED_RUNTIME');
  }, false, false);
  // Only Main may request this server after validating attached file paths and Surface grants.
  registry.register('tomny-attached-file-tools', async (context) => {
    if (!context) throw new Error('ATTACHED_FILE_WORKSPACE_REQUIRED');
    const { startAttachedFileToolsHost } = await import('@process/resources/nativeFile/coreWorkspaceMcpHost');
    const host = await startAttachedFileToolsHost(context.workspace);
    return { name: 'tomny-attached-file-tools', url: host.url, headers: host.headers, deferred: false };
  }, false, false);
  // One loopback host serves every conversation; the scope in its URL narrows tools_search and tools_guide to the
  // tools that conversation can load, so it is resolved per session instead of cached.
  registry.register(
    BUILTIN_TOOL_SELECTOR_NAME,
    async (context) => {
      const [{ startToolSelectorMcpHost }, { getToolSelectorServices }, { registerToolScope }] = await Promise.all([
        import('@process/toolselect/toolSelectorMcpHost'),
        import('@process/toolselect/wiring'),
        import('@process/toolselect/toolScope'),
      ]);
      const host = await startToolSelectorMcpHost(getToolSelectorServices());
      // The conversation id lets the plugin fallback tool read this conversation's capability pool.
      const query = [
        context?.toolPatterns ? `scope=${registerToolScope(context.toolPatterns)}` : '',
        context?.conversationId ? `conversation=${encodeURIComponent(context.conversationId)}` : '',
      ].filter(Boolean);
      const url = query.length > 0 ? `${host.url}?${query.join('&')}` : host.url;
      return { name: BUILTIN_TOOL_SELECTOR_NAME, url, headers: host.headers };
    },
    false,
    false
  );
  registry.register(BUILTIN_BROWSER_CONTROL_NAME, async (context) => {
    const [{ getApplicationMainWindow }, { getBrowserControlDeps }, { startBrowserControlMcpHost }] = await Promise.all([
      import('@process/bridge/applicationBridge'),
      import('@process/browser/browserControlWiring'),
      import('@process/browser/browserControlMcpHost'),
    ]);
    const deps = getBrowserControlDeps(getApplicationMainWindow);
    const host = await startBrowserControlMcpHost(
      context?.requestId && context.conversationId && options.publishLiveImageOutput
        ? {
            ...deps,
            publishLiveScreenshot: async ({ outputId, tabId }) => {
              await options.publishLiveImageOutput?.({
                outputId,
                tabId,
                requestId: context.requestId,
                conversationId: context.conversationId,
                workspace: context.workspace,
              });
            },
          }
        : deps,
      context?.requestId && context.conversationId ? context.requestId : undefined
    );
    return { name: BUILTIN_BROWSER_CONTROL_NAME, url: host.url };
  }, false, false);
  registry.register(BUILTIN_OFFICE_EDITOR_NAME, async () => {
    const { startOfficeEditor } = await import('@process/editor/officeEditorMcpWiring');
    const host = await startOfficeEditor();
    return { name: BUILTIN_OFFICE_EDITOR_NAME, url: host.url };
  });
  registry.register(
    BUILTIN_CORE_WORKSPACE_NAME,
    async (context) => {
      if (!context) throw new Error('The Core workspace tools need the conversation workspace.');
      const { startCoreWorkspaceReadHost } = await import('@process/resources/nativeFile/coreWorkspaceMcpHost');
      const host = await startCoreWorkspaceReadHost(context.workspace);
      return { name: BUILTIN_CORE_WORKSPACE_NAME, url: host.url, headers: host.headers };
    },
    false,
    false
  );
  registry.register(
    BUILTIN_AGENT_ORCHESTRATOR_NAME,
    async (context) => {
      const { startAgentOrchestratorMcpHost } = await import('@process/agentRuntime/agentMesh/mcp/host');
      const host = context
        ? await startAgentOrchestratorMcpHost({
            scope: {
              id: `core:${context.sessionId}`,
              executionClaims: {
                workspace: context.workspace,
                surface: context.surface,
                permissionMode: context.permissionMode,
              },
              requestPermission: context.requestPermission,
            },
          })
        : await startAgentOrchestratorMcpHost();
      return { name: BUILTIN_AGENT_ORCHESTRATOR_NAME, url: host.url, headers: host.headers };
    },
    false,
    false
  );
  // Read-only notification tools; one host serves every conversation and holds no per-session authority.
  registry.register(BUILTIN_NOTIFICATION_HUB_NAME, async () => {
    const [{ startNotificationMcpHost }, { getNotificationHub }] = await Promise.all([
      import('@process/system/hubActivity/notificationInsights/notificationMcpHost'),
      import('@process/system/hubActivity/notifications/notificationHubBridge'),
    ]);
    const host = await startNotificationMcpHost(() => getNotificationHub()?.readView());
    return { name: BUILTIN_NOTIFICATION_HUB_NAME, url: host.url, headers: host.headers };
  });
  registry.register(
    BUILTIN_SECRET_CONTEXT_NAME,
    async (context) => {
      if (!context) throw new Error('Secret Context requires a scoped Core session authority.');
      const { startSecretContextMcpHost } = await import('@process/agentRuntime/agentMesh/mcp/secret-context/host');
      const host = await startSecretContextMcpHost({
        scope: {
          id: `core:${context.sessionId}`,
          surface: context.surface,
          sessionId: context.sessionId,
          ...(options.packageIdOfSurface?.(context.surface)
            ? { packageId: options.packageIdOfSurface(context.surface) }
            : {}),
        },
      });
      return { name: BUILTIN_SECRET_CONTEXT_NAME, url: host.url, headers: host.headers };
    },
    false,
    false
  );
  return registry;
};
