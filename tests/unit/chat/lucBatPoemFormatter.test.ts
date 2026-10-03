import { describe, expect, it } from 'vitest';
import {
  countWords,
  isLucBatSequence,
  formatLucBatPoem,
} from '../../../packages/desktop/src/renderer/utils/chat/lucBatPoemFormatter';

describe('lucBatPoemFormatter', () => {
  it('counts words accurately in Vietnamese lines', () => {
    expect(countWords('Trăm năm trong cõi người ta')).toBe(6);
    expect(countWords('Chữ tài chữ mệnh khéo là ghét nhau')).toBe(8);
  });

  it('detects a luc bat poem sequence', () => {
    const poem = [
      'Trăm năm trong cõi người ta',
      'Chữ tài chữ mệnh khéo là ghét nhau',
      'Trải qua một cuộc bể dâu',
      'Những điều trông thấy mà đau đớn lòng',
    ];
    expect(isLucBatSequence(poem)).toBe(true);
  });

  it('formats 6-8 poem with indenting and stanza breaks', () => {
    const raw = `Trăm năm trong cõi người ta
Chữ tài chữ mệnh khéo là ghét nhau
Trải qua một cuộc bể dâu
Những điều trông thấy mà đau đớn lòng
Lạ gì bỉ sắc tư phong
Trời xanh quen thói má hồng đánh ghen`;

    const formatted = formatLucBatPoem(raw);
    const lines = formatted.split('\n');

    // 6-syllable line indented by 4 spaces
    expect(lines[0]).toBe('    Trăm năm trong cõi người ta');
    // 8-syllable line flush left
    expect(lines[1]).toBe('Chữ tài chữ mệnh khéo là ghét nhau');
    // Stanza break after 4 lines
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('    Lạ gì bỉ sắc tư phong');
  });

  it('preserves non-poem text unchanged', () => {
    const regular = 'This is a normal paragraph with multiple words that is not a poem.';
    expect(formatLucBatPoem(regular)).toBe(regular);
  });
});
