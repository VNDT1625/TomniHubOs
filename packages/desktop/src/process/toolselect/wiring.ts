/**
 * Production wiring for the filter-before-load skill/tool selector.
 * Keeps the short catalog separate from full SKILL.md content.
 */
import path from 'node:path';
import { app } from 'electron';
import { createNativeSkillCatalog } from '@process/resources/nativePlatform/capabilityBridge';
import type { ToolSelectorServerDeps } from '@process/resources/builtinMcp/toolSelectorServer';
import { createCatalog } from './catalog';
import { listBuiltinMcpToolCatalog } from './builtinToolCatalog';
import { createSelectionLog } from './selectionLog';
import { createToolSelector } from './toolSelector';

let services: ToolSelectorServerDeps | undefined;

/** Build the singleton used by every Core surface's Skill Workflow capability. */
export const getToolSelectorServices = (): ToolSelectorServerDeps => {
  if (services) return services;
  const skills = createNativeSkillCatalog();
  const catalog = createCatalog({
    loadSkills: async () =>
      (await skills.list()).map((skill) => ({
        id: `skill:${skill.name}`,
        source: 'skill' as const,
        name: skill.name,
        description: skill.description,
        keywords: [skill.source, skill.relative_location ?? ''].filter(Boolean),
      })),
    // Keep searchable metadata for built-in surface tools. Full schemas still
    // come from the live ToolMap, so discovery stays small without claiming the
    // IDE or Agent Orchestrator is unavailable.
    loadMcpTools: async () => listBuiltinMcpToolCatalog(),
  });
  const selectionLog = createSelectionLog({
    filePath: path.join(app.getPath('userData'), 'tomny-core', 'selection-log.json'),
  });
  services = {
    toolSelector: createToolSelector({ catalog, selectionLog, topK: 5, maxRounds: 3 }),
    selectionLog,
    readSkill: (name, resource) => skills.read(name, resource),
    refreshCatalog: async () => {
      await catalog.refresh();
    },
  };
  return services;
};
