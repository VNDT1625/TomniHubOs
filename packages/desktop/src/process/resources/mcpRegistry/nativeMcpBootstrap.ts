import type { IMcpServer } from '@/common/config/storage';
import { BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import { removeImageGenerationEnvKeys } from '@/common/config/imageGenerationMcpEnv';
import { getBuiltinMcpScriptPath } from '@process/utils/initStorage';
import { ensureLegacyMcpImported, getMcpRegistry } from './mcpRegistryBridge';

const BUILTIN_CHROME_DEVTOOLS_NAME = 'chrome-devtools';

export type NativeMcpRegistrar = {
  name: string;
  run(): Promise<boolean>;
};

export type NativeMcpBootstrapOptions = {
  /** Observability only: native MCP initialization is never gated by this value. */
  legacyBackendStarted?: boolean;
  registrars?: readonly NativeMcpRegistrar[];
  seedDefaults?: () => Promise<void>;
  ensureLegacyImport?: () => Promise<void>;
};

export type NativeMcpBootstrapResult = {
  seeded: boolean;
  registered: string[];
  failed: Array<{ name: string; error: string }>;
};

let bootstrapPromise: Promise<NativeMcpBootstrapResult> | undefined;

/**
 * Built-in MCP services owned by the Hub base. Optional application MCPs are
 * activated by their installed package and must never be added to this list.
 */
export const createCoreNativeMcpRegistrars = (): NativeMcpRegistrar[] => [
  {
    name: 'agent-orchestrator',
    run: async () =>
      (await import('@process/agentRuntime/agentMesh/mcp/register')).ensureAgentOrchestratorMcpRegistered(),
  },
  {
    name: 'secret-context',
    run: async () =>
      (await import('@process/agentRuntime/agentMesh/mcp/secret-context/register')).ensureSecretContextMcpRegistered(),
  },
  { name: 'cron', run: async () => (await import('@process/cron/registerCronMcp')).ensureCronMcpRegistered() },
  {
    name: 'manager',
    run: async () => (await import('@process/manager/registerManagerMcp')).ensureManagerMcpRegistered(),
  },
  {
    name: 'system-info',
    run: async () => (await import('@process/system/registerSystemInfoMcp')).ensureSystemInfoMcpRegistered(),
  },
  {
    name: 'realtime-knowledge',
    run: async () =>
      (await import('@process/knowledge/registerRealtimeKnowledgeMcp')).ensureRealtimeKnowledgeMcpRegistered(),
  },
];

const chromeServer = (): Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'> => {
  const config = { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] };
  return {
    name: BUILTIN_CHROME_DEVTOOLS_NAME,
    description: 'Default MCP server: chrome-devtools',
    enabled: false,
    builtin: true,
    transport: { type: 'stdio', ...config },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_CHROME_DEVTOOLS_NAME]: config } }, null, 2),
  };
};

/**
 * A stdio child cannot receive a BYOK credential until it uses a Main-owned
 * governed request protocol. Scrub legacy transport values and keep the route
 * disabled rather than resolving a provider secret into the child environment.
 */
export const createDisabledNativeImageMcpServer = (
  existing: IMcpServer | undefined
): Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'> => {
  const existingEnv = existing?.transport.type === 'stdio' ? existing.transport.env : undefined;
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-image-gen');
  const env = removeImageGenerationEnvKeys(existingEnv ?? {});
  const transport = { type: 'stdio' as const, command: 'node', args: [scriptPath], env };
  return {
    name: BUILTIN_IMAGE_GEN_NAME,
    description:
      'Built-in image generation is unavailable until its governed provider execution protocol is installed.',
    enabled: false,
    builtin: true,
    transport,
    original_json: JSON.stringify(
      { mcpServers: { [BUILTIN_IMAGE_GEN_NAME]: { command: 'node', args: [scriptPath], env } } },
      null,
      2
    ),
  };
};

const sameTransport = (left: IMcpServer['transport'], right: IMcpServer['transport']): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Seed defaults and refresh stale legacy built-in transports using only native stores. */
export const ensureNativeDefaultMcpServers = async (): Promise<void> => {
  const registry = getMcpRegistry();
  await ensureLegacyMcpImported(registry);
  const existing = await registry.list();
  const byName = new Map(existing.map((server) => [server.name, server]));
  const defaults = [chromeServer(), createDisabledNativeImageMcpServer(byName.get(BUILTIN_IMAGE_GEN_NAME))];

  for (const draft of defaults) {
    const current = byName.get(draft.name);
    if (!current) {
      // Startup registration is intentionally serialized with registry writes.
      // eslint-disable-next-line no-await-in-loop
      await registry.importMany([draft]);
      continue;
    }
    const needsRefresh =
      current.builtin !== true ||
      current.enabled !== draft.enabled ||
      !sameTransport(current.transport, draft.transport) ||
      current.original_json !== draft.original_json;
    if (!needsRefresh) continue;
    // eslint-disable-next-line no-await-in-loop
    await registry.update(current.id, {
      description: draft.description,
      transport: draft.transport,
      original_json: draft.original_json,
      builtin: true,
    });
    if (current.enabled !== draft.enabled) {
      // The registry only exposes a bounded toggle for enabled state.
      // eslint-disable-next-line no-await-in-loop
      await registry.toggle(current.id);
    }
  }
};

/**
 * Idempotent native startup bootstrap. `legacyBackendStarted` is deliberately
 * ignored: built-in MCP availability must not depend on the old executable.
 */
export const runNativeMcpBootstrap = (options: NativeMcpBootstrapOptions = {}): Promise<NativeMcpBootstrapResult> => {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const failed: NativeMcpBootstrapResult['failed'] = [];
    let seeded = false;
    try {
      await (options.ensureLegacyImport ?? (() => ensureLegacyMcpImported()))();
      await (options.seedDefaults ?? ensureNativeDefaultMcpServers)();
      seeded = true;
    } catch (error) {
      failed.push({ name: 'defaults', error: error instanceof Error ? error.message : String(error) });
    }

    const registrars = options.registrars ?? createCoreNativeMcpRegistrars();
    const results = await Promise.allSettled(registrars.map((registrar) => registrar.run()));
    const registered: string[] = [];
    results.forEach((result, index) => {
      const registrar = registrars[index];
      if (result.status === 'fulfilled' && result.value) {
        registered.push(registrar.name);
        return;
      }
      const error = result.status === 'rejected' ? result.reason : 'registration returned false';
      failed.push({ name: registrar.name, error: error instanceof Error ? error.message : String(error) });
    });

    console.info(
      '[Tomny] Native MCP bootstrap completed: defaults=%s, registered=%d, failed=%d, legacyBackendStarted=%s',
      seeded ? 'ready' : 'failed',
      registered.length,
      failed.length,
      options.legacyBackendStarted === true ? 'yes' : 'no'
    );
    return { seeded, registered, failed };
  })();
  return bootstrapPromise;
};

export const resetNativeMcpBootstrapForTests = (): void => {
  bootstrapPromise = undefined;
};
