import { describe, expect, it } from 'vitest';
import {
  getActivePaletteQuery,
  filterPaletteItems,
  BUILTIN_SLASH_ITEMS,
  BUILTIN_KNOWLEDGE_ITEMS,
  BUILTIN_PIPELINE_ITEMS,
} from '../../../packages/desktop/src/renderer/utils/chat/commandPalette';

describe('commandPalette', () => {
  describe('getActivePaletteQuery', () => {
    it('returns null for empty string or non-trigger text', () => {
      expect(getActivePaletteQuery('', 0)).toBeNull();
      expect(getActivePaletteQuery('hello world', 5)).toBeNull();
    });

    it('detects / at start of input', () => {
      const q = getActivePaletteQuery('/go', 3);
      expect(q).toEqual({
        prefix: '/',
        start: 0,
        end: 3,
        query: 'go',
        rawQuery: 'go',
        token: '/go',
      });
    });

    it('detects # in the middle of input', () => {
      const input = 'Hãy tuân thủ #ru';
      const q = getActivePaletteQuery(input, input.length);
      expect(q).toEqual({
        prefix: '#',
        start: 13,
        end: 16,
        query: 'ru',
        rawQuery: 'ru',
        token: '#ru',
      });
    });

    it('detects * in multi-prefix combo', () => {
      const input = '*visual @doc.pdf #rule /goal';
      // caret right after *visual
      const q1 = getActivePaletteQuery(input, 7);
      expect(q1).toEqual({
        prefix: '*',
        start: 0,
        end: 7,
        query: 'visual',
        rawQuery: 'visual',
        token: '*visual',
      });

      // caret right after /goal
      const q2 = getActivePaletteQuery(input, input.length);
      expect(q2).toEqual({
        prefix: '/',
        start: 23,
        end: 28,
        query: 'goal',
        rawQuery: 'goal',
        token: '/goal',
      });
    });

    it('ignores escaped triggers', () => {
      const input = 'not an email: test\\@domain.com';
      expect(getActivePaletteQuery(input, 20)).toBeNull();
    });
  });

  describe('filterPaletteItems', () => {
    it('filters slash commands by keyword', () => {
      const items = filterPaletteItems('/', 'goal');
      expect(items.some((i) => i.key === 'goal')).toBe(true);
    });

    it('returns all pipeline items for empty query', () => {
      const items = filterPaletteItems('*', '');
      expect(items.length).toBe(BUILTIN_PIPELINE_ITEMS.length);
    });

    it('filters knowledge items by keyword', () => {
      const items = filterPaletteItems('#', 'mem');
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('memory');
    });
  });
});
