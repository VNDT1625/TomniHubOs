import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Assistant,
  CreateAssistantRequest,
  ImportAssistantsResult,
  SetAssistantStateRequest,
  UpdateAssistantRequest,
} from '@/common/types/agent/assistantTypes';

export type AssistantCatalogStore = {
  list(): Promise<Assistant[]>;
  create(input: CreateAssistantRequest): Promise<Assistant>;
  update(input: UpdateAssistantRequest): Promise<Assistant>;
  remove(id: string): Promise<void>;
  setState(input: SetAssistantStateRequest): Promise<Assistant>;
  importMany(inputs: CreateAssistantRequest[]): Promise<ImportAssistantsResult>;
  importExisting(inputs: Assistant[]): Promise<ImportAssistantsResult>;
};
const clone = <T>(value: T): T => structuredClone(value);
const normalize = (input: CreateAssistantRequest, id = input.id?.trim() || randomUUID()): Assistant => ({
  id,
  source: 'user',
  name: input.name.trim(),
  name_i18n: input.name_i18n ?? {},
  description: input.description,
  description_i18n: input.description_i18n ?? {},
  avatar: input.avatar,
  enabled: true,
  sort_order: 0,
  preset_agent_type: input.preset_agent_type ?? 'aionrs',
  enabled_skills: input.enabled_skills ?? [],
  custom_skill_names: input.custom_skill_names ?? [],
  disabled_builtin_skills: input.disabled_builtin_skills ?? [],
  context_i18n: {},
  prompts: input.prompts ?? [],
  prompts_i18n: input.prompts_i18n ?? {},
  models: input.models ?? [],
});
export const createAssistantCatalogStore = (filePath: string): AssistantCatalogStore => {
  let loaded = false;
  let rows: Assistant[] = [];
  let writes = Promise.resolve();
  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    try {
      const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      rows = Array.isArray(value)
        ? value.filter((row): row is Assistant => Boolean(row && typeof row === 'object' && typeof row.id === 'string'))
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    loaded = true;
  };
  const persist = async (): Promise<void> => {
    const snapshot = clone(rows);
    writes = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
      await rename(temporary, filePath);
    });
    await writes;
  };
  const find = (id: string): Assistant => {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error('Assistant not found: ' + id);
    return row;
  };
  return {
    async list() {
      await ensureLoaded();
      return clone(rows).toSorted((a, b) => a.sort_order - b.sort_order);
    },
    async create(input) {
      await ensureLoaded();
      const row = normalize(input);
      if (!row.name) throw new Error('Assistant name is required.');
      if (rows.some((item) => item.id === row.id)) throw new Error('Assistant already exists: ' + row.id);
      rows.push(row);
      await persist();
      return clone(row);
    },
    async update(input) {
      await ensureLoaded();
      const current = find(input.id);
      const next = { ...current, ...input, id: current.id };
      if (!next.name.trim()) throw new Error('Assistant name is required.');
      Object.assign(current, next);
      await persist();
      return clone(current);
    },
    async remove(id) {
      await ensureLoaded();
      rows = rows.filter((item) => item.id !== id);
      await persist();
    },
    async setState(input) {
      await ensureLoaded();
      const current = find(input.id);
      if (input.enabled !== undefined) current.enabled = input.enabled;
      if (input.sort_order !== undefined) current.sort_order = input.sort_order;
      if (input.last_used_at !== undefined) current.last_used_at = input.last_used_at;
      await persist();
      return clone(current);
    },
    async importMany(inputs) {
      await ensureLoaded();
      const result: ImportAssistantsResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
      for (const input of inputs) {
        const id = input.id?.trim();
        if (id && rows.some((item) => item.id === id)) {
          result.skipped += 1;
          continue;
        }
        try {
          const row = normalize(input);
          if (!row.name) throw new Error('Assistant name is required.');
          rows.push(row);
          result.imported += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ id: id ?? '', error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (result.imported > 0) await persist();
      return result;
    },
    async importExisting(inputs) {
      await ensureLoaded();
      const result: ImportAssistantsResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
      for (const input of inputs) {
        const id = input.id.trim();
        if (rows.some((item) => item.id === id)) {
          result.skipped += 1;
          continue;
        }
        try {
          if (!id) throw new Error('Assistant id is required.');
          if (!input.name.trim()) throw new Error('Assistant name is required.');
          rows.push(clone({ ...input, id }));
          result.imported += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (result.imported > 0) await persist();
      return result;
    },
  };
};
