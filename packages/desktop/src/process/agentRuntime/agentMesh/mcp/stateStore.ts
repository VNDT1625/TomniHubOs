import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentJobSessionSnapshot, AgentJobStateStore } from '../orchestrator';

type PersistedState = {
  schema: 'tomny.agent-orchestrator.store.v1';
  sessions: AgentJobSessionSnapshot[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSnapshot = (value: unknown): value is AgentJobSessionSnapshot => {
  if (!isRecord(value)) return false;
  return (
    value.schema === 'tomny.agent-orchestrator.session.v1' &&
    typeof value.sessionId === 'string' &&
    Number.isSafeInteger(value.maxConcurrent) &&
    Number.isSafeInteger(value.cursor) &&
    typeof value.lastActivityAt === 'number' &&
    Array.isArray(value.events) &&
    Array.isArray(value.jobs) &&
    Array.isArray(value.statuses) &&
    Array.isArray(value.outcomes) &&
    Array.isArray(value.idempotency)
  );
};

/** Atomic JSON store for durable MCP job results and resumable agent metadata. */
export class JsonAgentJobStateStore implements AgentJobStateStore {
  private cache?: Map<string, AgentJobSessionSnapshot>;
  private loading?: Promise<Map<string, AgentJobSessionSnapshot>>;
  private mutation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async loadAll(): Promise<AgentJobSessionSnapshot[]> {
    const sessions = await this.load();
    return structuredClone([...sessions.values()]);
  }

  save(snapshot: AgentJobSessionSnapshot): Promise<void> {
    return this.mutate(async (sessions) => {
      sessions.set(snapshot.sessionId, structuredClone(snapshot));
      await this.persist(sessions);
    });
  }

  remove(sessionId: string): Promise<void> {
    return this.mutate(async (sessions) => {
      if (!sessions.delete(sessionId)) return;
      await this.persist(sessions);
    });
  }

  private async load(): Promise<Map<string, AgentJobSessionSnapshot>> {
    if (this.cache) return this.cache;
    this.loading ??= this.readFile();
    this.cache = await this.loading;
    return this.cache;
  }

  private async readFile(): Promise<Map<string, AgentJobSessionSnapshot>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !isRecord(parsed) ||
        parsed.schema !== 'tomny.agent-orchestrator.store.v1' ||
        !Array.isArray(parsed.sessions)
      ) {
        throw new Error('Agent orchestrator state file has an unsupported schema.');
      }
      return new Map(parsed.sessions.filter(isSnapshot).map((snapshot) => [snapshot.sessionId, snapshot]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
  }

  private mutate(operation: (sessions: Map<string, AgentJobSessionSnapshot>) => Promise<void>): Promise<void> {
    const next = this.mutation.catch((): void => undefined).then(async () => operation(await this.load()));
    this.mutation = next;
    return next;
  }

  private async persist(sessions: Map<string, AgentJobSessionSnapshot>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: PersistedState = {
      schema: 'tomny.agent-orchestrator.store.v1',
      sessions: [...sessions.values()],
    };
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
