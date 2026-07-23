import { getMcpRegistry } from '@process/resources/mcpRegistry';
import { startAgentOrchestratorMcpHost } from './host';
import { BUILTIN_AGENT_ORCHESTRATOR_NAME } from './server';

const DESCRIPTION =
  'Built-in Tomny Core subagent orchestration: bounded parallel jobs, durable result tracking, messaging, cancellation and multi-turn resume.';

/** Start the live host and refresh its ephemeral authenticated loopback catalog entry. */
export const ensureAgentOrchestratorMcpRegistered = async (): Promise<boolean> => {
  try {
    const host = await startAgentOrchestratorMcpHost();
    // Keep the per-process bearer token out of the durable catalog and renderer.
    // Core capability hosts inject it only when constructing the live transport.
    const transport = { type: 'sse' as const, url: host.url };
    const original_json = JSON.stringify(
      { mcpServers: { [BUILTIN_AGENT_ORCHESTRATOR_NAME]: { url: host.url } } },
      null,
      2
    );
    const registry = getMcpRegistry();
    const current = (await registry.list()).find((server) => server.name === BUILTIN_AGENT_ORCHESTRATOR_NAME);
    if (!current) {
      await registry.importMany([
        {
          name: BUILTIN_AGENT_ORCHESTRATOR_NAME,
          description: DESCRIPTION,
          enabled: true,
          builtin: true,
          transport,
          original_json,
        },
      ]);
      return true;
    }
    const unchanged =
      current.transport.type === 'sse' &&
      current.transport.url === host.url &&
      Object.keys(current.transport.headers ?? {}).length === 0 &&
      current.original_json === original_json &&
      current.description === DESCRIPTION &&
      current.builtin === true;
    if (!unchanged) {
      await registry.update(current.id, {
        description: DESCRIPTION,
        transport,
        original_json,
        builtin: true,
      });
    }
    return true;
  } catch (error) {
    console.warn('[AgentOrchestratorMCP] Could not register the live host:', error);
    return false;
  }
};
