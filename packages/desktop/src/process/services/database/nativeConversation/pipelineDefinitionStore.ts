/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ChatPipelineDefinition, ChatPipelineStageRef, StagePhase } from '@/common/types/pipeline';

const PHASES: readonly StagePhase[] = ['pre_query', 'retrieve', 'pre_model', 'post_model'];
const MAX_STAGES = 32;
const MAX_TEXT = 200;
const MAX_CONFIG_BYTES = 16_384;
const DEFAULT_MAX_CONVERSATIONS = 200;

type StoredDocument = {
  version: 1;
  default?: ChatPipelineDefinition;
  /** Oldest first, so the cap drops the least recently saved chain. */
  conversations: Array<[string, ChatPipelineDefinition]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT ? value : undefined;

const positive = (value: unknown, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : undefined;

const sanitizeConfig = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  try {
    const json = JSON.stringify(value);
    return json.length <= MAX_CONFIG_BYTES ? (JSON.parse(json) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeStage = (value: unknown): ChatPipelineStageRef | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  const stageRegistryId = text(value.stageRegistryId);
  const phase = PHASES.find((entry) => entry === value.phase);
  if (!id || !stageRegistryId || !phase || typeof value.enabled !== 'boolean') return undefined;
  const config = sanitizeConfig(value.config);
  return { id, stageRegistryId, phase, enabled: value.enabled, ...(config ? { config } : {}) };
};

/**
 * Accepts a chain only in the exact shape the executor reads. Anything else is
 * rejected whole, so a malformed save never half-applies.
 */
export const sanitizePipelineDefinition = (value: unknown): ChatPipelineDefinition | undefined => {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== 'boolean') return undefined;
  const id = text(value.id);
  const name = text(value.name);
  if (!id || !name || !Array.isArray(value.stages) || value.stages.length > MAX_STAGES) return undefined;
  const stages = value.stages.map(sanitizeStage);
  if (stages.some((stage) => !stage)) return undefined;
  const limits = isRecord(value.limits)
    ? {
        maxStages: positive(value.limits.maxStages, MAX_STAGES),
        maxTotalTimeoutMs: positive(value.limits.maxTotalTimeoutMs, 120_000),
        maxContextBytes: positive(value.limits.maxContextBytes, 4_000_000),
      }
    : undefined;
  return {
    schemaVersion: 1,
    id,
    name,
    stages: stages as ChatPipelineStageRef[],
    enabled: value.enabled,
    ...(limits ? { limits } : {}),
  };
};

/**
 * Stages a saved chain must carry. Without one of them the chain silently skips what it does (UserPromptSubmit hooks for
 * `builtin:user-hooks`), so a chain that lacks one gets it back when it is loaded or saved.
 */
export const REQUIRED_STAGE_REGISTRY_IDS: readonly string[] = ['builtin:user-hooks'];

/**
 * Returns `definition` with each required stage that the default chain has and that it lacks. The stage goes right after
 * the nearest stage that precedes it in the default chain, or first when none of them is in the chain. A stage the chain
 * already has keeps its own `enabled` value. Returns the same object when nothing is missing.
 */
export const withRequiredStages = (
  definition: ChatPipelineDefinition,
  defaults: ChatPipelineDefinition
): ChatPipelineDefinition => {
  let stages = definition.stages;
  let changed = false;
  defaults.stages.forEach((ref, index) => {
    if (!REQUIRED_STAGE_REGISTRY_IDS.includes(ref.stageRegistryId)) return;
    if (stages.some((stage) => stage.stageRegistryId === ref.stageRegistryId)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const preceding = defaults.stages[before]?.stageRegistryId;
      const found = stages.findIndex((stage) => stage.stageRegistryId === preceding);
      if (found !== -1) {
        at = found + 1;
        break;
      }
    }
    stages = [...stages.slice(0, at), { ...ref }, ...stages.slice(at)];
    changed = true;
  });
  return changed ? { ...definition, stages } : definition;
};

const readDocument = (filePath: string): StoredDocument => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(raw)) return { version: 1, conversations: [] };
    const conversations = Array.isArray(raw.conversations)
      ? raw.conversations.flatMap((entry): Array<[string, ChatPipelineDefinition]> => {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string') return [];
          const definition = sanitizePipelineDefinition(entry[1]);
          return definition ? [[entry[0], definition]] : [];
        })
      : [];
    const saved = sanitizePipelineDefinition(raw.default);
    return { version: 1, conversations, ...(saved ? { default: saved } : {}) };
  } catch {
    return { version: 1, conversations: [] };
  }
};

export type PipelineDefinitionStore = {
  /** The chain a conversation runs: its own, else the saved default, else undefined (use the built-in default). */
  resolve(conversationId?: string): ChatPipelineDefinition | undefined;
  /** Saves a conversation's chain, or the default for every conversation without one. */
  save(conversationId: string | undefined, definition: ChatPipelineDefinition): void;
  /** Drops the saved default so the built-in default applies again. */
  resetDefault(): void;
  forget(conversationId: string): void;
};

/** Chat pipelines saved per conversation and as the app default; they survive a restart. */
export const createPipelineDefinitionStore = (
  filePath: string,
  options: {
    maxConversations?: number;
    /** The built-in default chain; the source of the place each required stage has in a saved chain. */
    defaultDefinition: () => ChatPipelineDefinition;
  }
): PipelineDefinitionStore => {
  const maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
  // Every chain this store holds carries the required stages (see withRequiredStages).
  const complete = (definition: ChatPipelineDefinition): ChatPipelineDefinition =>
    withRequiredStages(definition, options.defaultDefinition());
  const document = readDocument(filePath);
  const loaded = document.conversations.map(([id, definition]): [string, ChatPipelineDefinition] => [
    id,
    complete(definition),
  ]);
  const conversations = new Map(loaded);
  let savedDefault = document.default === undefined ? undefined : complete(document.default);
  const migrated =
    loaded.some(([, definition], index) => definition !== document.conversations[index]?.[1]) ||
    (document.default !== undefined && savedDefault !== document.default);

  const persist = (): void => {
    const next: StoredDocument = {
      version: 1,
      conversations: [...conversations.entries()],
      ...(savedDefault ? { default: savedDefault } : {}),
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, filePath);
    } catch (error) {
      console.warn('[ChatPipeline] Could not save pipeline definitions:', error);
    }
  };

  if (migrated) {
    // Keep the exact pre-migration artifact for manual rollback. If we cannot preserve
    // it, do not mutate the on-disk definition store.
    try {
      if (fs.existsSync(filePath)) {
        const backup = `${filePath}.pre-migration.bak`;
        if (!fs.existsSync(backup)) {
          fs.copyFileSync(filePath, backup, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(backup, 0o600);
        }
      }
      persist();
    } catch (error) {
      console.warn('[ChatPipeline] Migration backup failed; original definition store left intact:', error);
    }
  }

  return {
    resolve: (conversationId) => (conversationId ? conversations.get(conversationId) : undefined) ?? savedDefault,
    save: (conversationId, submitted) => {
      const definition = complete(submitted);
      if (conversationId) {
        conversations.delete(conversationId);
        conversations.set(conversationId, definition);
        while (conversations.size > maxConversations) conversations.delete(conversations.keys().next().value as string);
      } else {
        savedDefault = definition;
      }
      persist();
    },
    resetDefault: () => {
      if (!savedDefault) return;
      savedDefault = undefined;
      persist();
    },
    forget: (conversationId) => {
      if (conversations.delete(conversationId)) persist();
    },
  };
};
