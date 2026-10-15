import { describe, expect, it } from 'vitest';
import { SLASH_MODES, applyModesToModelInput, expandSlashModes, isSlashMode } from '@/common/chat/slash/modes';
import { BUILTIN_SLASH_ITEMS } from '@/renderer/utils/chat/commandPalette';

describe('slash modes', () => {
  it('puts the instruction in front of the request and keeps the typed text intact', () => {
    const result = expandSlashModes('/boost thiết kế hệ thống chat');
    expect(result.applied).toEqual(['boost']);
    expect(result.request).toBe('thiết kế hệ thống chat');
    expect(result.text.startsWith('Mode /boost:')).toBe(true);
    expect(result.text.endsWith('/boost thiết kế hệ thống chat')).toBe(true);
  });

  it('combines several modes in the order they were written and ignores a repeated one', () => {
    const result = expandSlashModes('/boost /chart /boost so sánh doanh thu');
    expect(result.applied).toEqual(['boost', 'chart']);
    expect(result.text.match(/Mode \/boost:/gu)).toHaveLength(1);
    expect(result.text.indexOf('Mode /boost:')).toBeLessThan(result.text.indexOf('Mode /chart:'));
  });

  it('stops at the first word that is not a mode, and is not case sensitive', () => {
    expect(expandSlashModes('/Mermaid vẽ luồng đăng nhập').applied).toEqual(['mermaid']);
    const mixed = expandSlashModes('/fast hãy dùng /boost trong câu trả lời');
    expect(mixed.applied).toEqual(['fast']);
  });

  it.each([
    ['plain text', 'xin chào'],
    ['a mode in the middle', 'hãy /boost giúp tôi'],
    ['commands that are not modes', '/goal làm xong dự án'],
    ['export', '/export md'],
    ['the packaging command', '/repotopackage https://github.com/a/b'],
    ['a longer word that starts like a mode', '/boosted câu hỏi'],
    ['only the mode word, with nothing to apply it to', '/boost'],
    ['mode words followed by spaces only', '/boost   '],
  ])('leaves %s as it was', (_label, input) => {
    const result = expandSlashModes(input);
    expect(result.applied).toEqual([]);
    expect(result.text).toBe(input);
  });

  it('has unique names, a summary and an instruction for each mode', () => {
    const names = SLASH_MODES.map((mode) => mode.name);
    expect(new Set(names).size).toBe(names.length);
    for (const mode of SLASH_MODES) {
      expect(mode.summary.length).toBeGreaterThan(5);
      expect(mode.instruction.startsWith(`Mode /${mode.name}:`)).toBe(true);
      expect(isSlashMode(mode.name)).toBe(true);
    }
    expect(isSlashMode('goal')).toBe(false);
  });

  it('tells the model how to use the blocks the chat can draw', () => {
    const chart = SLASH_MODES.find((mode) => mode.name === 'chart')?.instruction ?? '';
    expect(chart).toContain('language is chart');
    expect(chart).toContain('"series"');
    expect(SLASH_MODES.find((mode) => mode.name === 'mermaid')?.instruction).toContain('language is mermaid');
        expect(SLASH_MODES.find((mode) => mode.name === 'guide-me')?.instruction).toContain('language is spotlight');
        expect(SLASH_MODES.find((mode) => mode.name === 'visual')?.instruction).toContain('language is tomni-ui');
    expect(SLASH_MODES.find((mode) => mode.name === 'lesson')?.instruction).toContain('correctIndex');
    expect(expandSlashModes('/visual giải thích MCP').applied).toEqual(['visual']);
  });

  it('keeps /terminal behind the normal command approval', () => {
    const terminal = SLASH_MODES.find((mode) => mode.name === 'terminal')?.instruction ?? '';
    expect(terminal).toContain('through your own command tool so the normal approval applies');
    expect(expandSlashModes('/terminal list big files').applied).toEqual(['terminal']);
    expect(expandSlashModes('/teamwork /boost ship the release').applied).toEqual(['teamwork', 'boost']);
  });
});

describe('the hidden model text', () => {
  it('replaces the typed text inside what the app already prepared, keeping the directives around it', () => {
    const typed = '/deep giải thích CRDT';
    const prepared = `Trả lời bằng tiếng Việt.\n${typed}\n[extra]`;
    const result = applyModesToModelInput(typed, prepared);
    expect(result).toContain('Mode /deep:');
    expect(result).toContain('Trả lời bằng tiếng Việt.');
    expect(result).toContain('[extra]');
    expect(result?.match(/giải thích CRDT/gu)).toHaveLength(1);
  });

  it('uses the expansion alone when nothing was prepared, and prepends it when the typed text is absent', () => {
    expect(applyModesToModelInput('/fast hi', undefined)).toContain('Mode /fast:');
    const odd = applyModesToModelInput('/fast hi', 'something else entirely');
    expect(odd?.endsWith('something else entirely')).toBe(true);
    expect(odd?.startsWith('Mode /fast:')).toBe(true);
  });

  it('returns nothing when no mode is used, so the caller keeps what it had', () => {
    expect(applyModesToModelInput('hello', 'hello')).toBeUndefined();
    expect(applyModesToModelInput('/goal x', undefined)).toBeUndefined();
  });

  it('does not read dollar sequences in the text as replacement patterns', () => {
    const typed = '/fast tính $& và $1';
    const result = applyModesToModelInput(typed, `A ${typed} B`);
    expect(result).toContain('tính $& và $1');
    expect(result?.startsWith('A ')).toBe(true);
    expect(result?.endsWith(' B')).toBe(true);
  });
});

describe('the command menu', () => {
  it('lists every mode, and only commands that do something', () => {
    const keys = BUILTIN_SLASH_ITEMS.map((item) => item.key);
    for (const mode of SLASH_MODES) expect(keys).toContain(mode.name);
    expect(keys).toEqual(expect.arrayContaining(['repotopackage', 'guide', 'goal']));
    // These were listed once but nothing handled them.
    for (const dead of ['diff', 'compact', 'status', 'browser']) expect(keys).not.toContain(dead);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
