import { describe, expect, it } from 'vitest';

import {
  cleanTeencode,
  normalizeOutboundText,
  normalizeVietnameseSlang,
} from '@/process/services/security/vietnameseNormalizer';

describe('vietnameseNormalizer', () => {
  describe('cleanTeencode', () => {
    it('removes invisible unicode characters', () => {
      const input = 'a\u200Bp\u200Ci\u200D_\uFEFFk\u2060e\u2069y';
      expect(cleanTeencode(input)).toBe('api_key');
    });

    it('collapses separated letters such as m.k or z.a.l.o', () => {
      expect(cleanTeencode('m.k')).toBe('mk');
      expect(cleanTeencode('m_k')).toBe('mk');
      expect(cleanTeencode('p-a-s-s')).toBe('pass');
    });

    it('normalizes leetspeak @ within words', () => {
      expect(cleanTeencode('z@lo')).toBe('zalo');
      expect(cleanTeencode('p@ss')).toBe('pass');
    });

    it('leaves standard text unchanged', () => {
      expect(cleanTeencode('Hello world')).toBe('Hello world');
      expect(cleanTeencode('')).toBe('');
    });
  });

  describe('normalizeVietnameseSlang', () => {
    it('expands mk to mật khẩu with word boundaries', () => {
      const input = 'hãy nhập mk zalo 032910800000';
      const output = normalizeVietnameseSlang(input);
      expect(output).toBe('hãy nhập mật khẩu Zalo 032910800000');
    });

    it('expands account and PII abbreviations', () => {
      const input = 'stk vcb của tôi là 123456, cccd là 012345678901';
      const output = normalizeVietnameseSlang(input);
      expect(output).toBe('số tài khoản Vietcombank của tôi là 123456, căn cước công dân là 012345678901');
    });

    it('does not replace substrings in English words or filenames', () => {
      const input = 'make build with benchmark and Makefile.mk in package';
      const output = normalizeVietnameseSlang(input);
      expect(output).toBe('make build with benchmark and Makefile.mk in package');
    });
  });

  describe('normalizeOutboundText', () => {
    it('handles combined teencode and slang expansion end-to-end', () => {
      const input = 'tôi tên là Thuận , m.k z@lo 032910800000';
      const output = normalizeOutboundText(input);
      expect(output).toBe('tôi tên là Thuận , mật khẩu Zalo 032910800000');
    });
  });
});
