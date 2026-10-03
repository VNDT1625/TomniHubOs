/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedHeading {
  level: 2 | 3;
  title: string;
  index: number;
}

export interface OutlineHeading {
  id: string;
  level: 2 | 3;
  title: string;
  messageId: string;
  headingIndex: number;
}

export interface OutlineTurn {
  id: string;
  turnIndex: number;
  title: string;
  userMessageId: string;
  headings: OutlineHeading[];
}

/**
 * Parses H1/H2 (mapped to level 2) and H3 (level 3) from Markdown text.
 * Skips headings inside fenced code blocks (``` ... ```).
 */
export function parseHeadingsFromMarkdown(markdown: string): ParsedHeading[] {
  if (!markdown || typeof markdown !== 'string') return [];

  const headings: ParsedHeading[] = [];
  let inCodeBlock = false;
  let headingIndex = 0;

  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (trimmed.startsWith('### ')) {
      const title = trimmed.replace(/^###\s+/, '').trim();
      if (title) {
        headings.push({ level: 3, title, index: headingIndex++ });
      }
    } else if (trimmed.startsWith('## ')) {
      const title = trimmed.replace(/^##\s+/, '').trim();
      if (title) {
        headings.push({ level: 2, title, index: headingIndex++ });
      }
    } else if (trimmed.startsWith('# ')) {
      // Map top-level H1 to Level 2 section
      const title = trimmed.replace(/^#\s+/, '').trim();
      if (title) {
        headings.push({ level: 2, title, index: headingIndex++ });
      }
    }
  }

  return headings;
}

/**
 * Truncates user prompt to a readable one-line snippet.
 */
export function extractSnippet(content: unknown, maxLength = 45): string {
  if (typeof content !== 'string') return '';
  const firstLine =
    content
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() || '';
  if (firstLine.length <= maxLength) return firstLine;
  return firstLine.slice(0, maxLength).trimEnd() + '...';
}

/**
 * Builds the hierarchical outline from a list of conversation items.
 * Level 1: User Turn
 * Level 2: Section Heading (H1 / H2) in assistant responses
 * Level 3: Sub-section Heading (H3) in assistant responses
 */
export function buildConversationOutline(items: Array<any>): OutlineTurn[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const turns: OutlineTurn[] = [];
  let currentTurn: OutlineTurn | null = null;

  for (const item of items) {
    if (!item) continue;

    // Check if item is a user message (position === 'right')
    const isUser = item.position === 'right';

    if (isUser) {
      const content = item.content?.content || (typeof item.content === 'string' ? item.content : '');
      const title = extractSnippet(content) || `Turn ${turns.length + 1}`;
      currentTurn = {
        id: item.id || `turn-${turns.length + 1}`,
        turnIndex: turns.length + 1,
        title,
        userMessageId: item.id || '',
        headings: [],
      };
      turns.push(currentTurn);
      continue;
    }

    // If it's an assistant message and we have an active turn
    if (currentTurn && item.position === 'left' && item.type === 'text') {
      const content = item.content?.content;
      if (typeof content === 'string' && content.trim()) {
        const parsed = parseHeadingsFromMarkdown(content);
        for (const h of parsed) {
          currentTurn.headings.push({
            id: `${item.id || currentTurn.id}-h-${h.index}`,
            level: h.level,
            title: h.title,
            messageId: item.id || '',
            headingIndex: h.index,
          });
        }
      }
    }
  }

  return turns;
}
