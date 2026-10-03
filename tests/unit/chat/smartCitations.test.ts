import { describe, expect, it } from 'vitest';
import { parseSmartCitations } from '../../../packages/desktop/src/renderer/utils/chat/smartCitations';

describe('smartCitations', () => {
  it('extracts standard footnote citations', () => {
    const markdown = `
Theo tài liệu kiến trúc [^1], hệ thống hỗ trợ đa nền tảng.
Xem thêm tại [^2].

[^1]: docs/architecture/target.md "Kiến trúc hệ thống"
[^2]: https://github.com/VNDT1625/OmniAgent
`;

    const { cleanText, citations } = parseSmartCitations(markdown);

    expect(citations).toHaveLength(2);
    expect(citations[0].id).toBe('1');
    expect(citations[0].urlOrPath).toBe('docs/architecture/target.md');
    expect(citations[0].snippet).toBe('Kiến trúc hệ thống');

    expect(citations[1].id).toBe('2');
    expect(citations[1].urlOrPath).toBe('https://github.com/VNDT1625/OmniAgent');

    // Footnote definitions should be stripped from main text
    expect(cleanText).not.toContain('[^1]: docs/architecture/target.md');
  });

  it('extracts inline [source: path/to/file.ts] markers', () => {
    const markdown = 'Chi tiết cài đặt tại [source: packages/desktop/src/index.ts].';
    const { cleanText, citations } = parseSmartCitations(markdown);

    expect(citations).toHaveLength(1);
    expect(citations[0].urlOrPath).toBe('packages/desktop/src/index.ts');
    expect(cleanText).toBe('Chi tiết cài đặt tại [^1].');
  });
});
