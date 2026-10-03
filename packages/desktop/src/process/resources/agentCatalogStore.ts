import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentMetadata, CustomAgentRequest } from '@/common/types/agent/agentMetadata';
import {
  clearExecutableResolutionCache,
  detectCoreTargets,
  resolveExecutableOnPath,
} from '@process/experimentalCore/coreRegistry';

type StoredAgentCatalog = { custom: AgentMetadata[]; enabled: Record<string, boolean> };
export type AgentCatalogStore = {
  list(): Promise<AgentMetadata[]>;
  refresh(): Promise<AgentMetadata[]>;
  create(input: CustomAgentRequest): Promise<AgentMetadata>;
  update(id: string, input: CustomAgentRequest): Promise<AgentMetadata>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<AgentMetadata>;
  importLegacy(rows: AgentMetadata[]): Promise<number>;
  test(input: { command: string }): Promise<{ step: 'success' } | { step: 'fail_cli'; error: string }>;
};
const clone = <T>(value: T): T => structuredClone(value);
const targetToAgent = (target: Awaited<ReturnType<typeof detectCoreTargets>>[number]): AgentMetadata => ({
  id: target.id,
  name: target.name,
  description: target.detail,
  backend: target.id,
  agent_type: target.id === 'tomny' ? 'tomnyagentic' : target.protocol === 'tomny-remote-v1' ? 'remote' : 'acp',
  agent_source: 'builtin',
  enabled: true,
  available: target.id === 'tomny' ? true : target.available,
  team_capable: target.protocol === 'acp' || target.protocol === 'tomny-json-stream',
  command: target.command ?? target.candidates[0],
  args: target.args,
});
export const createAgentCatalogStore = (filePath: string): AgentCatalogStore => {
  let loaded = false;
  let state: StoredAgentCatalog = { custom: [], enabled: {} };
  let writes = Promise.resolve();
  let cachedBuiltin: AgentMetadata[] | null = null;
  let cachedBuiltinTime = 0;
  const BUILTIN_CACHE_TTL_MS = 30_000;

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<StoredAgentCatalog>;
      state = {
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
        enabled: parsed.enabled && typeof parsed.enabled === 'object' ? parsed.enabled : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    loaded = true;
  };
  const persist = async (): Promise<void> => {
    const snapshot = clone(state);
    writes = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
      await rename(temporary, filePath);
    });
    await writes;
  };
  const hydrateCustom = async (agent: AgentMetadata): Promise<AgentMetadata> => ({
    ...agent,
    enabled: state.enabled[agent.id] ?? agent.enabled,
    available: Boolean(agent.command && (await resolveExecutableOnPath([agent.command]))),
  });
  const buildList = async (forceFresh = false): Promise<AgentMetadata[]> => {
    const now = Date.now();
    if (forceFresh || !cachedBuiltin || now - cachedBuiltinTime > BUILTIN_CACHE_TTL_MS) {
      cachedBuiltin = (await detectCoreTargets()).map(targetToAgent);
      cachedBuiltinTime = now;
    }
    const builtin = cachedBuiltin.map((agent) => ({
      ...agent,
      enabled: state.enabled[agent.id] ?? agent.enabled,
    }));
    return [...builtin, ...(await Promise.all(state.custom.map(hydrateCustom)))];
  };
  const customFrom = (input: CustomAgentRequest, id: string = randomUUID()): AgentMetadata => ({
    id,
    name: input.name.trim(),
    icon: input.icon,
    description: input.advanced?.description,
    backend: id,
    agent_type: 'acp',
    agent_source: 'custom',
    enabled: true,
    available: false,
    team_capable: true,
    command: input.command.trim(),
    args: input.args ?? [],
    env: input.env,
    native_skills_dirs: input.advanced?.native_skills_dirs,
    behavior_policy: input.advanced?.behavior_policy,
    yolo_id: input.advanced?.yolo_id,
  });
  return {
    async list() {
      await ensureLoaded();
      return buildList(false);
    },
    async refresh() {
      await ensureLoaded();
      clearExecutableResolutionCache();
      return buildList(true);
    },
    async create(input) {
      await ensureLoaded();
      const row = customFrom(input);
      if (!row.name || !row.command) throw new Error('Agent name and command are required.');
      state.custom.push(row);
      await persist();
      return hydrateCustom(row);
    },
    async update(id, input) {
      await ensureLoaded();
      const index = state.custom.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Custom agent not found: ' + id);
      const row = customFrom(input, id);
      row.enabled = state.custom[index].enabled;
      state.custom[index] = row;
      await persist();
      return hydrateCustom(row);
    },
    async remove(id) {
      await ensureLoaded();
      const before = state.custom.length;
      state.custom = state.custom.filter((item) => item.id !== id);
      delete state.enabled[id];
      if (state.custom.length !== before) await persist();
      return state.custom.length !== before;
    },
    async setEnabled(id, enabled) {
      await ensureLoaded();
      state.enabled[id] = enabled;
      await persist();
      const row = (await buildList(false)).find((item) => item.id === id);
      if (!row) throw new Error('Agent not found: ' + id);
      return row;
    },
    async importLegacy(rows) {
      await ensureLoaded();
      const existing = new Set(state.custom.map((item) => item.id));
      const imported = rows.filter((item) => item.agent_source === 'custom' && !existing.has(item.id));
      state.custom.push(...imported.map(clone));
      if (imported.length > 0) await persist();
      return imported.length;
    },

    async test(input) {
      const command = input.command.trim();
      if (!command) return { step: 'fail_cli', error: 'Command is required.' };
      return (await resolveExecutableOnPath([command]))
        ? { step: 'success' }
        : { step: 'fail_cli', error: 'Command was not found.' };
    },
  };
};
