/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository detectors: inventory (`inventory.ts`), contracts (`types.ts`) and merge (`merge.ts`). The detectors
 * themselves live in `agent/`, `browser/` and `apps/`; the registered ones are listed in `detectors` below.
 */

import { agentPlugins, commandsAgents, gemini, hooks, mcpConfig, mcpPublished, rules } from './agent';
import { cliLauncher, knowledgeMisc, services } from './apps';
import { browserExt } from './browser';
import { detectAll as detectWith } from './merge';
import type { DetectionReport, Detector, MergeOptions, RepoInventory } from './types';

export {
  createInventory,
  DECLARATION_FILES,
  isDeclarationFile,
  MAX_DECLARATION_CHARS,
  MAX_TOTAL_CHARS,
  MAX_USERSCRIPT_CHARS,
  normalizeRepoPath,
  type CreateInventoryInput,
} from './inventory';
export {
  defaultHash,
  detectAll as detectWith,
  isHighSignalDeclaration,
  mergeResults,
  pickArchetypeLabel,
  PLUGIN_HOST_ORDER,
} from './merge';
export type {
  DetectionReport,
  Detector,
  DetectorResult,
  MergedDetection,
  MergeOptions,
  RepoInventory,
  TextHash,
} from './types';

export {
  agentPlugins,
  browserExt,
  cliLauncher,
  commandsAgents,
  gemini,
  hooks,
  knowledgeMisc,
  mcpConfig,
  mcpPublished,
  rules,
  services,
};

/**
 * Every registered detector. The order does not change the result (design section 7.2). Detectors of the other
 * Wave 1 tasks (gemini, commands-agents, hooks, rules, cli-launcher, services, knowledge-misc) are
 * added here when they exist; `skills` and the web/theme/chat-stage logic stay in the classifier.
 */
export const detectors: readonly Detector[] = [
  agentPlugins,
  commandsAgents,
  gemini,
  hooks,
  mcpConfig,
  mcpPublished,
  rules,
  browserExt,
  cliLauncher,
  knowledgeMisc,
  services,
];

/** Runs `detectors` over the inventory and merges the results. */
export const detectAll = (inventory: RepoInventory, options: MergeOptions = {}): DetectionReport =>
  detectWith(inventory, detectors, options);
