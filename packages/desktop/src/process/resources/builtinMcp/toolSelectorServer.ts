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
 * Every tool call is bounded (2026-10-15): a call that does not settle within the deadline returns an error result
 * the agent can read, so the run continues instead of showing a call as executing forever.
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
import { isBuiltinToolOutsidePatterns, renderToolNameGuide } from '@process/toolselect/builtinToolCatalog';
import { runWithDeadline, TOOL_CALL_DEADLINE_MS } from '@process/resources/skillDocument/toolCallDeadline';
import { setWatchdogBreadcrumb } from '@process/services/diagnostics/mainThreadWatchdog';
import type { CapabilityFallback } from './capabilityFallback';

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
  /** Fallback step 2-3 of auto select: the `plugin` tool's map and connect, bound to a conversation. */
  capabilityFallback?: CapabilityFallback;
  /** Hard bound for one tool call. Defaults to {@link TOOL_CALL_DEADLINE_MS}. */
  toolDeadlineMs?: number;
};

type ToolTextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Standard MCP text payload helper. */
const textResult = (text: string, isError = false): ToolTextResult => ({
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
export const createToolSelectorServer = (
  deps: ToolSelectorServerDeps,
  /** Tool-name patterns this conversation can load; omitted means unrestricted. */
  allowedPatterns?: readonly string[],
  /** Conversation the SSE connection belongs to. The plugin tool needs it. */
  conversationId?: string
): McpServer => {
  const server = new McpServer({ name: BUILTIN_TOOL_SELECTOR_NAME, version: '1.0.0' });
  const selected = new Map<string, SkillResource>();
  const deadlineMs = deps.toolDeadlineMs ?? TOOL_CALL_DEADLINE_MS;

  /** Runs one tool body under the hard deadline. A timeout or a thrown error becomes an error result, never a hang. */
  const bounded = (label: string, run: () => Promise<ToolTextResult>): Promise<ToolTextResult> =>
    runWithDeadline(label, () => (setWatchdogBreadcrumb(`tool:${label}`), run()), deadlineMs).catch((error: unknown) => textResult(describeError(error), true));

  server.tool(
    'tools_search',
    `Find the skills/tools most relevant to a request, WITHOUT loading the whole catalog
(filter-before-load). Returns a small ranked shortlist with the reason each item matched.
If nothing fits, follow the plugin tool protocol: action "map", then action "connect" or skills_read.

Input:
- query: the request / task description to find tools for (required)

Returns a JSON array of { id, name, source, score, reason }.`,
    {
      query: z.string().describe('The request or task description to find relevant tools/skills for.'),
    },
    async ({ query }) =>
      bounded('tools_search', async () => {
        try {
          await deps.refreshCatalog?.();
          const found = await deps.toolSelector.shortlist(query);
          const shortlist = allowedPatterns
            ? found.filter((item) => !isBuiltinToolOutsidePatterns(item.entry, allowedPatterns))
            : found;
          const payload = shortlist.map((s) => ({
            id: s.entry.id,
            name: s.entry.name,
            source: s.entry.source,
            score: Number(s.score.toFixed(4)),
            reason: s.reason,
          }));
          if (payload.length === 0) {
            // An empty list gives the model nothing to act on; the exact names let it pick or call tools_guide.
            return textResult(
              JSON.stringify(
                {
                  results: [],
                  note: 'No tool matched this query. Pick an exact name below and pass it to ToolSearch. If none fits, call the plugin tool with action "map", then action "connect" or skills_read.',
                  guide: renderToolNameGuide(undefined, allowedPatterns),
                },
                null,
                2
              )
            );
          }
          return textResult(JSON.stringify(payload, null, 2));
        } catch (error) {
          return textResult(`Error searching tools: ${describeError(error)}`, true);
        }
      })
  );

  server.tool(
    'tools_guide',
    `List the exact tool names available, grouped by purpose. Use it when you do not know a tool's name, or
when ToolSearch or tools_search found nothing; names are what ToolSearch needs.

Input:
- group: optional, one of ide, browser, office, agents, testing (omit for every group)`,
    {
      group: z.string().trim().max(60).optional().describe('ide, browser, office, agents or testing; omit for all.'),
    },
    async ({ group }) => textResult(renderToolNameGuide(group ? [group] : undefined, allowedPatterns))
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
    async ({ query }) =>
      bounded('tools_recall', async () => {
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
      })
  );

  server.tool(
    'skills_read',
    `Read a skill's instructions or a referenced resource without selecting it. Always read SKILL.md
before applying a skill. If SKILL.md points to another file, call this tool again with that relative resource path.

Input:
- name: exact skill name from tools_search or the plugin map. The id form skill:<name> is also accepted.
- resource: skill-local relative path (defaults to SKILL.md)`,
    {
      name: z.string().trim().min(1).max(200),
      resource: z.string().trim().min(1).max(500).optional(),
    },
    async ({ name, resource }) =>
      bounded('skills_read', async () => {
        if (!deps.readSkill) return textResult('Skill reading is unavailable in this runtime.', true);
        try {
          return textResult(JSON.stringify(await deps.readSkill(name, resource), null, 2));
        } catch (error) {
          return textResult(`Error reading skill: ${describeError(error)}`, true);
        }
      })
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
    async ({ goal, names, mode }) =>
      bounded('skills_select', async () => {
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
      })
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
    async ({ goal, succeeded, detail }) =>
      bounded('skills_finish', async () => {
        const chosen = [...selected.values()].map((skill) => `skill:${skill.name}`);
        if (chosen.length === 0) return textResult('No selected skills are awaiting completion.', true);
        try {
          await deps.selectionLog.record(goal, chosen, succeeded);
          selected.clear();
          return textResult(JSON.stringify({ phase: 'finished', succeeded, chosen, detail }, null, 2));
        } catch (error) {
          return textResult(`Error finishing skill workflow: ${describeError(error)}`, true);
        }
      })
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

  server.tool(
    'plugin',
    `Fallback for capabilities that the auto selection did not include. Protocol, in order:
(1) tools_search with a short query; (2) this tool with action "map" to list every skill, plugin and hook with its id
(a plugin's skills are listed under it); (3) this tool with action "connect" and an id from the map, for a plugin or hook.
For a skill, call skills_read with its name instead of connect. Connect activates the entry for the next turn.

Input:
- action: "map" lists every enabled or approvable skill, plugin and hook (compact and budgeted).
- id: required for "connect"; copy it from the map. A bare name also works when it is unambiguous.`,
    {
      action: z.enum(['map', 'connect']),
      id: z.string().trim().min(1).max(200).optional(),
    },
    async ({ action, id }) =>
      bounded('plugin', async () => {
        const fallback = deps.capabilityFallback;
        if (!fallback) return textResult('Plugin lookup is unavailable in this runtime.', true);
        if (action === 'connect' && !id) return textResult('connect needs an id from the map.', true);
        try {
          const result = await fallback.run(
            conversationId,
            action === 'connect' && id ? { action: 'connect', id } : { action: 'map' }
          );
          return textResult(result.text, result.isError);
        } catch (error) {
          return textResult(`Error in plugin lookup: ${describeError(error)}`, true);
        }
      })
  );
  return server;
};
