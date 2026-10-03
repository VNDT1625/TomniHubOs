/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PaletteTrigger = '/' | '@' | '#' | '*';

export interface PaletteItem {
  key: string;
  label: string;
  prefix: PaletteTrigger;
  description?: string;
  badge?: string;
  insertText?: string;
  category?: 'mode' | 'snippet' | 'builtin' | 'entity' | 'knowledge' | 'pipeline';
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
  // Modes
  {
    key: 'goal',
    label: '/goal',
    prefix: '/',
    description: 'Autonomous goal-seeking agent (extra thorough, self-verifying)',
    badge: 'Mode',
    insertText: '/goal ',
    category: 'mode',
  },
  {
    key: 'boost',
    label: '/boost',
    prefix: '/',
    description: 'Deep thinking & strategic planning with multi-perspective review',
    badge: 'Mode',
    insertText: '/boost ',
    category: 'mode',
  },
  {
    key: 'deep',
    label: '/deep',
    prefix: '/',
    description: 'Extended reasoning budget for complex architectural tasks',
    badge: 'Mode',
    insertText: '/deep ',
    category: 'mode',
  },
  {
    key: 'diff',
    label: '/diff',
    prefix: '/',
    description: 'Review code modifications and generate unified patch',
    badge: 'Tool',
    insertText: '/diff ',
    category: 'builtin',
  },
  {
    key: 'compact',
    label: '/compact',
    prefix: '/',
    description: 'Summarize context and reduce conversation tokens',
    badge: 'Tool',
    insertText: '/compact ',
    category: 'builtin',
  },
  {
    key: 'browser',
    label: '/browser',
    prefix: '/',
    description: 'Web research & browsing agent with visual snapshots',
    badge: 'Mode',
    insertText: '/browser ',
    category: 'mode',
  },
  {
    key: 'status',
    label: '/status',
    prefix: '/',
    description: 'Show runtime health, active tasks, and resource telemetry',
    badge: 'System',
    insertText: '/status ',
    category: 'builtin',
  },
  // Prompt Snippets
  {
    key: 'fix',
    label: '/fix',
    prefix: '/',
    description: 'Fix bug and explain root cause',
    badge: 'Snippet',
    insertText: 'Fix the bug in the following code and explain the root cause:\n',
    category: 'snippet',
  },
  {
    key: 'review',
    label: '/review',
    prefix: '/',
    description: 'Thorough code review (security, performance, edge cases)',
    badge: 'Snippet',
    insertText: 'Perform a thorough code review checking security, edge cases, and performance:\n',
    category: 'snippet',
  },
  {
    key: 'refactor',
    label: '/refactor',
    prefix: '/',
    description: 'Refactor for modularity & readability without breaking changes',
    badge: 'Snippet',
    insertText: 'Refactor this code for readability, modularity, and maintainability without breaking changes:\n',
    category: 'snippet',
  },
  {
    key: 'test',
    label: '/test',
    prefix: '/',
    description: 'Write comprehensive unit tests with edge cases',
    badge: 'Snippet',
    insertText: 'Write comprehensive unit tests with edge cases for this module:\n',
    category: 'snippet',
  },
  {
    key: 'explain',
    label: '/explain',
    prefix: '/',
    description: 'Explain codebase or architecture with diagrams',
    badge: 'Snippet',
    insertText: 'Explain this codebase/concept step-by-step with architecture diagrams:\n',
    category: 'snippet',
  },
];

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
      pool = [...BUILTIN_SLASH_ITEMS, ...(extraItems || [])];
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
