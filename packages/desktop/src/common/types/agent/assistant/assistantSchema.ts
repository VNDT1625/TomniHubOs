/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime validation for assistant IPC payloads. Every request is untrusted: objects are strict (unknown fields
 * are refused whole), strings and lists are bounded, and main-owned provenance fields are never accepted.
 */

import { z } from 'zod';
import type { CreateAssistantRequest, UpdateAssistantRequest } from '../assistantTypes';
import { ASSISTANT_DEFAULT_TOOL_LIMITS, isDefaultToolId } from './assistantDefaultTools';

/** Hard size caps shared by IPC, storage migration and the import/export bundle. */
export const ASSISTANT_LIMITS = {
  idMax: 200,
  nameMax: 80,
  descriptionMax: 500,
  avatarMax: 300,
  contextMaxBytes: 64 * 1024,
  promptMax: 20,
  promptLength: 500,
  listMax: 50,
  listItemMax: 200,
  modelMax: 20,
  localeKeyMax: 16,
  presetTypeMax: 64,
} as const;

/** Hook ids are SHA-256 hex digests produced by the hook registry. */
const HOOK_ID = /^[a-f0-9]{64}$/u;
/** Assistant ids are stable slugs or UUIDs; anything else is refused before it reaches a file or a key. */
const ASSISTANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const idList = z.array(z.string().trim().min(1).max(ASSISTANT_LIMITS.listItemMax)).max(ASSISTANT_LIMITS.listMax);
const hookIdList = z.array(z.string().regex(HOOK_ID)).max(ASSISTANT_LIMITS.listMax);
/** Default tools: `<serverId>::<toolName>` ids, at most the tool count cap. The byte cap is enforced when planning. */
const defaultToolList = z
  .array(z.string().max(ASSISTANT_LIMITS.listItemMax).refine(isDefaultToolId, { message: 'invalid_default_tool' }))
  .max(ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools);
const promptList = z.array(z.string().max(ASSISTANT_LIMITS.promptLength)).max(ASSISTANT_LIMITS.promptMax);
const localized = z.record(
  z.string().min(1).max(ASSISTANT_LIMITS.localeKeyMax),
  z.string().max(ASSISTANT_LIMITS.nameMax)
);
const localizedDescription = z.record(
  z.string().min(1).max(ASSISTANT_LIMITS.localeKeyMax),
  z.string().max(ASSISTANT_LIMITS.descriptionMax)
);
const localizedPrompts = z.record(z.string().min(1).max(ASSISTANT_LIMITS.localeKeyMax), promptList);

/** Context (agent.md) is measured in bytes, not characters, so a multi-byte paste cannot exceed the cap. */
const contextText = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= ASSISTANT_LIMITS.contextMaxBytes, {
    message: 'context_too_large',
  });

/** Shape of a create request. Provenance (`source`, `packageId`, ...) is intentionally absent. */
export const createAssistantSchema = z
  .object({
    id: z.string().trim().min(1).max(ASSISTANT_LIMITS.idMax).regex(ASSISTANT_ID).optional(),
    name: z.string().trim().min(1).max(ASSISTANT_LIMITS.nameMax),
    description: z.string().max(ASSISTANT_LIMITS.descriptionMax).optional(),
    avatar: z.string().max(ASSISTANT_LIMITS.avatarMax).optional(),
    context: contextText.optional(),
    preset_agent_type: z.string().trim().min(1).max(ASSISTANT_LIMITS.presetTypeMax).optional(),
    enabled_skills: idList.optional(),
    custom_skill_names: idList.optional(),
    disabled_builtin_skills: idList.optional(),
    enabled_plugins: idList.optional(),
    enabled_hooks: hookIdList.optional(),
    default_tools: defaultToolList.optional(),
    prompts: promptList.optional(),
    models: z.array(z.string().max(ASSISTANT_LIMITS.listItemMax)).max(ASSISTANT_LIMITS.modelMax).optional(),
    name_i18n: localized.optional(),
    description_i18n: localizedDescription.optional(),
    prompts_i18n: localizedPrompts.optional(),
  })
  .strict();

/** Shape of an update request: every field optional, id required, same strictness as create. */
export const updateAssistantSchema = createAssistantSchema
  .omit({ id: true })
  .partial()
  .extend({ id: z.string().trim().min(1).max(ASSISTANT_LIMITS.idMax) })
  .strict();

/**
 * Manifest stored as assistant.json inside a shared assistant bundle. Only portable fields: no id, no
 * provenance, no i18n maps. The instruction text lives in agent.md, not here.
 */
export const assistantBundleManifestSchema = createAssistantSchema
  .pick({
    name: true,
    description: true,
    avatar: true,
    preset_agent_type: true,
    enabled_skills: true,
    custom_skill_names: true,
    disabled_builtin_skills: true,
    enabled_plugins: true,
    enabled_hooks: true,
    default_tools: true,
  })
  .extend({ schema_version: z.literal(1) })
  .strict();

export type AssistantBundleManifest = z.infer<typeof assistantBundleManifestSchema>;

/** Validates a create payload. Throws a ZodError on unknown fields or oversized values. */
export const parseCreateAssistantRequest = (input: unknown): CreateAssistantRequest =>
  createAssistantSchema.parse(input) as CreateAssistantRequest;

/** Validates an update payload. Throws a ZodError on unknown fields or oversized values. */
export const parseUpdateAssistantRequest = (input: unknown): UpdateAssistantRequest =>
  updateAssistantSchema.parse(input) as UpdateAssistantRequest;

/** Returns the same list with exact duplicates removed, preserving first-seen order. */
export const uniqueList = (values: readonly string[] | undefined): string[] => [...new Set(values ?? [])];
