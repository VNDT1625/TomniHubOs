import { app } from 'electron';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { AgentMeshService } from '../service';

let sharedMeshService: AgentMeshService | undefined;

/** Shared durable mesh used by IPC, Team, Experimental Core and the MCP orchestrator. */
export const getSharedAgentMeshService = (): AgentMeshService => {
  const journalDirectory = path.join(app.getPath('userData'), 'tomny-core', 'agent-mesh');
  sharedMeshService ??= new AgentMeshService({
    eventStoreFactory: (sessionId) =>
      new JsonlDurableEventStore(path.join(journalDirectory, `${encodeURIComponent(sessionId)}.jsonl`)),
    listPersistedSessionIds: async () => {
      try {
        const entries = await readdir(journalDirectory, { withFileTypes: true });
        const journals = await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
            .map(async (entry) => ({
              name: entry.name,
              modifiedAt: (await stat(path.join(journalDirectory, entry.name))).mtimeMs,
            }))
        );
        return journals
          .toSorted((left, right) => left.modifiedAt - right.modifiedAt)
          .flatMap(({ name }): string[] => {
            try {
              const id = decodeURIComponent(name.slice(0, -'.jsonl'.length)).trim();
              return id ? [id] : [];
            } catch {
              return [];
            }
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
  });
  return sharedMeshService;
};

export const disposeSharedAgentMeshService = async (): Promise<void> => {
  if (!sharedMeshService) return;
  await sharedMeshService.disposeAll();
  sharedMeshService = undefined;
};
