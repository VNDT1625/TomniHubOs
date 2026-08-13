/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in Tool-Selector MCP server (Yêu cầu 7, criteria 7.2 & 7.7 — Agent
 * plane). Exposes two tools so ANY agent (including the company's "tay chân"
 * worker agents, Yêu cầu 3) can discover the right capability for a request
 * without loading the whole catalog into its context:
 *
 * - `tools_search(query)` — return the filtered top-k relevant skills/tools with
 *   the reason each matched (criterion 7.2: lọc trước khi nạp).
 * - `tools_recall(query)` — look up the previously-successful selection for a
 *   similar request (criterion 7.7).
 *
 * Tool names use snake_case (not the design's dotted `tools.search`) to satisfy
 * function-calling name rules, matching the other built-in servers.
 *
 * Built as a factory returning a configured {@link McpServer}; Task 15.1 injects
 * the real {@link IToolSelector}/{@link ISelectionLog} and connects a transport.
 * Process boundary: Main-process (Node.js) module — no DOM APIs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IToolSelector } from '@process/toolselect/toolSelector';
import type { ISelectionLog } from '@process/toolselect/selectionLog';
import type { SkillResource } from '@process/resources/nativePlatform/skillCatalog';

/** Stable id of the built-in Tool-Selector MCP server (consumed by Task 15.1). */
export const BUILTIN_TOOL_SELECTOR_ID = 'builtin-tool-selector';

/** Canonical name of the built-in Tool-Selector MCP server (consumed by Task 15.1). */
export const BUILTIN_TOOL_SELECTOR_NAME = 'tomny-tool-selector';

/** Injected collaborators for {@link createToolSelectorServer}. */
export type ToolSelectorServerDeps = {
  /** The selector that filters the catalog (Tier 1 + optional Tier 2). */
  toolSelector: IToolSelector;
  /** The selection log used by `tools_recall`. */
  selectionLog: ISelectionLog;
  /** Secure reader for SKILL.md and skill-local referenced resources. */
  readSkill?: (name: string, resource?: string) => Promise<SkillResource>;
  /** Refreshes the short catalog before discovery so newly installed skills appear. */
  refreshCatalog?: () => Promise<void>;
};

/** Standard MCP text payload helper. */
const textResult = (
  text: string,
  isError = false
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Create the Tool-Selector {@link McpServer} bound to the injected selector + log.
 *
 * @param deps The tool selector and selection log. See {@link ToolSelectorServerDeps}.
 * @returns A configured MCP server; the caller (Task 15.1) connects a transport.
 */
export const createToolSelectorServer = (deps: ToolSelectorServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_TOOL_SELECTOR_NAME, version: '1.0.0' });
  const selected = new Map<string, SkillResource>();

  server.tool(
    'tools_search',
    `Find the skills/tools most relevant to a request, WITHOUT loading the whole catalog
(filter-before-load). Returns a small ranked shortlist with the reason each item matched.

Input:
- query: the request / task description to find tools for (required)

Returns a JSON array of { id, name, source, score, reason }.`,
    {
      query: z.string().describe('The request or task description to find relevant tools/skills for.'),
    },
    async ({ query }) => {
      try {
        await deps.refreshCatalog?.();
        const shortlist = await deps.toolSelector.shortlist(query);
        const payload = shortlist.map((s) => ({
          id: s.entry.id,
          name: s.entry.name,
          source: s.entry.source,
          score: Number(s.score.toFixed(4)),
          reason: s.reason,
        }));
        return textResult(JSON.stringify(payload, null, 2));
      } catch (error) {
        return textResult(`Error searching tools: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'tools_recall',
    `Recall the tools/skills that previously SUCCEEDED for a similar request, so a known-good
choice can be reused instead of re-discovered.

Input:
- query: the request / task description to recall a prior selection for (required)

Returns the prior selection (chosen tool ids + when), or a note that none was found.`,
    {
      query: z.string().describe('The request or task description to recall a prior successful selection for.'),
    },
    async ({ query }) => {
      try {
        const recalled = await deps.selectionLog.recall(query);
        if (!recalled) return textResult('No prior successful selection found for a similar request.');
        return textResult(
          JSON.stringify(
            {
              chosen: recalled.chosen,
              succeeded: recalled.succeeded,
              at: recalled.at,
              requestSnippet: recalled.requestSnippet,
            },
            null,
            2
          )
        );
      } catch (error) {
        return textResult(`Error recalling tools: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'skills_read',
    `Read a skill's instructions or a referenced resource without selecting it. Always read SKILL.md
before applying a skill. If SKILL.md points to another file, call this tool again with that relative resource path.

Input:
- name: exact skill name returned by tools_search
- resource: skill-local relative path (defaults to SKILL.md)`,
    {
      name: z.string().trim().min(1).max(200),
      resource: z.string().trim().min(1).max(500).optional(),
    },
    async ({ name, resource }) => {
      if (!deps.readSkill) return textResult('Skill reading is unavailable in this runtime.', true);
      try {
        return textResult(JSON.stringify(await deps.readSkill(name, resource), null, 2));
      } catch (error) {
        return textResult(`Error reading skill: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'skills_select',
    `Select the skills that govern the current action and load their complete SKILL.md instructions.
Use tools_search first, then select only relevant skills. The returned instructions form the preparation
phase of a dynamic workflow; follow their ordering, validation, and referenced-resource requirements.

Input:
- goal: concrete action goal used for selection recall
- names: exact skill names (maximum 5)
- mode: replace the selection, add skills, or remove skills`,
    {
      goal: z.string().trim().min(1).max(4_000),
      names: z.array(z.string().trim().min(1).max(200)).max(5),
      mode: z.enum(['replace', 'add', 'remove']).default('replace'),
    },
    async ({ goal, names, mode }) => {
      if (!deps.readSkill) return textResult('Skill selection is unavailable in this runtime.', true);
      try {
        if (mode === 'replace') selected.clear();
        if (mode === 'remove') {
          for (const name of names) selected.delete(name.toLowerCase());
        } else {
          const resources = await Promise.all(names.map((name) => deps.readSkill?.(name, 'SKILL.md')));
          for (const resource of resources) {
            if (resource) selected.set(resource.name.toLowerCase(), resource);
          }
        }
        const active = [...selected.values()];
        return textResult(
          JSON.stringify(
            {
              phase: 'prepared',
              selected: active.map(({ name, description }) => ({ name, description })),
              instructions: active.map(({ name, resource, content }) => ({ name, resource, content })),
              next: 'Resolve referenced skill resources, compose the workflow, then execute surface tools.',
            },
            null,
            2
          )
        );
      } catch (error) {
        return textResult(`Error selecting skills: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'skills_finish',
    `Close the skill-guided workflow after validation. Records whether the selected skills actually
succeeded for this goal, enabling safe recall and re-selection on future actions. Clears the current selection.`,
    {
      goal: z.string().trim().min(1).max(4_000),
      succeeded: z.boolean(),
      detail: z.string().trim().max(2_000).optional(),
    },
    async ({ goal, succeeded, detail }) => {
      const chosen = [...selected.values()].map((skill) => `skill:${skill.name}`);
      if (chosen.length === 0) return textResult('No selected skills are awaiting completion.', true);
      try {
        await deps.selectionLog.record(goal, chosen, succeeded);
        selected.clear();
        return textResult(JSON.stringify({ phase: 'finished', succeeded, chosen, detail }, null, 2));
      } catch (error) {
        return textResult(`Error finishing skill workflow: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'skills_status',
    'Return the skills currently selected for this action without repeating their full instructions.',
    {},
    async () =>
      textResult(
        JSON.stringify(
          [...selected.values()].map(({ name, description }) => ({ name, description })),
          null,
          2
        )
      )
  );

  return server;
};
