/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

// Mirror of tomny-api-types/src/assistant.rs.
// Any shape change on either side requires a same-PR update on the other.

export type AssistantSource = 'builtin' | 'user' | 'extension' | 'package';

export interface Assistant {
  id: string;
  source: AssistantSource;
  /** Main-owned provenance; never accepted on user create/update requests. */
  packageId?: string;
  packageConnectionKey?: string;
  name: string;
  name_i18n: Record<string, string>;
  description?: string;
  description_i18n: Record<string, string>;
  avatar?: string;
  enabled: boolean;
  sort_order: number;
  preset_agent_type: string;
  enabled_skills: string[];
  custom_skill_names: string[];
  disabled_builtin_skills: string[];
  /** MCP server ids and installed package ids this assistant brings (UI word: Plugin). */
  enabled_plugins: string[];
  /** Hook ids (64-hex) this assistant turns on for its conversations; never grants approval. */
  enabled_hooks: string[];
  /** Tool ids (`<serverId>::<toolName>`) whose schemas are attached from the first turn; capped; never grants approval. */
  default_tools: string[];
  context?: string;
  context_i18n: Record<string, string>;
  prompts: string[];
  prompts_i18n: Record<string, string[]>;
  models: string[];
  last_used_at?: number;
}

export interface CreateAssistantRequest {
  id?: string;
  name: string;
  description?: string;
  avatar?: string;
  context?: string;
  preset_agent_type?: string;
  enabled_skills?: string[];
  custom_skill_names?: string[];
  disabled_builtin_skills?: string[];
  enabled_plugins?: string[];
  enabled_hooks?: string[];
  default_tools?: string[];
  prompts?: string[];
  models?: string[];
  name_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  prompts_i18n?: Record<string, string[]>;
}

export type UpdateAssistantRequest = Partial<Omit<CreateAssistantRequest, 'id'>> & {
  id: string;
};

export interface SetAssistantStateRequest {
  id: string;
  enabled?: boolean;
  sort_order?: number;
  last_used_at?: number;
}

export interface ImportAssistantsRequest {
  assistants: CreateAssistantRequest[];
}

export interface ImportError {
  id: string;
  error: string;
}

export interface ImportAssistantsResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportError[];
}
