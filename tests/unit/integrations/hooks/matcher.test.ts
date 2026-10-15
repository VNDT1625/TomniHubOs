import { describe, expect, it } from 'vitest';
import {
  MAX_MATCHER_LENGTH,
  MAX_MATCH_SUBJECT_LENGTH,
  evaluateMatcher,
  hasNestedRepetition,
  matchesTool,
} from '@/common/integrations/hooks';

describe('matchesTool', () => {
  describe('match-all', () => {
    it.each([undefined, '', '*', '  ', ' * '])('%j matches everything', (matcher) => {
      expect(matchesTool(matcher, 'Bash')).toBe(true);
      expect(matchesTool(matcher, '')).toBe(true);
    });
  });

  describe('exact names and lists', () => {
    it('matches a single exact name only', () => {
      expect(matchesTool('Bash', 'Bash')).toBe(true);
      expect(matchesTool('Bash', 'BashOutput')).toBe(false);
      expect(matchesTool('Bash', 'bash')).toBe(false);
    });

    it('matches pipe lists', () => {
      expect(matchesTool('Edit|Write', 'Edit')).toBe(true);
      expect(matchesTool('Edit|Write', 'Write')).toBe(true);
      expect(matchesTool('Edit|Write', 'NotebookEdit')).toBe(false);
      expect(matchesTool('Edit|Write', 'EditWrite')).toBe(false);
    });

    it('matches comma lists with surrounding whitespace', () => {
      expect(matchesTool('Edit, Write', 'Write')).toBe(true);
      expect(matchesTool(' Edit ,  Write ', 'Edit')).toBe(true);
      expect(matchesTool('Edit, Write', 'Read')).toBe(false);
    });

    it('allows hyphen and underscore names', () => {
      expect(matchesTool('code-reviewer', 'code-reviewer')).toBe(true);
      expect(matchesTool('tomny_write|tomny_edit', 'tomny_edit')).toBe(true);
    });

    it('does not treat dots as regexp inside an exact list', () => {
      // A dot is outside the exact-list alphabet, so this is a regexp.
      expect(matchesTool('a.b', 'axb')).toBe(true);
    });
  });

  describe('regular expressions (unanchored)', () => {
    it('supports ^ prefix', () => {
      expect(matchesTool('^Notebook', 'NotebookEdit')).toBe(true);
      expect(matchesTool('^Notebook', 'MyNotebook')).toBe(false);
    });

    it('supports mcp server wildcard', () => {
      expect(matchesTool('mcp__memory__.*', 'mcp__memory__create_entities')).toBe(true);
      expect(matchesTool('mcp__memory__.*', 'mcp__github__search')).toBe(false);
    });

    it('is unanchored by default and anchorable', () => {
      expect(matchesTool('Edit.*', 'NotebookEdit')).toBe(true);
      expect(matchesTool('^Edit$', 'NotebookEdit')).toBe(false);
      expect(matchesTool('^Edit$', 'Edit')).toBe(true);
    });
  });

  describe('safety limits', () => {
    it('rejects patterns longer than the limit, with a flag', () => {
      const long = '^' + 'a'.repeat(MAX_MATCHER_LENGTH);
      expect(evaluateMatcher(long, 'a')).toEqual({ matched: false, flag: 'pattern-too-long' });
      const exact = 'a'.repeat(MAX_MATCHER_LENGTH);
      expect(evaluateMatcher(exact, exact).flag).toBeUndefined();
    });

    it('treats uncompilable patterns as non-matching without throwing', () => {
      expect(() => evaluateMatcher('(', 'x')).not.toThrow();
      expect(evaluateMatcher('(', 'x')).toEqual({ matched: false, flag: 'invalid-pattern' });
      expect(evaluateMatcher('[a-', 'x').flag).toBe('invalid-pattern');
    });

    it('only compares the first 1000 characters of the subject', () => {
      const name = 'a'.repeat(MAX_MATCH_SUBJECT_LENGTH) + 'Z';
      expect(matchesTool('Z$', name)).toBe(false);
      expect(matchesTool('^a+$', name)).toBe(true);
    });

    it.each(['(a+)+$', '(a*)*b', '(a+)*', '(.*)+x', '(a{1,5}){2,}', '((a+))+', '(?:a+)+$', '(x+x+)+y', '(a+b?)+'])(
      'refuses nested repetition %s and never hangs',
      (pattern) => {
        const started = Date.now();
        const result = evaluateMatcher(pattern, 'a'.repeat(5000) + '!');
        expect(result).toEqual({ matched: false, flag: 'unsafe-pattern' });
        expect(Date.now() - started).toBeLessThan(500);
      },
      2000
    );

    it('keeps ordinary patterns that merely contain quantifiers and groups', () => {
      expect(hasNestedRepetition('^(Edit|Write)$')).toBe(false);
      expect(hasNestedRepetition('(ab)+')).toBe(false);
      expect(hasNestedRepetition('a+(b)+')).toBe(false);
      expect(hasNestedRepetition('(a{2})+')).toBe(false);
      expect(hasNestedRepetition('(a+)?')).toBe(false);
      expect(hasNestedRepetition('[(a+)+]')).toBe(false);
      expect(hasNestedRepetition('\\(a+\\)+')).toBe(false);
      expect(matchesTool('^(Edit|Write)$', 'Write')).toBe(true);
    });

    it('stays fast on a classic catastrophic input', () => {
      const started = Date.now();
      expect(matchesTool('^(a+)+$', 'a'.repeat(40) + '!')).toBe(false);
      expect(Date.now() - started).toBeLessThan(500);
    }, 2000);
  });
});
