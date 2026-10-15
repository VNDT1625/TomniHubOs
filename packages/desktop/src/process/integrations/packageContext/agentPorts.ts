/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hands the package context of the connection runtime to the agent runtime (docs/platform/repotopackage-design.md
 * sections 10.6 and 10.7, task T6.3): the rules block of the context composer and the `tomny_library_search` tool.
 *
 * Both are read-only views composed in Main. The core modules know no package code; they only call the registered
 * functions. Call it once after the connection runtime exists and call the returned function on shutdown.
 */

import { registerCoreRulesContextProvider } from '@process/agentRuntime/contextComposer';
import { registerCoreWorkspaceLibrarySearchPort } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import type { KnowledgeIndexPort } from './knowledgeIndex';
import { createCoreLibrarySearchPort, type KnowledgeSearchPortOptions } from './knowledgeSearchPort';
import type { RulesService } from './rulesService';

export const registerPackageContextPorts = (
  runtime: Readonly<{ rules: RulesService; knowledge: KnowledgeIndexPort }>,
  options: KnowledgeSearchPortOptions = {}
): (() => void) => {
  registerCoreRulesContextProvider(async ({ workspace }) => (await runtime.rules.contextFor(workspace))?.text);
  registerCoreWorkspaceLibrarySearchPort(createCoreLibrarySearchPort(runtime.knowledge, options));
  return () => {
    registerCoreRulesContextProvider(undefined);
    registerCoreWorkspaceLibrarySearchPort(undefined);
  };
};
