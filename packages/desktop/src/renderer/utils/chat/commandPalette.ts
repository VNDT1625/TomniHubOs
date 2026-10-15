/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { SLASH_MODES, type SlashMode } from '@/common/chat/slash/modes';
import type { PackageCommandSummary, SlashCommandItem } from '@/common/chat/slash/types';

export type PaletteTrigger = '/' | '@' | '#' | '*';

export interface PaletteItem {
  key: string;
  label: string;
  prefix: PaletteTrigger;
  description?: string;
  badge?: string;
  insertText?: string;
  category?: 'mode' | 'snippet' | 'builtin' | 'entity' | 'knowledge' | 'pipeline' | 'package';
}

export interface ActivePaletteQuery {
  prefix: PaletteTrigger;
  start: number;
  end: number;
  query: string;
  rawQuery: string;
  token: string;
}

const PALETTE_TRIGGERS = new Set<string>(['/', '@', '#', '*']);

const BOUNDARY_RE = /[\s,;!?()[\]{}]/;

function isBoundaryChar(char: string): boolean {
  return BOUNDARY_RE.test(char);
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && value[cursor] === '\\') {
    backslashCount += 1;
    cursor -= 1;
  }
  return backslashCount % 2 === 1;
}

/**
 * Detects if the caret is currently inside a command palette token (starting with /, @, #, or *).
 * Supports tokens anywhere in the input (enabling multi-prefix combos like `*pipeline @doc #tag /goal`).
 */
export function getActivePaletteQuery(value: string, caretPosition: number): ActivePaletteQuery | null {
  if (!value) return null;

  const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
  let triggerIndex = -1;
  let triggerChar: PaletteTrigger | null = null;

  for (let index = safeCaret - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (PALETTE_TRIGGERS.has(char) && !isEscaped(value, index)) {
      const previousChar = index > 0 ? value[index - 1] : '';
      if (!previousChar || isBoundaryChar(previousChar)) {
        triggerIndex = index;
        triggerChar = char as PaletteTrigger;
        break;
      }
    }

    if (isBoundaryChar(char) && !isEscaped(value, index)) {
      return null;
    }
  }

  if (triggerIndex === -1 || !triggerChar) {
    return null;
  }

  let tokenEnd = value.length;
  for (let index = triggerIndex + 1; index < value.length; index += 1) {
    const char = value[index];
    if (isBoundaryChar(char) && !isEscaped(value, index)) {
      tokenEnd = index;
      break;
    }
  }

  if (safeCaret < triggerIndex || safeCaret > tokenEnd) {
    return null;
  }

  const rawQuery = value.slice(triggerIndex + 1, tokenEnd);
  return {
    prefix: triggerChar,
    start: triggerIndex,
    end: tokenEnd,
    query: rawQuery.replace(/\\(.)/g, '$1'),
    rawQuery,
    token: value.slice(triggerIndex, tokenEnd),
  };
}

/**
 * Built-in Slash Commands (/)
 */
const modeItem = (mode: SlashMode): PaletteItem => ({
  key: mode.name,
  label: `/${mode.name}`,
  prefix: '/',
  description: mode.summary,
  badge: 'Mode',
  insertText: `/${mode.name} `,
  category: 'mode',
});

/**
 * Slash commands that do something. Modes come from the shared list in `common/chat/slash/modes.ts`, so the
 * menu and the code that applies them cannot drift apart; the others are handled where the message is sent.
 */
export const BUILTIN_SLASH_ITEMS: PaletteItem[] = [
  {
    key: 'repotopackage',
    label: '/repotopackage',
    prefix: '/',
    description: 'Convert local directory or Git repo URL into a signed .tomny package',
    badge: 'Workflow',
    insertText: '/repotopackage ',
    category: 'builtin',
  },
  {
    key: 'guide',
    label: '/guide',
    prefix: '/',
    description: 'Highlight a control in the app and explain it (try /guide settings)',
    badge: 'Help',
    insertText: '/guide ',
    category: 'builtin',
  },
  {
    key: 'schedule',
    label: '/schedule',
    prefix: '/',
    description: 'Schedule a task: /schedule daily 9:00 summarise my inbox (opens the form to confirm)',
    badge: 'Automation',
    insertText: '/schedule ',
    category: 'builtin',
  },
  {
    key: 'remember',
    label: '/remember',
    prefix: '/',
    description: 'Save something to your long-term personal memory: /remember I prefer short answers',
    badge: 'Memory',
    insertText: '/remember ',
    category: 'builtin',
  },
  {
    key: 'forget',
    label: '/forget',
    prefix: '/',
    description: 'Remove matching items from your personal memory: /forget short answers',
    badge: 'Memory',
    insertText: '/forget ',
    category: 'builtin',
  },
  {
    key: 'goal',
    label: '/goal',
    prefix: '/',
    description: 'Autonomous goal-seeking agent (extra thorough, self-verifying)',
    badge: 'Mode',
    insertText: '/goal ',
    category: 'mode',
  },
  ...SLASH_MODES.map(modeItem),
];

/** The shared slash catalog as slash-menu items, so the chat page offers the same commands as the home page. */
export const paletteSlashCommands = (): SlashCommandItem[] =>
  BUILTIN_SLASH_ITEMS.map((item) => ({
    name: item.key,
    description: item.description ?? item.label,
    kind: 'template' as const,
    source: 'builtin' as const,
    selectionBehavior: 'insert' as const,
    insertText: item.insertText ?? `${item.label} `,
    ...(item.badge ? { hint: item.badge } : {}),
  }));

/** Argument hint after the description, so the menu shows how to call the command: `Fix an issue ([issue number])`. */
const packageCommandDescription = (command: PackageCommandSummary): string =>
  command.argumentHint ? `${command.description} (${command.argumentHint})` : command.description;

/** Prompt commands of enabled packages as `/` palette items (home input). The badge names the package. */
export const packageCommandPaletteItems = (commands: readonly PackageCommandSummary[]): PaletteItem[] =>
  commands.map((command) => ({
    key: command.name,
    label: `/${command.name}`,
    prefix: '/' as const,
    description: packageCommandDescription(command),
    badge: command.packageId,
    insertText: `/${command.name} `,
    category: 'package' as const,
  }));

/** The same commands as slash-menu items (chat input). They are inserted, never executed by the renderer. */
export const packageSlashCommands = (commands: readonly PackageCommandSummary[]): SlashCommandItem[] =>
  commands.map((command) => ({
    name: command.name,
    description: packageCommandDescription(command),
    kind: 'template' as const,
    source: 'package' as const,
    selectionBehavior: 'insert' as const,
    insertText: `/${command.name} `,
    hint: command.packageId,
    packageId: command.packageId,
    ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
  }));

/**
 * Built-in Knowledge & Memory Items (#)
 */
export const BUILTIN_KNOWLEDGE_ITEMS: PaletteItem[] = [
  {
    key: 'memory',
    label: '#memory',
    prefix: '#',
    description: 'Laya user profile & learned preferences',
    badge: 'Memory',
    insertText: '#memory ',
    category: 'knowledge',
  },
  {
    key: 'rule',
    label: '#rule',
    prefix: '#',
    description: 'Project AGENTS.md rules & architecture invariants',
    badge: 'Rule',
    insertText: '#rule ',
    category: 'knowledge',
  },
  {
    key: 'doc',
    label: '#doc',
    prefix: '#',
    description: 'Project documentation & target architecture specs',
    badge: 'Docs',
    insertText: '#doc ',
    category: 'knowledge',
  },
  {
    key: 'tag',
    label: '#tag',
    prefix: '#',
    description: 'Bookmark conversation with custom tag',
    badge: 'Tag',
    insertText: '#tag ',
    category: 'knowledge',
  },
];

/**
 * Built-in Chat Pipeline Packages (*)
 */
export const BUILTIN_PIPELINE_ITEMS: PaletteItem[] = [
  {
    key: 'visual-learning',
    label: '*visual-learning',
    prefix: '*',
    description: 'Interactive visual diagrams, KaTeX notes & quizzes',
    badge: 'Pipeline',
    insertText: '*visual-learning ',
    category: 'pipeline',
  },
  {
    key: 'slide-deck',
    label: '*slide-deck',
    prefix: '*',
    description: 'Presenter slides with Marp-compatible markdown',
    badge: 'Pipeline',
    insertText: '*slide-deck ',
    category: 'pipeline',
  },
  {
    key: 'api-mockup',
    label: '*api-mockup',
    prefix: '*',
    description: 'Instant mock API server & JSON schema generator',
    badge: 'Pipeline',
    insertText: '*api-mockup ',
    category: 'pipeline',
  },
  {
    key: 'code-audit',
    label: '*code-audit',
    prefix: '*',
    description: 'Security and dependency vulnerability audit',
    badge: 'Pipeline',
    insertText: '*code-audit ',
    category: 'pipeline',
  },
];

/**
 * Filters palette items for a given prefix and query string.
 */
export function filterPaletteItems(prefix: PaletteTrigger, query: string, extraItems?: PaletteItem[]): PaletteItem[] {
  let pool: PaletteItem[] = [];

  switch (prefix) {
    case '/':
      // A built-in keeps its word; Main already prefixes a package command that would collide, this is a backstop.
      pool = [
        ...BUILTIN_SLASH_ITEMS,
        ...(extraItems || []).filter((extra) => !BUILTIN_SLASH_ITEMS.some((builtin) => builtin.key === extra.key)),
      ];
      break;
    case '#':
      pool = [...BUILTIN_KNOWLEDGE_ITEMS, ...(extraItems || [])];
      break;
    case '*':
      pool = [...BUILTIN_PIPELINE_ITEMS, ...(extraItems || [])];
      break;
    case '@':
      pool = extraItems || [];
      break;
  }

  const keyword = query.trim().toLowerCase();
  if (!keyword) return pool;

  return pool.filter(
    (item) =>
      item.key.toLowerCase().includes(keyword) ||
      item.label.toLowerCase().includes(keyword) ||
      (item.description && item.description.toLowerCase().includes(keyword))
  );
}
