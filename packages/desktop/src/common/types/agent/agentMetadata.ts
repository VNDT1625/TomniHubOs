import type { ProviderHealthCheckRequest, ProviderHealthCheckResponse } from '../provider/providerApi';

export type AgentType = 'acp' | 'remote' | 'tomnyagentic' | 'openclaw-gateway' | 'nanobot';
export type AgentSource = 'internal' | 'builtin' | 'extension' | 'custom';
export type AgentEnvEntry = { name: string; value: string; description?: string };
export type AgentMetadata = {
  id: string;
  icon?: string;
  name: string;
  name_i18n?: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;
  backend?: string;
  agent_type: AgentType;
  agent_source: AgentSource;
  agent_source_info?: { binary_name?: string; bridge_binary?: string; hub_package_id?: string; version?: string };
  enabled: boolean;
  available: boolean;
  team_capable?: boolean;
  command?: string;
  args?: string[];
  env?: AgentEnvEntry[];
  native_skills_dirs?: string[];
  behavior_policy?: { supports_side_question?: boolean };
  yolo_id?: string;
  handshake?: {
    agent_capabilities?: unknown;
    auth_methods?: unknown;
    config_options?: unknown;
    available_modes?: unknown;
    available_models?: unknown;
    available_commands?: unknown;
  };
};

export type CustomAgentRequest = {
  name: string;
  command: string;
  icon?: string;
  args?: string[];
  env?: AgentEnvEntry[];
  advanced?: {
    yolo_id?: string;
    native_skills_dirs?: string[];
    behavior_policy?: { supports_side_question?: boolean };
    description?: string;
  };
};

export type AgentHealthResult = { available: boolean; latency?: number; error?: string };
export type { ProviderHealthCheckRequest, ProviderHealthCheckResponse };
