import { describe, expect, it } from 'vitest';
import {
  parseHeadingsFromMarkdown,
  extractSnippet,
  buildConversationOutline,
} from '../../../packages/desktop/src/renderer/utils/chat/outlineParser';

describe('outlineParser', () => {
  describe('parseHeadingsFromMarkdown', () => {
    it('returns empty array for empty or non-string input', () => {
      expect(parseHeadingsFromMarkdown('')).toEqual([]);
      // @ts-expect-error test non-string
      expect(parseHeadingsFromMarkdown(null)).toEqual([]);
    });

    it('extracts H1, H2, and H3 with correct levels and indices', () => {
      const markdown = `
# Main Title
Intro text here.

## Section 1: Overview
Some details.

### Subsection 1.1: Background
More details.

### Subsection 1.2: Goals
Goals list.

## Section 2: Implementation
Implementation notes.
`;
      const headings = parseHeadingsFromMarkdown(markdown);
      expect(headings).toEqual([
        { level: 2, title: 'Main Title', index: 0 },
        { level: 2, title: 'Section 1: Overview', index: 1 },
        { level: 3, title: 'Subsection 1.1: Background', index: 2 },
        { level: 3, title: 'Subsection 1.2: Goals', index: 3 },
        { level: 2, title: 'Section 2: Implementation', index: 4 },
      ]);
    });

    it('ignores headings inside code blocks', () => {
      const markdown = `
## Section 1

\`\`\`markdown
# This is inside code block
## Also inside code block
\`\`\`

### Subsection after code block
`;
      const headings = parseHeadingsFromMarkdown(markdown);
      expect(headings).toEqual([
        { level: 2, title: 'Section 1', index: 0 },
        { level: 3, title: 'Subsection after code block', index: 1 },
      ]);
    });
  });

  describe('extractSnippet', () => {
    it('truncates long text and adds ellipsis', () => {
      const long = 'This is a very long user prompt that exceeds the maximum length of forty-five characters easily.';
      expect(extractSnippet(long, 40)).toBe('This is a very long user prompt that exc...');
    });

    it('preserves short text without ellipsis', () => {
      expect(extractSnippet('Short prompt', 40)).toBe('Short prompt');
    });

    it('skips leading empty lines', () => {
      expect(extractSnippet('\n\n  Actual question here  ', 40)).toBe('Actual question here');
    });
  });

  describe('buildConversationOutline', () => {
    it('builds outline turns with nested headings', () => {
      const items = [
        {
          id: 'user-1',
          position: 'right',
          type: 'text',
          content: { content: 'Làm thế nào để tối ưu UI?' },
        },
        {
          id: 'asst-1',
          position: 'left',
          type: 'text',
          content: {
            content: '## 1. Phân tích hiệu năng\nChi tiết.\n### 1.1 Virtual list\nChi tiết.\n## 2. Kết luận\nXong.',
          },
        },
        {
          id: 'user-2',
          position: 'right',
          type: 'text',
          content: { content: 'Viết test cho phần này' },
        },
        {
          id: 'asst-2',
          position: 'left',
          type: 'text',
          content: { content: '## Kịch bản kiểm thử\nChi tiết.' },
        },
      ];

      const outline = buildConversationOutline(items);
      expect(outline).toHaveLength(2);

      expect(outline[0].title).toBe('Làm thế nào để tối ưu UI?');
      expect(outline[0].headings).toHaveLength(3);
      expect(outline[0].headings[0].title).toBe('1. Phân tích hiệu năng');
      expect(outline[0].headings[0].level).toBe(2);
      expect(outline[0].headings[1].title).toBe('1.1 Virtual list');
      expect(outline[0].headings[1].level).toBe(3);
      expect(outline[0].headings[2].title).toBe('2. Kết luận');

      expect(outline[1].title).toBe('Viết test cho phần này');
      expect(outline[1].headings).toHaveLength(1);
      expect(outline[1].headings[0].title).toBe('Kịch bản kiểm thử');
    });
  });
});
