/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConnectorTarget } from './types';

/**
 * Registry of CLI / IDE tools AionUi can auto-configure to route through
 * 9Router. Ordering is display order (most-requested first).
 *
 * Each entry only declares *how* the tool is wired, never secrets. The plan
 * engine (`buildConnectorPlan`) turns an entry + endpoint into a concrete,
 * apply-able plan. Adding a new tool is a one-line registry change.
 */
export const CONNECTOR_TARGETS: ConnectorTarget[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    protocol: 'anthropic',
    mechanism: 'configFile',
    descriptionKey: 'settings.router9.target.claudeCode',
    agentPreferenceKey: 'claude',
    // Claude Code appends `/v1/messages` itself. Its documented LLM-gateway
    // setting therefore expects the bare gateway origin.
    baseUrlStyle: 'origin',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    protocol: 'openai',
    // Codex durable provider configuration belongs in ~/.codex/config.toml.
    // Environment variables alone only configure the current shell.
    mechanism: 'configFile',
    descriptionKey: 'settings.router9.target.codex',
    agentPreferenceKey: 'codex',
    baseUrlStyle: 'withV1',
  },
  {
    id: 'kiro',
    label: 'Kiro',
    protocol: 'openai',
    mechanism: 'manual',
    descriptionKey: 'settings.router9.target.kiro',
    agentPreferenceKey: 'kiro',
    baseUrlStyle: 'withV1',
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    protocol: 'openai',
    mechanism: 'manual',
    descriptionKey: 'settings.router9.target.antigravity',
    agentPreferenceKey: 'antigravity',
    baseUrlStyle: 'withV1',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    protocol: 'openai',
    mechanism: 'manual',
    descriptionKey: 'settings.router9.target.cursor',
    agentPreferenceKey: 'cursor',
    baseUrlStyle: 'withV1',
  },
  {
    id: 'cline',
    label: 'Cline',
    protocol: 'openai',
    mechanism: 'manual',
    descriptionKey: 'settings.router9.target.cline',
    baseUrlStyle: 'withV1',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    protocol: 'openai',
    mechanism: 'configFile',
    descriptionKey: 'settings.router9.target.openclaw',
    agentPreferenceKey: 'openclaw-gateway',
    baseUrlStyle: 'withV1',
  },
];

/** Look up a target definition by id. */
export const getConnectorTarget = (id: string): ConnectorTarget | undefined => {
  return CONNECTOR_TARGETS.find((t) => t.id === id);
};
