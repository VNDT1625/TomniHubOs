/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildLayaSecurityQuestions, type LayaQuestion } from '../security/layaSemanticEgressModel';
import type { DecisionTaskId } from '@/common/types/pipeline';

/**
 * A decision task is a named form of typed questions about one piece of text. Laya answers every
 * question of every requested task in a single forward pass, so stages that need different answers
 * about the same input share one model call instead of paying for one each.
 */
export type DecisionTaskDefinition = Readonly<{
  id: DecisionTaskId;
  label: string;
  questions: Readonly<Record<string, LayaQuestion>>;
}>;

/** One selectable tool group. Ids are Surface capability ids so selection never invents a new vocabulary. */
export type ToolGroupDefinition = Readonly<{
  key: string;
  capabilityId: string;
  instructions: string;
}>;

export const TOOL_GROUPS: readonly ToolGroupDefinition[] = Object.freeze([
  {
    key: 'needsProjectTools',
    capabilityId: 'surface.ide',
    instructions:
      'Does the body ask to edit, run, debug or test project source code, or use the terminal, git or a database (tools ide_*, terminal_*, git_*, db_*)?',
  },
  {
    key: 'needsWorkspaceTools',
    capabilityId: 'core.workspace-read',
    instructions:
      'Does the body ask to read, list or search files or folders of a project (tools tomny_read, tomny_glob, tomny_search)?',
  },
  {
    key: 'needsBrowserTools',
    capabilityId: 'surface.browser',
    instructions:
      'Does the body ask to open, browse, search or interact with web pages or online content (tools browser_*, quick_test_*)?',
  },
  {
    key: 'needsOfficeTools',
    capabilityId: 'surface.office',
    instructions: 'Does the body ask to read or edit a Word, Excel or PowerPoint document (tools office_*)?',
  },
  {
    key: 'needsAgentTools',
    capabilityId: 'core.agent-orchestrator',
    instructions: 'Does the body ask to delegate work to sub-agents, a team or a company of agents (tools agent_*)?',
  },
  {
    key: 'needsTestTools',
    capabilityId: 'core.testing',
    instructions:
      'Does the body ask to run, write or replay tests, or verify a fix by running the app (tools ide_test_script, ide_quick_test_*, quick_test_*)?',
  },
]);

/** Intent kinds the understand task can report. */
export const INTENT_KINDS = ['chat', 'code', 'web', 'documents', 'orchestration', 'other'] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

const buildToolSchemaQuestions = (): Record<string, LayaQuestion> =>
  Object.fromEntries(TOOL_GROUPS.map((group) => [group.key, { type: 'noul', instructions: group.instructions }]));

export const DECISION_TASKS: Readonly<Record<DecisionTaskId, DecisionTaskDefinition>> = Object.freeze({
  security: {
    id: 'security',
    label: 'Security risk',
    questions: buildLayaSecurityQuestions(),
  },
  understand: {
    id: 'understand',
    label: 'Intent',
    questions: {
      intent: {
        type: 'choice',
        instructions: 'What is the user mainly asking for in the body?',
        criteria: {
          chat: 'Casual conversation, a greeting, an explanation, translation or prose writing',
          code: 'Writing, reading, fixing or running source code, commands, repositories or tests',
          web: 'Browsing web pages, searching online, checking websites or current online information',
          documents: 'Working with Word, Excel, PowerPoint, PDF or other document files',
          orchestration: 'Delegating work to sub-agents, teams, workflows or schedules',
          other: 'None of the above',
        },
      },
      needsFreshDocs: {
        type: 'noul',
        instructions: 'Does the body depend on up-to-date library, SDK or API documentation?',
      },
    },
  },
  toolSchema: {
    id: 'toolSchema',
    label: 'Tool groups',
    questions: buildToolSchemaQuestions(),
  },
});

/**
 * A request shaped like the real shared pass (every task's questions at once). The sidecar answers it once
 * before it reports ready, so the first message a person sends does not pay for the model's warm-up.
 */
export const LAYA_WARMUP = Object.freeze({
  state: Object.freeze({ body: 'warm up' }),
  questions: Object.freeze(
    Object.assign({}, ...Object.values(DECISION_TASKS).map((task) => task.questions)) as Record<string, LayaQuestion>
  ),
});

export const ALL_DECISION_TASK_IDS: readonly DecisionTaskId[] = Object.freeze(['security', 'understand', 'toolSchema']);
