/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILTIN_AGENT_ORCHESTRATOR_NAME } from '@process/agentRuntime/agentMesh/mcp/server';
import { BUILTIN_SECRET_CONTEXT_NAME } from '@process/agentRuntime/agentMesh/mcp/secret-context/server';
import { configureSecretContextVault } from '@process/agentRuntime/agentMesh/mcp/secret-context/wiring';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { BUILTIN_TOOL_SELECTOR_NAME } from '@process/resources/builtinMcp/toolSelectorServer';

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
export const createElectronSurfaceCapabilityHosts = (vault?: SecretVault): ElectronSurfaceCapabilityHosts => {
  if (vault) {
    configureSecretContextVault(vault);
  }
  const registry = new ElectronSurfaceCapabilityHosts();
  registry.register(BUILTIN_TOOL_SELECTOR_NAME, async () => {
    const [{ startToolSelectorMcpHost }, { getToolSelectorServices }] = await Promise.all([
      import('@process/toolselect/toolSelectorMcpHost'),
      import('@process/toolselect/wiring'),
    ]);
    const host = await startToolSelectorMcpHost(getToolSelectorServices());
    return { name: BUILTIN_TOOL_SELECTOR_NAME, url: host.url, headers: host.headers };
  });
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
  registry.register(
    BUILTIN_SECRET_CONTEXT_NAME,
    async (context) => {
      if (!context) throw new Error('Secret Context requires a scoped Core session authority.');
      const { startSecretContextMcpHost } = await import('@process/agentRuntime/agentMesh/mcp/secret-context/host');
      const host = await startSecretContextMcpHost({
        scope: { id: `core:${context.sessionId}`, surface: context.surface },
      });
      return { name: BUILTIN_SECRET_CONTEXT_NAME, url: host.url, headers: host.headers };
    },
    false,
    false
  );
  return registry;
};
